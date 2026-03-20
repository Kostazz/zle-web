import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PublishExecutionItem, PublishExecutionReport, PublishExecutionSummary } from "./publish-executor-types.ts";
import type { PublishGateManifest, PublishGateItem } from "./publish-gate-types.ts";
import type { StagingExecutionItem, StagingExecutionReport } from "./staging-review-types.ts";

export type ManualPublishExecutorInput = {
  runId: string;
  gateRunId?: string;
  reportDir?: string;
  validateOnly?: boolean;
  gateDir?: string;
  stagingManifestDir?: string;
  stagingRoot?: string;
  liveRoot?: string;
  tempRoot?: string;
};

export type ManualPublishExecutorOutput = {
  report: PublishExecutionReport;
  summaryMarkdown: string;
  reportPath?: string;
  summaryPath?: string;
};

type PlannedPublishUnit = {
  item: PublishGateItem;
  stagedItem: StagingExecutionItem;
  liveTargetKey: string;
  stagedFiles: Array<{ stagedRelativePath: string; stagedAbsolutePath: string; liveFileName: string }>;
};

const DEFAULT_GATE_ROOT = path.resolve("tmp", "publish-gates");
const DEFAULT_STAGING_MANIFEST_ROOT = path.resolve("tmp", "agent-manifests");
const DEFAULT_STAGING_ROOT = path.resolve("tmp", "agent-staging");
const DEFAULT_REPORT_ROOT = path.resolve("tmp", "publish-reports");
const DEFAULT_LIVE_ROOT = path.resolve("client", "public", "images", "products");
const DEFAULT_TEMP_ROOT = path.resolve("tmp");
const MANAGED_PUBLISH_FILE_RE = /^(?:cover|\d{2})\.(?:jpg|webp)$/;
const PUBLISH_TEMP_DIR_PREFIX = ".manual-publish-temp-";
const PUBLISH_LOCK_FILE_PREFIX = ".manual-publish-lock-";
const PUBLISH_LOCK_STALE_THRESHOLD_MS = 45 * 60 * 1000;

const publishGateItemSchema = z.object({
  sourceProductKey: z.string().min(1),
  sourceRunId: z.string().min(1),
  reviewRunId: z.string().min(1),
  stagingRunId: z.string().min(1),
  resolutionType: z.enum(["map_to_existing", "new_candidate"]),
  approvedLocalProductId: z.union([z.string().min(1), z.null()]),
  stagingTargetKey: z.string().min(1),
  plannedOutputs: z.array(z.string().min(1)),
  producedOutputs: z.array(z.string().min(1)),
  eligibilityStatus: z.enum(["eligible", "blocked"]),
  reasonCodes: z.array(z.string().min(1)),
  releaseDecision: z.enum(["ready_for_publish", "hold", "reject_release"]),
  operatorNotes: z.string().optional(),
}).strict();

