import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { computeAuditChainHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { createSourceRunId, runTotalboardshopSourceAgent } from "./source-totalboardshop.ts";
import { decideRun, type DecisionOutput } from "./decision-agent.ts";
import type { RunManifest } from "./ingest-manifest.ts";
import type { IngestReport } from "./product-photo-ingest.types.ts";

/*
 * Pipeline-runner provides a complete end‑to‑end orchestrator for ingesting
 * product photos and publishing them atomically once they have been
 * approved.  The publish logic is intentionally strict and defensive:
 *
 *  - Staged outputs are grouped by product, ensuring that all outputs for
 *    a product are validated before any files are written to the live
 *    directory.
 *  - Only flat filenames are allowed; nested folders are rejected.
 *  - Conflicts where multiple staged outputs map to the same live target
 *    result in the entire product publish failing.
 *  - Existing live files are staged into a temporary location and then
 *    replaced in a single swap.  If the swap fails the original live
 *    directory is restored.
 *  - Only managed files (cover.jpg and numbered slots) are removed when
 *    publishing new outputs; other live files are preserved.
 */

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

// Absolute path to the directory holding live product images.  All publishes
// resolve targets relative to this root.
const LIVE_OUTPUT_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

// Managed publish files are either the cover image or a two‑digit slot.  Only
// files matching this pattern and having a .jpg or .webp extension are
// considered managed; all other files are preserved during publish.
const MANAGED_PUBLISH_FILE_RE = /^(?:cover|\d{2})\.(?:jpg|webp)$/;
const PUBLISH_TEMP_DIR_PREFIX = ".publish-temp-";
const PUBLISH_LOCK_FILE_PREFIX = ".publish-lock-";

function encodePublishPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function getProductLockPath(productId: string): string {
  return path.join(LIVE_OUTPUT_ROOT, `${PUBLISH_LOCK_FILE_PREFIX}${encodePublishPathSegment(productId)}.lock`);
}

function createPublishTempDirName(productId: string, publishRunId: string): string {
  return `${PUBLISH_TEMP_DIR_PREFIX}${encodePublishPathSegment(productId)}--${publishRunId}--${Date.now()}`;
}

function getProductIdFromTempDirName(dirName: string): string | null {
  if (!dirName.startsWith(PUBLISH_TEMP_DIR_PREFIX)) return null;
  const encodedProductId = dirName.slice(PUBLISH_TEMP_DIR_PREFIX.length).split("--", 1)[0];
  if (!encodedProductId) return null;
  try {
    return decodeURIComponent(encodedProductId);
  } catch {
    return null;
  }
}

async function acquireProductPublishLock(
  productId: string,
  publishRunId: string,
): Promise<{ lockPath: string; release: () => Promise<void> }> {
  const lockPath = getProductLockPath(productId);
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ productId, publishRunId, createdAt: new Date().toISOString() }));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new Error(`Publish lock already held for product ${productId}`);
    }
    throw error;
  }

  return {
    lockPath,
    release: async () => {
      await handle?.close().catch(() => undefined);
      handle = null;
      await fs.promises.rm(lockPath, { force: true });
    },
  };
}

