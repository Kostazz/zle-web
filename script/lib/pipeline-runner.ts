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

  for (const asset of stagedManifest.assets) {
    if (!asset.productId) {
      errors.push(`Missing productId for ${asset.assetId}`);
      continue;
    }

    const productDir = path.join(LIVE_OUTPUT_ROOT, asset.productId);
    await fs.promises.mkdir(productDir, { recursive: true });

    const copiedOutputs: string[] = [];
    for (const sourceOutput of asset.outputs) {
      const sourcePath = resolveFromCwd(sourceOutput);
      if (!fs.existsSync(sourcePath)) {
        errors.push(`Missing staged output: ${sourceOutput}`);
        continue;
      }
      const fileName = path.basename(sourcePath);
      const targetPath = path.join(productDir, fileName);
      await fs.promises.copyFile(sourcePath, targetPath);
      copiedOutputs.push(path.relative(process.cwd(), targetPath).split(path.sep).join("/"));
    }

    publishedAssets.push({
      assetId: asset.assetId,
      productId: asset.productId,
      stagedOutputs: [...asset.outputs],
      publishedOutputs: copiedOutputs,
    });
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
