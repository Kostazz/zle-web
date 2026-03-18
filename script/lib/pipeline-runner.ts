import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { computeAuditChainHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { createSourceRunId, runTotalboardshopSourceAgent } from "./source-totalboardshop.ts";
import { decideRun, type DecisionOutput } from "./decision-agent.ts";
import type { RunManifest } from "./ingest-manifest.ts";
import type { IngestReport } from "./product-photo-ingest.types.ts";

type PipelineMode = "staged-only" | "publish-approved";

type PublishAssetResult = {
  assetId: string;
  productId: string;
  stagedOutputs: string[];
  publishedOutputs: string[];
};

type PublishFromManifestReport = {
  sourceRunId: string;
  publishRunId: string;
  startedAt: string;
  finishedAt: string;
  expectedOutputs: number;
  publishedOutputs: number;
  errors: string[];
  success: boolean;
};

type PublishFromManifestManifest = {
  sourceRunId: string;
  publishRunId: string;
  createdAt: string;
  assets: PublishAssetResult[];
};

export type PipelineArgs = {
  runId?: string;
  mode: PipelineMode;
};

const LIVE_OUTPUT_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");
const MANAGED_PUBLISH_FILE_RE = /^(?:cover|\d{2})\.(?:jpg|webp)$/;

function normalizePublishFileName(sourceOutput: string, sourcePath: string, productId: string, outputRoot: string): string {
  const outputRootPath = resolveFromCwd(outputRoot);
  const productOutputRoot = path.resolve(outputRootPath, productId);
  const relativeToProductRoot = path.relative(productOutputRoot, sourcePath);
  const normalizedRelative = relativeToProductRoot.split(path.sep).join("/");

  if (relativeToProductRoot.startsWith("..") || path.isAbsolute(relativeToProductRoot)) {
    throw new Error(
      `Staged output violates flat publish contract for ${productId}: ${sourceOutput} is outside ${path.relative(process.cwd(), productOutputRoot).split(path.sep).join("/")}`,
    );
  }

  if (normalizedRelative === "." || normalizedRelative.includes("/")) {
    throw new Error(`Staged output violates flat publish contract for ${productId}: ${sourceOutput} must map to a flat filename-only target`);
  }

  return normalizedRelative;
}

function isManagedPublishFileName(fileName: string): boolean {
  return MANAGED_PUBLISH_FILE_RE.test(fileName);
}

async function stageExistingLiveFiles(productDir: string, tempDir: string): Promise<void> {
  if (!fs.existsSync(productDir)) return;
  await fs.promises.cp(productDir, tempDir, { recursive: true, force: true });
}

async function removeStaleManagedFiles(tempDir: string, nextTargetNames: Set<string>): Promise<void> {
  if (!fs.existsSync(tempDir)) return;

  for (const entry of await fs.promises.readdir(tempDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!isManagedPublishFileName(entry.name)) continue;
    if (nextTargetNames.has(entry.name)) continue;
    await fs.promises.rm(path.join(tempDir, entry.name), { force: true });
  }
}

async function publishProductSwap(productDir: string, tempDir: string, publishRunId: string): Promise<void> {
  const backupDir = `${productDir}.backup-${publishRunId}`;
  let currentMovedToBackup = false;

  try {
    if (fs.existsSync(productDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
      await fs.promises.rename(productDir, backupDir);
      currentMovedToBackup = true;
    }

    await fs.promises.rename(tempDir, productDir);

    if (currentMovedToBackup && fs.existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }

    if (currentMovedToBackup) {
      const liveExists = fs.existsSync(productDir);
      const backupExists = fs.existsSync(backupDir);

      if (!liveExists && backupExists) {
        await fs.promises.rename(backupDir, productDir);
      } else if (liveExists) {
        throw new Error(
          `Publish target entered an anomalous state for ${path.relative(process.cwd(), productDir).split(path.sep).join("/")} after failed swap; backup preserved at ${path.relative(process.cwd(), backupDir).split(path.sep).join("/")}`,
          { cause: error },
        );
      }
    }

    throw error;
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function updateRunAudit(runId: string, extraArtifacts: Record<string, string>): Promise<string> {
  const runDir = path.join("tmp", "source-datasets", runId);
  const auditPath = path.join(runDir, "audit.json");
  const audit = JSON.parse(await fs.promises.readFile(auditPath, "utf8")) as AuditChainRecord;

  for (const [key, relOrAbsPath] of Object.entries(extraArtifacts)) {
    const absPath = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(process.cwd(), relOrAbsPath);
    if (!fs.existsSync(absPath)) continue;
    audit.artifacts[key] = {
      path: path.relative(runDir, absPath).split(path.sep).join("/"),
      sha256: await sha256File(absPath),
    };
  }

  audit.chain.currentRunHash = computeAuditChainHash(runId, audit.artifacts, audit.chain.previousRunHash);
  await fs.promises.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  return audit.chain.currentRunHash;
}

function readJson<T>(targetPath: string): T {
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

function resolveFromCwd(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
}

function validateApprovedStagedArtifacts(runId: string): { stagedManifestPath: string; stagedReportPath: string; stagedManifest: RunManifest; stagedReport: IngestReport } {
  const stagedManifestPath = path.join("tmp", "agent-manifests", `${runId}.run.json`);
  const stagedReportPath = path.join("tmp", "agent-reports", `${runId}.json`);
  if (!fs.existsSync(stagedManifestPath) || !fs.existsSync(stagedReportPath)) {
    throw new Error("Approved staged artifacts missing; refusing publish");
  }

  const stagedManifest = readJson<RunManifest>(stagedManifestPath);
  const stagedReport = readJson<IngestReport>(stagedReportPath);
  if (stagedManifest.runId !== runId || stagedReport.runId !== runId) {
    throw new Error("Staged artifact runId mismatch; refusing publish");
  }
  if (stagedReport.mode !== "staged" || stagedManifest.publishState !== "staged") {
    throw new Error("Expected staged artifacts only; refusing publish");
  }
  if (stagedReport.errors.length > 0 || stagedReport.reviewItems.length > 0 || stagedReport.unmatchedFiles.length > 0 || stagedReport.lockConflicts.length > 0) {
    throw new Error("Staged artifacts are not cleanly approved; refusing publish");
  }
  if (!Array.isArray(stagedManifest.assets) || stagedManifest.assets.length < 1) {
    throw new Error("Staged manifest is incomplete; refusing publish");
  }
  for (const asset of stagedManifest.assets) {
    if (!asset.productId || asset.requiresReview || asset.outputs.length < 1 || asset.errors.length > 0) {
      throw new Error(`Staged manifest contains non-publishable asset ${asset.assetId}; refusing publish`);
    }
    for (const output of asset.outputs) {
      if (!fs.existsSync(resolveFromCwd(output))) {
        throw new Error(`Staged output missing: ${output}`);
      }
    }
  }

  return { stagedManifestPath, stagedReportPath, stagedManifest, stagedReport };
}

export async function publishFromApprovedManifest(runId: string, publishRunId: string, stagedManifest: RunManifest): Promise<{ reportPath: string; manifestPath: string }> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const publishedAssets: PublishAssetResult[] = [];
  const assetsByProduct = new Map<string, RunManifest["assets"]>();

  for (const asset of stagedManifest.assets) {
    if (!asset.productId) {
      errors.push(`Missing productId for ${asset.assetId}`);
      publishedAssets.push({
        assetId: asset.assetId,
        productId: "",
        stagedOutputs: [...asset.outputs],
        publishedOutputs: [],
      });
      continue;
    }

    const grouped = assetsByProduct.get(asset.productId) ?? [];
    grouped.push(asset);
    assetsByProduct.set(asset.productId, grouped);
  }

  for (const [productId, productAssets] of Array.from(assetsByProduct.entries())) {
    const productDir = path.join(LIVE_OUTPUT_ROOT, productId);
    const targetNames = new Map<string, string>();
    const assetPublishedOutputs = new Map<string, string[]>();
    const stagedCopies: Array<{ sourcePath: string; targetName: string; assetId: string }> = [];
    let productError: string | null = null;

    for (const asset of productAssets) {
      assetPublishedOutputs.set(asset.assetId, []);

      try {
        for (const sourceOutput of asset.outputs) {
          const sourcePath = resolveFromCwd(sourceOutput);
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Missing staged output: ${sourceOutput}`);
          }

          const targetName = normalizePublishFileName(sourceOutput, sourcePath, productId, stagedManifest.outputDir);
          const existingSource = targetNames.get(targetName);
          if (existingSource) {
            throw new Error(`Conflicting staged outputs for ${productId}: ${existingSource} and ${sourceOutput} both map to ${targetName}`);
          }

          targetNames.set(targetName, sourceOutput);
          stagedCopies.push({ sourcePath, targetName, assetId: asset.assetId });
        }
      } catch (error) {
        productError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    if (!productError) {
      const tempDir = path.join(LIVE_OUTPUT_ROOT, `.publish-${publishRunId}-${productId}-${Date.now()}`);

      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        await fs.promises.mkdir(tempDir, { recursive: true });
        await stageExistingLiveFiles(productDir, tempDir);
        await removeStaleManagedFiles(tempDir, new Set(targetNames.keys()));

        for (const { sourcePath, targetName, assetId } of stagedCopies) {
          const targetPath = path.join(tempDir, targetName);
          await fs.promises.copyFile(sourcePath, targetPath);
          assetPublishedOutputs.get(assetId)?.push(path.relative(process.cwd(), path.join(productDir, targetName)).split(path.sep).join("/"));
        }

        await publishProductSwap(productDir, tempDir, publishRunId);
      } catch (error) {
        productError = error instanceof Error ? error.message : String(error);
      }
    }

    if (productError) {
      errors.push(productError);
      for (const asset of productAssets) {
        publishedAssets.push({
          assetId: asset.assetId,
          productId,
          stagedOutputs: [...asset.outputs],
          publishedOutputs: [],
        });
      }
      continue;
    }

    for (const asset of productAssets) {
      publishedAssets.push({
        assetId: asset.assetId,
        productId,
        stagedOutputs: [...asset.outputs],
        publishedOutputs: assetPublishedOutputs.get(asset.assetId) ?? [],
      });
    }
  }

  const expectedOutputs = stagedManifest.assets.reduce((acc, asset) => acc + asset.outputs.length, 0);
  const publishedOutputs = publishedAssets.reduce((acc, asset) => acc + asset.publishedOutputs.length, 0);
  const success = errors.length === 0 && expectedOutputs > 0 && expectedOutputs === publishedOutputs;

  const reportPath = path.join("tmp", "agent-reports", `${publishRunId}.json`);
  const manifestPath = path.join("tmp", "agent-manifests", `${publishRunId}.run.json`);

  const report: PublishFromManifestReport = {
    sourceRunId: runId,
    publishRunId,
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedOutputs,
    publishedOutputs,
    errors,
    success,
  };

  const manifest: PublishFromManifestManifest = {
    sourceRunId: runId,
    publishRunId,
    createdAt: new Date().toISOString(),
    assets: publishedAssets,
  };

  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { reportPath, manifestPath };
}

async function writePublishLog(runId: string, decision: DecisionOutput, auditHash: string): Promise<string> {
  const startedAt = new Date().toISOString();
  const publishRunId = `${runId}-publish`;
  const { stagedManifestPath, stagedReportPath, stagedManifest } = validateApprovedStagedArtifacts(runId);

  const { reportPath, manifestPath } = await publishFromApprovedManifest(runId, publishRunId, stagedManifest);
  const publishReport = readJson<PublishFromManifestReport>(reportPath);
  const publishManifest = readJson<PublishFromManifestManifest>(manifestPath);

  const manifestExpectedOutputs = stagedManifest.assets.reduce((acc, asset) => acc + asset.outputs.length, 0);
  const manifestPublishedOutputs = publishManifest.assets.reduce((acc, asset) => acc + asset.publishedOutputs.length, 0);
  const publishSucceeded =
    publishReport.publishRunId === publishRunId &&
    publishManifest.publishRunId === publishRunId &&
    publishReport.errors.length === 0 &&
    publishReport.success === true &&
    publishReport.expectedOutputs === manifestExpectedOutputs &&
    publishReport.publishedOutputs === manifestExpectedOutputs &&
    manifestPublishedOutputs === manifestExpectedOutputs;

  if (!publishSucceeded) {
    throw new Error("Publish result did not confirm successful publish; refusing to mark published");
  }

  const log = {
    sourceRunId: runId,
    publishRunId,
    startedAt,
    finishedAt: new Date().toISOString(),
    decision: decision.decision,
    published: publishSucceeded,
    stagedManifestPath,
    stagedReportPath,
    reportPath,
    manifestPath,
    auditHash,
  };

  const outputPath = path.join("tmp", "publish-logs", `${runId}.json`);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, JSON.stringify(log, null, 2), "utf8");
  return outputPath;
}

export async function runPipeline(args: PipelineArgs): Promise<{ runId: string; decision: DecisionOutput; published: boolean }> {
  const runId = args.runId ?? createSourceRunId();

  await runTotalboardshopSourceAgent({
    runId,
    outputRoot: path.join("tmp", "source-datasets"),
    seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
    maxPages: 40,
    maxProducts: 30,
    maxImagesPerProduct: 8,
    maxImageBytes: 8_000_000,
  });

  await runCommand("npm", [
    "run",
    "photos:ingest",
    "--",
    "--input",
    path.join("tmp", "source-datasets", runId, "images"),
    "--staged",
    "--source-type",
    "manual",
    "--run-id",
    runId,
  ]);

  const decision = decideRun(runId);
  const decisionDir = path.join("tmp", "agent-decisions");
  await fs.promises.mkdir(decisionDir, { recursive: true });
  const decisionPath = path.join(decisionDir, `${runId}.decision.json`);
  await fs.promises.writeFile(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  const reportPath = path.join("tmp", "agent-reports", `${runId}.json`);
  const manifestPath = path.join("tmp", "agent-manifests", `${runId}.run.json`);
  let auditHash = await updateRunAudit(runId, {
    ingestReport: reportPath,
    decisionManifest: decisionPath,
    ingestManifest: manifestPath,
  });

  let published = false;
  if (args.mode === "publish-approved" && decision.decision === "AUTO_APPROVE") {
    const publishLogPath = await writePublishLog(runId, decision, auditHash);
    auditHash = await updateRunAudit(runId, { publishLog: publishLogPath });
    published = true;
  }

  return { runId, decision, published };
}