const publishGateManifestSchema = z.object({
  runId: z.string().min(1),
  sourceRunId: z.string().min(1),
  reviewRunId: z.string().min(1),
  stagingRunId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  summary: z.object({
    totalStagedItems: z.number().int().nonnegative(),
    eligibleItems: z.number().int().nonnegative(),
    blockedItems: z.number().int().nonnegative(),
    readyForPublish: z.number().int().nonnegative(),
    holdCount: z.number().int().nonnegative(),
    rejectReleaseCount: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(publishGateItemSchema),
}).strict();

const stagingExecutionItemSchema = z.object({
  sourceProductKey: z.string().min(1),
  resolutionType: z.enum(["map_to_existing", "new_candidate"]),
  approvedLocalProductId: z.union([z.string().min(1), z.null()]),
  stagingTargetKey: z.string().min(1),
  plannedOutputs: z.array(z.string().min(1)),
  producedOutputs: z.array(z.string().min(1)),
  status: z.enum(["staged", "failed", "skipped"]),
  reasonCodes: z.array(z.string().min(1)),
  errorMessage: z.string().optional(),
}).strict();

const stagingExecutionReportSchema = z.object({
  runId: z.string().min(1),
  sourceRunId: z.string().min(1),
  reviewRunId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  summary: z.object({
    totalApprovedItems: z.number().int().nonnegative(),
    selectedItems: z.number().int().nonnegative(),
    stagedItems: z.number().int().nonnegative(),
    failedItems: z.number().int().nonnegative(),
    skippedItems: z.number().int().nonnegative(),
    validateOnly: z.boolean(),
    producedOutputs: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(stagingExecutionItemSchema),
}).strict();


export class ManualPublishExecutorError extends Error {
  report?: PublishExecutionReport;
  summaryMarkdown?: string;
  reportPath?: string;
  summaryPath?: string;

  constructor(
    message: string,
    details?: {
      report?: PublishExecutionReport;
      summaryMarkdown?: string;
      reportPath?: string;
      summaryPath?: string;
    },
  ) {
    super(message);
    this.name = "ManualPublishExecutorError";
    this.report = details?.report;
    this.summaryMarkdown = details?.summaryMarkdown;
    this.reportPath = details?.reportPath;
    this.summaryPath = details?.summaryPath;
  }
}

type PublishLockMetadata = {
  liveTargetKey: string;
  runId: string;
  gateRunId: string;
  createdAt: string;
  hostname?: string;
  pid?: number;
};

type PublishLockStatus =
  | { status: "acquired"; handle: fs.promises.FileHandle; metadata: PublishLockMetadata }
  | { status: "active"; metadata: PublishLockMetadata; ageMs: number }
  | { status: "stale"; metadata: PublishLockMetadata; ageMs: number }
  | { status: "malformed"; reason: string };

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertNoSymlinkInPathChain(targetPath: string, stopAtRoot: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(stopAtRoot);
  if (!isPathInside(normalizedRoot, normalizedTarget)) throw new Error(`Path escape blocked: ${normalizedTarget}`);

  const chain: string[] = [];
  let current = normalizedTarget;
  while (true) {
    chain.push(current);
    if (current === normalizedRoot) break;
    const next = path.dirname(current);
    if (next === current) throw new Error(`Unsafe root boundary for path: ${normalizedTarget}`);
    current = next;
  }

  for (const candidate of chain) {
    if (!fs.existsSync(candidate)) continue;
    const stat = await fs.promises.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error(`Symlink path blocked: ${candidate}`);
  }
}

function assertInsideAllowedRoot(targetPath: string, allowedRoot: string, label: string): string {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(allowedRoot, resolved)) {
    throw new Error(`Refusing ${label} outside ${toPortablePath(path.relative(process.cwd(), allowedRoot))}: ${targetPath}`);
  }
  return resolved;
}

async function ensureWritableDir(targetDir: string, rootDir: string): Promise<void> {
  const normalizedTarget = assertInsideAllowedRoot(targetDir, rootDir, "directory");
  await fs.promises.mkdir(normalizedTarget, { recursive: true });
  await assertNoSymlinkInPathChain(normalizedTarget, rootDir);
}

async function safeWriteJson(targetPath: string, value: unknown, rootDir: string): Promise<void> {
  const normalizedTarget = assertInsideAllowedRoot(targetPath, rootDir, "file write");
  await ensureWritableDir(path.dirname(normalizedTarget), rootDir);
  await fs.promises.writeFile(normalizedTarget, JSON.stringify(value, null, 2), "utf8");
}

async function safeWriteText(targetPath: string, value: string, rootDir: string): Promise<void> {
  const normalizedTarget = assertInsideAllowedRoot(targetPath, rootDir, "file write");
  await ensureWritableDir(path.dirname(normalizedTarget), rootDir);
  await fs.promises.writeFile(normalizedTarget, value, "utf8");
}

function readJsonFile(targetPath: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertFileExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) throw new Error(`Missing required artifact: ${label} at ${targetPath}`);
}

function normalizeStringArray(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function sortGateItems(items: PublishGateItem[]): PublishGateItem[] {
  return [...items].map((item) => ({
    ...item,
    plannedOutputs: normalizeStringArray(item.plannedOutputs),
    producedOutputs: normalizeStringArray(item.producedOutputs),
    reasonCodes: normalizeStringArray(item.reasonCodes),
  })).sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
}

function sortStagingItems(items: StagingExecutionItem[]): StagingExecutionItem[] {
  return [...items].map((item) => ({
    ...item,
    plannedOutputs: normalizeStringArray(item.plannedOutputs),
    producedOutputs: normalizeStringArray(item.producedOutputs),
    reasonCodes: normalizeStringArray(item.reasonCodes),
  })).sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
}

function validatePublishGateManifest(raw: unknown): PublishGateManifest {
  const parsed = publishGateManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((entry) => `${entry.path.join(".") || "manifest"}: ${entry.message}`).join("; ");
    throw new Error(`Invalid publish gate manifest shape: ${issue}`);
  }
  return { ...parsed.data, items: sortGateItems(parsed.data.items) };
}

function validateStagingExecutionReport(raw: unknown): StagingExecutionReport {
  const parsed = stagingExecutionReportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((entry) => `${entry.path.join(".") || "report"}: ${entry.message}`).join("; ");
    throw new Error(`Invalid staging execution report shape: ${issue}`);
  }
  return { ...parsed.data, items: sortStagingItems(parsed.data.items) };
}

function validateRelativeArtifactPath(relativePath: string, expectedRunId: string, stagingRoot: string): string {
  if (!relativePath || typeof relativePath !== "string") throw new Error(`Malformed staged output path: ${String(relativePath)}`);
  if (relativePath.includes("\0") || path.isAbsolute(relativePath)) throw new Error(`Unsafe staged output path: ${relativePath}`);
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith("../") || normalized === "..") throw new Error(`Staged output path escapes root: ${relativePath}`);
  const segments = normalized.split("/");
  if (segments.length < 5) throw new Error(`Malformed staged output path: ${relativePath}`);
  if (segments[0] !== "tmp" || segments[1] !== "agent-staging") throw new Error(`Staged output path is outside tmp/agent-staging: ${relativePath}`);
  if (segments[2] !== expectedRunId) throw new Error(`Staged output runId mismatch: ${relativePath}`);
  const resolved = path.resolve(stagingRoot, path.posix.relative("tmp/agent-staging", normalized));
  if (!isPathInside(stagingRoot, resolved)) throw new Error(`Staged output path escapes staging root: ${relativePath}`);
  return resolved;
}