async function cleanupStalePublishTempDirs(): Promise<void> {
  await fs.promises.mkdir(LIVE_OUTPUT_ROOT, { recursive: true });
  const cleanupErrors: string[] = [];
  for (const entry of await fs.promises.readdir(LIVE_OUTPUT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const productId = getProductIdFromTempDirName(entry.name);
    if (!productId) continue;
    const lockPath = getProductLockPath(productId);
    if (fs.existsSync(lockPath)) continue;
    const tempDirPath = path.join(LIVE_OUTPUT_ROOT, entry.name);
    try {
      await fs.promises.rm(tempDirPath, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(`${path.relative(process.cwd(), tempDirPath).split(path.sep).join("/")}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Failed to clean stale publish temp directories: ${cleanupErrors.join('; ')}`);
  }
}

type PublishTestHooks = {
  afterProductLockAcquired?: (productId: string) => Promise<void> | void;
};

let publishTestHooks: PublishTestHooks = {};

export function __setPublishTestHooks(hooks: PublishTestHooks): void {
  publishTestHooks = hooks;
}

export const __publishHardeningTestUtils = {
  LIVE_OUTPUT_ROOT,
  PUBLISH_TEMP_DIR_PREFIX,
  createPublishTempDirName,
};

/**
 * Normalize a staged output path into a flat filename under the live
 * product directory.  Ensures that outputs do not escape the per‑product
 * boundary and that nested folders are rejected.  Returns the filename to
 * write under the product's live directory.
 */
function normalizePublishFileName(
  sourceOutput: string,
  sourcePath: string,
  productId: string,
  outputRoot: string,
): string {
  const outputRootPath = resolveFromCwd(outputRoot);
  const productOutputRoot = path.resolve(outputRootPath, productId);
  const relativeToProductRoot = path.relative(productOutputRoot, sourcePath);
  const normalizedRelative = relativeToProductRoot.split(path.sep).join("/");

  // The staged output must be within the product's staged directory.
  if (relativeToProductRoot.startsWith("..") || path.isAbsolute(relativeToProductRoot)) {
    throw new Error(
      `Staged output violates flat publish contract for ${productId}: ${sourceOutput} is outside ${path
        .relative(process.cwd(), productOutputRoot)
        .split(path.sep)
        .join("/")}`,
    );
  }
  // The staged output must be a flat file; nested folders are not allowed.
  if (normalizedRelative === "." || normalizedRelative.includes("/")) {
    throw new Error(
      `Staged output violates flat publish contract for ${productId}: ${sourceOutput} must map to a flat filename-only target`,
    );
  }
  return normalizedRelative;
}

/**
 * Determine whether a filename should be managed by the publish pipeline.
 * Managed files are the cover image or a two‑digit slot with a supported
 * extension.
 */
function isManagedPublishFileName(fileName: string): boolean {
  return MANAGED_PUBLISH_FILE_RE.test(fileName);
}

/**
 * Copy existing live files for a product into a staging directory.  If
 * the product directory does not exist the function returns silently.
 */
async function stageExistingLiveFiles(productDir: string, tempDir: string): Promise<void> {
  if (!fs.existsSync(productDir)) return;
  await fs.promises.cp(productDir, tempDir, { recursive: true, force: true });
}

/**
 * Remove managed files from a staging directory that are not present in the
 * next set of target names.  Unmanaged files are left untouched.
 */
async function removeStaleManagedFiles(tempDir: string, nextTargetNames: Set<string>): Promise<void> {
  if (!fs.existsSync(tempDir)) return;
  for (const entry of await fs.promises.readdir(tempDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!isManagedPublishFileName(entry.name)) continue;
    if (nextTargetNames.has(entry.name)) continue;
    await fs.promises.rm(path.join(tempDir, entry.name), { force: true });
  }
}

/**
 * Atomically swap the current live product directory with a staged directory.
 * A backup is created and cleaned up on success; on failure the backup is
 * restored or an anomalous state is reported in the thrown error.
 */
async function publishProductSwap(productDir: string, tempDir: string, publishRunId: string): Promise<void> {
  const backupDir = `${productDir}.backup-${publishRunId}`;
  let currentMovedToBackup = false;
  try {
    if (fs.existsSync(productDir)) {
      // Remove any previous backup before creating a new one.
      await fs.promises.rm(backupDir, { recursive: true, force: true });
      await fs.promises.rename(productDir, backupDir);
      currentMovedToBackup = true;
    }
    // Promote the staged directory to live.
    await fs.promises.rename(tempDir, productDir);
    // Remove the backup since the swap succeeded.
    if (currentMovedToBackup && fs.existsSync(backupDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Clean up the staged directory on any error.
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    if (currentMovedToBackup) {
      const liveExists = fs.existsSync(productDir);
      const backupExists = fs.existsSync(backupDir);
      // If no live directory exists but the backup still does, restore it.
      if (!liveExists && backupExists) {
        await fs.promises.rename(backupDir, productDir);
      } else if (liveExists) {
        // An anomalous situation: both live and backup exist, leaving the
        // product in an unexpected state.  Preserve the backup for manual
        // investigation and report the anomaly.
        throw new Error(
          `Publish target entered an anomalous state for ${path
            .relative(process.cwd(), productDir)
            .split(path.sep)
            .join("/")} after failed swap; backup preserved at ${path
            .relative(process.cwd(), backupDir)
            .split(path.sep)
            .join("/")}`,
          { cause: error },
        );
      }
    }
    // Re-throw the original error after rollback.
    throw error;
  }
}

/**
 * Execute a shell command and reject on non‑zero exit codes.  Used for
 * invoking npm scripts during the ingest pipeline.
 */
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

/**
 * Update the audit log for a run with additional artifact hashes.  Each
 * artifact is recorded relative to the run directory and hashed to ensure
 * integrity.
 */
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

/**
 * Synchronously read and parse a JSON file into a typed value.
 */
function readJson<T>(targetPath: string): T {
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

/**
 * Resolve a path relative to the current working directory, preserving
 * absolute paths as-is.
 */
function resolveFromCwd(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
}

/**
 * Validate that the staged artifacts for a run are present and approved.  This
 * function reads the staged manifest and report and performs sanity checks
 * before allowing a publish.  Throws if any precondition fails.
 */
function validateApprovedStagedArtifacts(
  runId: string,
): { stagedManifestPath: string; stagedReportPath: string; stagedManifest: RunManifest; stagedReport: IngestReport } {
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
  if (
    stagedReport.errors.length > 0 ||
    stagedReport.reviewItems.length > 0 ||
    stagedReport.unmatchedFiles.length > 0 ||
    stagedReport.lockConflicts.length > 0
  ) {
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

/**
 * Publish the approved staged outputs from a manifest.  The publish is
 * performed per product, grouping all assets for a product together and
 * executing an atomic swap of the live directory.  Returns the paths to the
 * generated report and manifest for the publish.
 */
export async function publishFromApprovedManifest(
  runId: string,
  publishRunId: string,
  stagedManifest: RunManifest,
): Promise<{ reportPath: string; manifestPath: string }> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const publishedAssets: PublishAssetResult[] = [];
  await cleanupStalePublishTempDirs();
  // Group assets by product ID so that all outputs for a product are handled
  // together.
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

  // Process each product independently.
  for (const [productId, productAssets] of Array.from(assetsByProduct.entries())) {
    const productDir = path.join(LIVE_OUTPUT_ROOT, productId);
    const targetNames = new Map<string, string>();
    const assetPublishedOutputs = new Map<string, string[]>();
    const stagedCopies: Array<{ sourcePath: string; targetName: string; assetId: string }> = [];
    let productError: string | null = null;

    // Validate and collect all staged copies for this product.
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
            throw new Error(
              `Conflicting staged outputs for ${productId}: ${existingSource} and ${sourceOutput} both map to ${targetName}`,
            );
          }
          targetNames.set(targetName, sourceOutput);
          stagedCopies.push({ sourcePath, targetName, assetId: asset.assetId });
        }
      } catch (error) {
        productError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    // If validation succeeded, attempt to perform the publish.
    if (!productError) {
      const tempDir = path.join(LIVE_OUTPUT_ROOT, createPublishTempDirName(productId, publishRunId));
      let releaseLock: (() => Promise<void>) | null = null;
      try {
        const productLock = await acquireProductPublishLock(productId, publishRunId);
        releaseLock = productLock.release;
        await publishTestHooks.afterProductLockAcquired?.(productId);
        await cleanupStalePublishTempDirs();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        await fs.promises.mkdir(tempDir, { recursive: true });
        // Copy current live files into the temp directory.
        await stageExistingLiveFiles(productDir, tempDir);
        // Remove any managed files that are not part of the next publish.
        await removeStaleManagedFiles(tempDir, new Set(targetNames.keys()));
        // Copy the staged outputs into the temp directory, recording their
        // eventual live paths for manifest reporting.
        for (const { sourcePath, targetName, assetId } of stagedCopies) {
          const targetPath = path.join(tempDir, targetName);
          await fs.promises.copyFile(sourcePath, targetPath);
          const relativeLivePath = path
            .relative(process.cwd(), path.join(productDir, targetName))
            .split(path.sep)
            .join("/");
          assetPublishedOutputs.get(assetId)?.push(relativeLivePath);
        }
        // Perform the atomic swap.  If this throws the rollback logic will
        // restore or report anomalies.
        await publishProductSwap(productDir, tempDir, publishRunId);
      } catch (error) {
        productError = error instanceof Error ? error.message : String(error);
      } finally {
        try {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          if (!productError) {
            productError = error instanceof Error ? error.message : String(error);
          }
        }
        if (releaseLock) {
          try {
            await releaseLock();
          } catch (error) {
            if (!productError) {
              productError = error instanceof Error ? error.message : String(error);
            }
          }
        }
      }
    }

    // If any error occurred the entire product publish fails and no files
    // should be modified for this product.
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
    // Otherwise record the published outputs for each asset.
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

/**
 * Write a publish log for a run, validating that the publish succeeded and
 * updating the audit chain.  Throws if the publish did not confirm a
 * successful publish.
 */
async function writePublishLog(
  runId: string,
  decision: DecisionOutput,
  auditHash: string,
): Promise<string> {
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

/**
 * Top‑level entry point for running the ingestion pipeline.  This function
 * orchestrates running the source agent, ingesting photos into staged
 * artifacts, running the decision agent, and optionally publishing the
 * approved outputs.
 */
export async function runPipeline(
  args: PipelineArgs,
): Promise<{ runId: string; decision: DecisionOutput; published: boolean }> {
  const runId = args.runId ?? createSourceRunId();
  // Step 1: run the source agent to collect images.
  await runTotalboardshopSourceAgent({
    runId,
    outputRoot: path.join("tmp", "source-datasets"),
    seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
    maxPages: 40,
    maxProducts: 30,
    maxImagesPerProduct: 8,
    maxImageBytes: 8_000_000,
  });
  // Step 2: run the ingest script to stage images for manual review.
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
  // Step 3: run the decision agent to auto‑approve or require review.
  const decision = decideRun(runId);
  const decisionDir = path.join("tmp", "agent-decisions");
  await fs.promises.mkdir(decisionDir, { recursive: true });
  const decisionPath = path.join(decisionDir, `${runId}.decision.json`);
  await fs.promises.writeFile(decisionPath, JSON.stringify(decision, null, 2), "utf8");
  // Update the audit with ingest report and manifest.
  const reportPath = path.join("tmp", "agent-reports", `${runId}.json`);
  const manifestPath = path.join("tmp", "agent-manifests", `${runId}.run.json`);
  let auditHash = await updateRunAudit(runId, {
    ingestReport: reportPath,
    decisionManifest: decisionPath,
    ingestManifest: manifestPath,
  });
  let published = false;
  // Step 4: if auto‑approved and publish mode is requested, publish.
  if (args.mode === "publish-approved" && decision.decision === "AUTO_APPROVE") {
    const publishLogPath = await writePublishLog(runId, decision, auditHash);
    auditHash = await updateRunAudit(runId, { publishLog: publishLogPath });
    published = true;
  }
  return { runId, decision, published };
}