function createLiveTargetKey(item: PublishGateItem): string {
  if (item.resolutionType === "map_to_existing") {
    if (!item.approvedLocalProductId) throw new Error(`map_to_existing requires approvedLocalProductId for ${item.sourceProductKey}`);
    return item.approvedLocalProductId;
  }
  if (item.approvedLocalProductId) throw new Error(`new_candidate must not carry approvedLocalProductId for ${item.sourceProductKey}`);
  const [, candidateKey] = item.stagingTargetKey.split("/", 2);
  if (!candidateKey) throw new Error(`Malformed stagingTargetKey for ${item.sourceProductKey}: ${item.stagingTargetKey}`);
  return candidateKey;
}

function normalizeManagedLiveFileName(fileName: string): string {
  if (!MANAGED_PUBLISH_FILE_RE.test(fileName)) throw new Error(`Unsupported managed live filename: ${fileName}`);
  return fileName;
}

function computeSummary(items: PublishExecutionItem[], totalGateItems: number): PublishExecutionSummary {
  return {
    totalGateItems,
    readyForPublish: items.filter((item) => item.reasonCodes.includes("ready_for_publish")).length,
    published: items.filter((item) => item.status === "published").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    mappedToExisting: items.filter((item) => item.status === "published" && item.resolutionType === "map_to_existing").length,
    newCandidatePublished: items.filter((item) => item.status === "published" && item.resolutionType === "new_candidate").length,
  };
}

function renderSummaryMarkdown(report: PublishExecutionReport, validateOnly: boolean): string {
  const lines = [
    "# TotalBoardShop Manual Publish Summary",
    "",
    `- Run ID: ${report.runId}`,
    `- Gate Run ID: ${report.gateRunId}`,
    `- Source Run ID: ${report.sourceRunId}`,
    `- Review Run ID: ${report.reviewRunId}`,
    `- Staging Run ID: ${report.stagingRunId}`,
    `- Created At: ${report.createdAt}`,
    `- Mode: ${validateOnly ? "validate-only" : "publish"}`,
    "",
    "## Summary Counts",
    `- Total gate items: ${report.summary.totalGateItems}`,
    `- Ready for publish: ${report.summary.readyForPublish}`,
    `- Published: ${report.summary.published}`,
    `- Failed: ${report.summary.failed}`,
    `- Skipped: ${report.summary.skipped}`,
    `- Published mapped-to-existing: ${report.summary.mappedToExisting}`,
    `- Published new candidates: ${report.summary.newCandidatePublished}`,
    "",
    "## Guardrails",
    "- This executor only consumes a validated publish gate manifest plus a staging execution report.",
    "- This is the first and only layer in this flow allowed to write live assets.",
    "- Live writes are restricted to the managed live asset root.",
    "- Report writes are restricted to tmp/publish-reports.",
    "- Missing staged outputs, path traversal, collisions, malformed JSON, or shape errors fail closed.",
  ];

  if (report.items.length > 0) {
    lines.push("", "## Item Outcomes");
    for (const item of report.items) {
      lines.push(`- ${item.sourceProductKey}: ${item.status} -> ${item.liveTargetKey}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createLockMetadata(liveTargetKey: string, runId: string, gateRunId: string): PublishLockMetadata {
  return {
    liveTargetKey,
    runId,
    gateRunId,
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
  };
}

function encodePublishPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function getPublishLockPath(liveRoot: string, liveTargetKey: string): string {
  return path.join(liveRoot, `${PUBLISH_LOCK_FILE_PREFIX}${encodePublishPathSegment(liveTargetKey)}.lock`);
}

function createPublishTempDirName(liveTargetKey: string, runId: string): string {
  return `${PUBLISH_TEMP_DIR_PREFIX}${encodePublishPathSegment(liveTargetKey)}--${runId}--${Date.now()}`;
}

function describePublishLock(metadata: PublishLockMetadata, ageMs: number): string {
  return [
    `liveTargetKey=${metadata.liveTargetKey}`,
    `runId=${metadata.runId}`,
    `gateRunId=${metadata.gateRunId}`,
    `createdAt=${metadata.createdAt}`,
    `ageMs=${ageMs}`,
  ].join(", ");
}

function parseLockMetadata(raw: string, expectedLiveTargetKey: string): PublishLockStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "malformed", reason: `metadata is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!parsed || typeof parsed !== "object") return { status: "malformed", reason: "metadata is not a JSON object" };
  const metadata = parsed as Partial<PublishLockMetadata>;
  if (metadata.liveTargetKey !== expectedLiveTargetKey) return { status: "malformed", reason: "metadata liveTargetKey mismatch" };
  if (typeof metadata.runId !== "string" || !metadata.runId) return { status: "malformed", reason: "metadata runId missing" };
  if (typeof metadata.gateRunId !== "string" || !metadata.gateRunId) return { status: "malformed", reason: "metadata gateRunId missing" };
  if (typeof metadata.createdAt !== "string" || !metadata.createdAt) return { status: "malformed", reason: "metadata createdAt missing" };
  const createdAtMs = Date.parse(metadata.createdAt);
  if (!Number.isFinite(createdAtMs)) return { status: "malformed", reason: `metadata createdAt invalid (${metadata.createdAt})` };
  const ageMs = Date.now() - createdAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return { status: "malformed", reason: `metadata createdAt ambiguous (${metadata.createdAt})` };
  const normalized: PublishLockMetadata = {
    liveTargetKey: metadata.liveTargetKey,
    runId: metadata.runId,
    gateRunId: metadata.gateRunId,
    createdAt: metadata.createdAt,
    hostname: typeof metadata.hostname === "string" ? metadata.hostname : undefined,
    pid: typeof metadata.pid === "number" ? metadata.pid : undefined,
  };
  if (ageMs > PUBLISH_LOCK_STALE_THRESHOLD_MS) return { status: "stale", metadata: normalized, ageMs };
  return { status: "active", metadata: normalized, ageMs };
}

async function tryCreatePublishLock(lockPath: string, metadata: PublishLockMetadata): Promise<PublishLockStatus> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(metadata));
    await handle.sync();
    return { status: "acquired", handle, metadata };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  }
  const rawLock = await fs.promises.readFile(lockPath, "utf8");
  return parseLockMetadata(rawLock, metadata.liveTargetKey);
}

async function acquirePublishLock(liveRoot: string, liveTargetKey: string, runId: string, gateRunId: string): Promise<() => Promise<void>> {
  const lockPath = getPublishLockPath(liveRoot, liveTargetKey);
  const metadata = createLockMetadata(liveTargetKey, runId, gateRunId);
  const firstAttempt = await tryCreatePublishLock(lockPath, metadata);
  if (firstAttempt.status === "acquired") {
    let handle: fs.promises.FileHandle | null = firstAttempt.handle;
    return async () => {
      await handle?.close().catch(() => undefined);
      handle = null;
      await fs.promises.rm(lockPath, { force: true });
    };
  }
  if (firstAttempt.status === "active") {
    throw new Error(`Publish lock actively held; ${describePublishLock(firstAttempt.metadata, firstAttempt.ageMs)}`);
  }
  if (firstAttempt.status === "malformed") throw new Error(`Publish lock metadata malformed; ${firstAttempt.reason}`);
  await fs.promises.rm(lockPath, { force: false });
  const secondAttempt = await tryCreatePublishLock(lockPath, metadata);
  if (secondAttempt.status === "acquired") {
    let handle: fs.promises.FileHandle | null = secondAttempt.handle;
    return async () => {
      await handle?.close().catch(() => undefined);
      handle = null;
      await fs.promises.rm(lockPath, { force: true });
    };
  }
  throw new Error(`Stale publish lock recovery failed for ${liveTargetKey}`);
}

async function cleanupStaleTempDirs(liveRoot: string): Promise<void> {
  await fs.promises.mkdir(liveRoot, { recursive: true });
  for (const entry of await fs.promises.readdir(liveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PUBLISH_TEMP_DIR_PREFIX)) continue;
    const tempDir = path.join(liveRoot, entry.name);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function copyExistingLiveFiles(productDir: string, tempDir: string): Promise<void> {
  if (!fs.existsSync(productDir)) return;
  await fs.promises.cp(productDir, tempDir, { recursive: true, force: true });
}

async function removeStaleManagedFiles(tempDir: string, nextTargetNames: Set<string>): Promise<string[]> {
  if (!fs.existsSync(tempDir)) return [];
  const removed: string[] = [];
  for (const entry of await fs.promises.readdir(tempDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!MANAGED_PUBLISH_FILE_RE.test(entry.name)) continue;
    if (nextTargetNames.has(entry.name)) continue;
    await fs.promises.rm(path.join(tempDir, entry.name), { force: true });
    removed.push(entry.name);
  }
  return removed.sort((a, b) => a.localeCompare(b));
}

async function publishProductSwap(productDir: string, tempDir: string, runId: string): Promise<void> {
  const backupDir = `${productDir}.backup-${runId}`;
  let moved = false;
  try {
    if (fs.existsSync(productDir)) {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
      await fs.promises.rename(productDir, backupDir);
      moved = true;
    }
    await fs.promises.rename(tempDir, productDir);
    if (moved && fs.existsSync(backupDir)) await fs.promises.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(tempDir)) await fs.promises.rm(tempDir, { recursive: true, force: true });
    if (moved && !fs.existsSync(productDir) && fs.existsSync(backupDir)) {
      await fs.promises.rename(backupDir, productDir);
    }
    throw error;
  }
}

function buildExecutionItem(unit: PlannedPublishUnit, status: PublishExecutionItem["status"], reasonCodes: string[], extras?: Partial<PublishExecutionItem>): PublishExecutionItem {
  return {
    sourceProductKey: unit.item.sourceProductKey,
    resolutionType: unit.item.resolutionType,
    approvedLocalProductId: unit.item.approvedLocalProductId,
    liveTargetKey: unit.liveTargetKey,
    plannedOutputs: [...unit.item.plannedOutputs],
    publishedOutputs: [],
    removedManagedOutputs: [],
    status,
    reasonCodes: normalizeStringArray(reasonCodes),
    ...extras,
  };
}

function planPublishUnits(input: ManualPublishExecutorInput, gateManifest: PublishGateManifest, stagingReport: StagingExecutionReport): PlannedPublishUnit[] {
  if (gateManifest.sourceRunId !== stagingReport.sourceRunId) throw new Error(`sourceRunId mismatch across gate/staging artifacts for run ${input.runId}`);
  if (gateManifest.reviewRunId !== stagingReport.reviewRunId) throw new Error(`reviewRunId mismatch across gate/staging artifacts for run ${input.runId}`);
  if (gateManifest.stagingRunId !== stagingReport.runId) throw new Error(`stagingRunId mismatch across gate/staging artifacts for run ${input.runId}`);

  const stagingRoot = path.resolve(input.stagingRoot ?? DEFAULT_STAGING_ROOT);
  const stagedBySourceKey = new Map(stagingReport.items.map((item) => [item.sourceProductKey, item]));
  const seenTargets = new Map<string, string>();
  const readyItems = gateManifest.items.filter((item) => item.releaseDecision === "ready_for_publish" && item.eligibilityStatus === "eligible");

  return readyItems.map((item) => {
    const stagedItem = stagedBySourceKey.get(item.sourceProductKey);
    if (!stagedItem) throw new Error(`Publish gate item missing staging execution item: ${item.sourceProductKey}`);
    if (stagedItem.status !== "staged") throw new Error(`Publish gate item is not successfully staged: ${item.sourceProductKey}`);
    if (item.resolutionType !== stagedItem.resolutionType) throw new Error(`resolutionType mismatch for ${item.sourceProductKey}`);
    if ((item.approvedLocalProductId ?? null) !== (stagedItem.approvedLocalProductId ?? null)) throw new Error(`approvedLocalProductId mismatch for ${item.sourceProductKey}`);
    if (item.stagingTargetKey !== stagedItem.stagingTargetKey) throw new Error(`stagingTargetKey mismatch for ${item.sourceProductKey}`);
    if (item.eligibilityStatus !== "eligible") throw new Error(`Ineligible item cannot be published: ${item.sourceProductKey}`);
    if (item.releaseDecision !== "ready_for_publish") throw new Error(`Item lacks release authority: ${item.sourceProductKey}`);

    const plannedOutputs = normalizeStringArray(item.plannedOutputs);
    const producedOutputs = normalizeStringArray(stagedItem.producedOutputs);
    if (plannedOutputs.length < 1) throw new Error(`Publish item has no planned outputs: ${item.sourceProductKey}`);
    if (plannedOutputs.length !== producedOutputs.length) throw new Error(`plannedOutputs / producedOutputs mismatch for ${item.sourceProductKey}`);
    if (plannedOutputs.some((output, index) => output !== producedOutputs[index])) {
      throw new Error(`plannedOutputs / producedOutputs mismatch for ${item.sourceProductKey}`);
    }

    const liveTargetKey = createLiveTargetKey(item);
    const owner = seenTargets.get(liveTargetKey);
    if (owner) throw new Error(`Live target collision detected: ${liveTargetKey} (${owner}, ${item.sourceProductKey})`);
    seenTargets.set(liveTargetKey, item.sourceProductKey);

    const stagedFiles = plannedOutputs.map((relativePath) => {
      const stagedAbsolutePath = validateRelativeArtifactPath(relativePath, gateManifest.stagingRunId, stagingRoot);
      const fileName = normalizeManagedLiveFileName(path.basename(stagedAbsolutePath));
      return {
        stagedRelativePath: relativePath,
        stagedAbsolutePath,
        liveFileName: fileName,
      };
    }).sort((a, b) => a.liveFileName.localeCompare(b.liveFileName));

    const fileNameSet = new Set<string>();
    for (const stagedFile of stagedFiles) {
      if (fileNameSet.has(stagedFile.liveFileName)) {
        throw new Error(`Live output collision detected within ${item.sourceProductKey}: ${stagedFile.liveFileName}`);
      }
      fileNameSet.add(stagedFile.liveFileName);
      if (!fs.existsSync(stagedFile.stagedAbsolutePath)) {
        throw new Error(`Missing staged output blocks publish: ${stagedFile.stagedRelativePath}`);
      }
    }

    return { item, stagedItem, liveTargetKey, stagedFiles };
  }).sort((a, b) => a.item.sourceProductKey.localeCompare(b.item.sourceProductKey));
}

async function executePublishUnit(unit: PlannedPublishUnit, input: ManualPublishExecutorInput, gateRunId: string, validateOnly: boolean): Promise<PublishExecutionItem> {
  const liveRoot = path.resolve(input.liveRoot ?? DEFAULT_LIVE_ROOT);
  const tempRoot = path.resolve(input.tempRoot ?? DEFAULT_TEMP_ROOT);
  const productDir = assertInsideAllowedRoot(path.join(liveRoot, unit.liveTargetKey), liveRoot, "live publish target");
  const tempDir = assertInsideAllowedRoot(path.join(liveRoot, createPublishTempDirName(unit.liveTargetKey, input.runId)), liveRoot, "live temp directory");
  await assertNoSymlinkInPathChain(liveRoot, liveRoot);

  for (const stagedFile of unit.stagedFiles) {
    await assertNoSymlinkInPathChain(stagedFile.stagedAbsolutePath, path.resolve(input.stagingRoot ?? DEFAULT_STAGING_ROOT));
  }

  if (validateOnly) {
    return buildExecutionItem(unit, "skipped", ["ready_for_publish", "validate_only"]);
  }

  await ensureWritableDir(liveRoot, liveRoot);
  await ensureWritableDir(tempRoot, tempRoot);
  const releaseLock = await acquirePublishLock(liveRoot, unit.liveTargetKey, input.runId, gateRunId);
  try {
    await cleanupStaleTempDirs(liveRoot);
    await fs.promises.mkdir(tempDir, { recursive: true });
    await assertNoSymlinkInPathChain(tempDir, liveRoot);
    await copyExistingLiveFiles(productDir, tempDir);

    const targetNames = new Set(unit.stagedFiles.map((entry) => entry.liveFileName));
    const removedManagedOutputs = await removeStaleManagedFiles(tempDir, targetNames);
    const publishedOutputs: string[] = [];

    for (const stagedFile of unit.stagedFiles) {
      const targetPath = path.join(tempDir, stagedFile.liveFileName);
      const normalizedTarget = assertInsideAllowedRoot(targetPath, tempDir, "temp publish output");
      await fs.promises.copyFile(stagedFile.stagedAbsolutePath, normalizedTarget);
      publishedOutputs.push(toPortablePath(path.relative(process.cwd(), path.join(productDir, stagedFile.liveFileName))));
    }

    const tempManagedNames = new Set(
      (await fs.promises.readdir(tempDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && MANAGED_PUBLISH_FILE_RE.test(entry.name))
        .map((entry) => entry.name),
    );
    for (const expectedName of Array.from(targetNames)) {
      if (!tempManagedNames.has(expectedName)) throw new Error(`Temp publish candidate incomplete for ${unit.item.sourceProductKey}: ${expectedName}`);
    }

    await publishProductSwap(productDir, tempDir, input.runId);
    return buildExecutionItem(unit, "published", ["ready_for_publish"], {
      publishedOutputs: publishedOutputs.sort((a, b) => a.localeCompare(b)),
      removedManagedOutputs,
    });
  } catch (error) {
    return buildExecutionItem(unit, "failed", ["ready_for_publish", "publish_failed"], {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await releaseLock().catch(() => undefined);
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runManualPublishExecutor(input: ManualPublishExecutorInput): Promise<ManualPublishExecutorOutput> {
  if (!input.runId?.trim()) throw new Error("Missing runId");
  const gateRunId = input.gateRunId?.trim() || input.runId;
  const gateDir = path.resolve(input.gateDir ?? DEFAULT_GATE_ROOT);
  const stagingManifestDir = path.resolve(input.stagingManifestDir ?? DEFAULT_STAGING_MANIFEST_ROOT);
  const reportRoot = assertInsideAllowedRoot(input.reportDir ?? DEFAULT_REPORT_ROOT, DEFAULT_REPORT_ROOT, "publish report output");

  const gatePath = path.join(gateDir, `${gateRunId}.publish-gate.json`);
  const stagingPath = path.join(stagingManifestDir, `${input.runId}.staging.json`);
  assertFileExists(gatePath, "publish gate manifest");
  assertFileExists(stagingPath, "staging execution report");

  const gateManifest = validatePublishGateManifest(readJsonFile(gatePath, "publish gate manifest"));
  const stagingReport = validateStagingExecutionReport(readJsonFile(stagingPath, "staging execution report"));
  if (gateManifest.runId !== gateRunId) throw new Error(`run id mismatch in publish gate manifest: expected ${gateRunId}, received ${gateManifest.runId}`);
  if (stagingReport.runId !== input.runId) throw new Error(`run id mismatch in staging report: expected ${input.runId}, received ${stagingReport.runId}`);

  const units = planPublishUnits(input, gateManifest, stagingReport);
  const executedItems = await Promise.all(units.map((unit) => executePublishUnit(unit, input, gateRunId, input.validateOnly === true)));
  const skippedItems: PublishExecutionItem[] = gateManifest.items
    .filter((item) => !(item.releaseDecision === "ready_for_publish" && item.eligibilityStatus === "eligible"))
    .sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey))
    .map((item) => ({
      sourceProductKey: item.sourceProductKey,
      resolutionType: item.resolutionType,
      approvedLocalProductId: item.approvedLocalProductId,
      liveTargetKey: createLiveTargetKey(item),
      plannedOutputs: normalizeStringArray(item.plannedOutputs),
      publishedOutputs: [],
      removedManagedOutputs: [],
      status: "skipped",
      reasonCodes: normalizeStringArray([
        item.releaseDecision !== "ready_for_publish" ? `release_decision:${item.releaseDecision}` : "ready_for_publish",
        `eligibility:${item.eligibilityStatus}`,
      ]),
    }));
  const items = [...executedItems, ...skippedItems].sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));

  const report: PublishExecutionReport = {
    runId: input.runId,
    sourceRunId: gateManifest.sourceRunId,
    reviewRunId: gateManifest.reviewRunId,
    stagingRunId: gateManifest.stagingRunId,
    gateRunId: gateManifest.runId,
    createdAt: new Date().toISOString(),
    summary: computeSummary(items, gateManifest.items.length),
    items,
    debug: {
      hadPartialResults: items.length > 0,
      errorStage: "execution",
    },
  };
  const summaryMarkdown = renderSummaryMarkdown(report, input.validateOnly === true);

  await ensureWritableDir(reportRoot, DEFAULT_REPORT_ROOT);
  const reportPath = path.join(reportRoot, `${input.runId}.publish.json`);
  const summaryPath = path.join(reportRoot, `${input.runId}.summary.md`);
  await safeWriteJson(reportPath, report, DEFAULT_REPORT_ROOT);
  await safeWriteText(summaryPath, summaryMarkdown, DEFAULT_REPORT_ROOT);

  if (items.some((item) => item.status === "failed")) {
    throw new ManualPublishExecutorError(
      `Manual publish failed closed for ${items.filter((item) => item.status === "failed").length} item(s)`,
      { report, summaryMarkdown, reportPath, summaryPath },
    );
  }

  return { report, summaryMarkdown, reportPath, summaryPath };
}
