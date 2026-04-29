import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { loadLocalCatalog, normalizeText } from "./catalog-index.ts";
import type { CurationReport } from "./curation-types.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./source-dataset.ts";
import type {
  ApprovedStagingItem,
  ApprovedStagingResolution,
  StagingExecutionItem,
  StagingExecutionReport,
  StagingExecutionSummary,
} from "./staging-review-types.ts";
import { resolveGalleryImageOrder } from "./gallery-image-role.ts";

export type ApprovedStagingExecutorInput = {
  runId: string;
  reviewRunId?: string;
  sourceRoot?: string;
  curationDir?: string;
  reviewDir?: string;
  outputDir?: string;
  manifestDir?: string;
  limit?: number;
  validateOnly?: boolean;
};

export type ApprovedStagingExecutorOutput = {
  approvedItems: ApprovedStagingItem[];
  report: StagingExecutionReport;
  reportPath: string;
  summaryPath: string;
};

const ALLOWED_STAGING_ROOT = path.resolve("tmp", "agent-staging");
const ALLOWED_MANIFEST_ROOT = path.resolve("tmp", "agent-manifests");
const LIVE_OUTPUT_ROOT = path.resolve("client", "public", "images", "products");
const MAX_WIDTH = 2000;
const JPEG_QUALITY = 86;
const WEBP_QUALITY = 82;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

const reviewDecisionEntrySchema = z.object({
  sourceProductKey: z.string().min(1),
  decision: z.enum(["approved", "rejected", "hold"]),
  resolutionType: z.union([z.enum(["map_to_existing", "new_candidate"]), z.null()]),
  approvedLocalProductId: z.string().min(1).optional(),
  operatorNotes: z.string().optional(),
}).strict();

type NormalizedReviewDecisionEntry = z.infer<typeof reviewDecisionEntrySchema>;
type NormalizedReviewDecisionManifest = z.infer<typeof reviewDecisionManifestSchema>;

const reviewDecisionManifestSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  sourceRunId: z.string().min(1),
  decisions: z.array(reviewDecisionEntrySchema),
}).strict();

function isPathInside(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSafeRelativeImagePath(imagePath: string): boolean {
  return Boolean(imagePath)
    && !imagePath.includes("\0")
    && !path.isAbsolute(imagePath)
    && !imagePath.includes("..");
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function assertInsideAllowedRoot(targetPath: string, allowedRoot: string, label: string): string {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(allowedRoot, resolved)) {
    throw new Error(`Refusing ${label} outside ${toPortablePath(path.relative(process.cwd(), allowedRoot))}: ${targetPath}`);
  }
  if (isPathInside(LIVE_OUTPUT_ROOT, resolved)) {
    throw new Error(`Live output path is forbidden for ${label}: ${targetPath}`);
  }
  return resolved;
}

async function assertNoSymlinkInPathChain(targetPath: string, stopAtRoot: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(stopAtRoot);
  if (!isPathInside(normalizedRoot, normalizedTarget)) {
    throw new Error(`Path escape blocked: ${normalizedTarget}`);
  }

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

function readJsonFile<T>(targetPath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertFileExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) throw new Error(`Missing required artifact: ${label} at ${targetPath}`);
}

function sanitizePathSegment(value: string): string {
  const normalized = normalizeText(value).replace(/\s+/g, "-");
  return normalized.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function normalizeApprovedManifest(rawManifest: unknown): NormalizedReviewDecisionManifest {
  const parsed = reviewDecisionManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((entry) => `${entry.path.join(".") || "manifest"}: ${entry.message}`).join("; ");
    throw new Error(`Invalid review decision manifest shape: ${issue}`);
  }
  return {
    ...parsed.data,
    decisions: [...parsed.data.decisions].sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey)),
  };
}

function renderSummaryMarkdown(report: StagingExecutionReport): string {
  const lines = [
    "# TotalBoardShop Approved Staging Summary",
    "",
    `- Run ID: ${report.runId}`,
    `- Source Run ID: ${report.sourceRunId}`,
    `- Review Run ID: ${report.reviewRunId}`,
    `- Created At: ${report.createdAt}`,
    "",
    "## Summary Counts",
    `- Total approved items: ${report.summary.totalApprovedItems}`,
    `- Selected items: ${report.summary.selectedItems}`,
    `- Staged items: ${report.summary.stagedItems}`,
    `- Failed items: ${report.summary.failedItems}`,
    `- Skipped items: ${report.summary.skippedItems}`,
    `- Produced outputs: ${report.summary.producedOutputs}`,
    `- Validate only: ${report.summary.validateOnly ? "yes" : "no"}`,
    "",
    "## Guardrails",
    "- Only review-approved items were planned.",
    "- Rejected and hold items were not processed.",
    "- No publish action was executed.",
    "- No live asset writes were allowed.",
    "- Writes are restricted to tmp/agent-staging and tmp/agent-manifests.",
  ];

  if (report.items.length > 0) {
    lines.push("", "## Item Outcomes");
    for (const item of report.items) {
      lines.push(`- ${item.sourceProductKey}: ${item.status} -> ${item.stagingTargetKey}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function renderOutputsWithSharp(sourcePath: string): Promise<{ jpg: Buffer; webp: Buffer }> {
  const meta = await sharp(sourcePath, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if ((meta.size ?? 0) > MAX_INPUT_BYTES) throw new Error(`input_too_large:${meta.size}`);
  const base = sharp(sourcePath, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({
    width: MAX_WIDTH,
    fit: "inside",
    withoutEnlargement: true,
  });
  const [jpg, webp] = await Promise.all([
    base.clone().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
    base.clone().webp({ quality: WEBP_QUALITY }).toBuffer(),
  ]);
  return { jpg, webp };
}

function createStagingTargetKey(
  item: { sourceProductKey: string; resolutionType: ApprovedStagingResolution; approvedLocalProductId?: string | null; title: string },
): string {
  if (item.resolutionType === "map_to_existing") {
    return `existing/${item.approvedLocalProductId}`;
  }
  const baseSlug = item.sourceProductKey.split("--")[0];
  const targetId = sanitizePathSegment(baseSlug) || sanitizePathSegment(item.title) || "candidate";
  return `new/${targetId}`;
}

function createStagingOutputDir(outputRoot: string, runId: string, stagingTargetKey: string): string {
  const productId = sanitizePathSegment(
    stagingTargetKey.replace(/^new\//, "").replace(/^existing\//, ""),
  );
  if (!productId) throw new Error(`Malformed stagingTargetKey: ${stagingTargetKey}`);
  return assertInsideAllowedRoot(
    path.join(outputRoot, runId, "products", productId),
    ALLOWED_STAGING_ROOT,
    "staging output directory",
  );
}

function plannedOutputsForItem(outputRoot: string, runId: string, item: ApprovedStagingItem): string[] {
  const outputDir = createStagingOutputDir(outputRoot, runId, item.stagingTargetKey);
  return item.sourceImagePaths.flatMap((_, index) => {
    const slot = index === 0 ? "cover" : String(index).padStart(2, "0");
    return [
      toPortablePath(path.relative(process.cwd(), path.join(outputDir, `${slot}.jpg`))),
      toPortablePath(path.relative(process.cwd(), path.join(outputDir, `${slot}.webp`))),
    ];
  });
}

function computeSummary(items: StagingExecutionItem[], totalApprovedItems: number, validateOnly: boolean): StagingExecutionSummary {
  return {
    totalApprovedItems,
    selectedItems: items.length,
    stagedItems: items.filter((item) => item.status === "staged").length,
    failedItems: items.filter((item) => item.status === "failed").length,
    skippedItems: items.filter((item) => item.status === "skipped").length,
    validateOnly,
    producedOutputs: items.reduce((count, item) => count + item.producedOutputs.length, 0),
  };
}

function loadArtifacts(input: ApprovedStagingExecutorInput): {
  dataset: SourceDatasetManifest;
  products: SourceProductRecord[];
  curation: CurationReport;
  review: NormalizedReviewDecisionManifest;
} {
  const sourceRoot = input.sourceRoot ?? path.join("tmp", "source-datasets");
  const curationDir = input.curationDir ?? path.join("tmp", "curation");
  const reviewDir = input.reviewDir ?? path.join("tmp", "review-decisions");
  const reviewRunId = input.reviewRunId ?? input.runId;
  const runDir = path.join(sourceRoot, input.runId);
  const datasetPath = path.join(runDir, "dataset.json");
  const productsPath = path.join(runDir, "products.json");
  const curationPath = path.join(curationDir, `${input.runId}.curation.json`);
  const reviewPath = path.join(reviewDir, `${reviewRunId}.review.json`);

  assertFileExists(datasetPath, "source dataset");
  assertFileExists(productsPath, "source products");
  assertFileExists(curationPath, "curation report");
  assertFileExists(reviewPath, "review manifest");

  const dataset = readJsonFile<SourceDatasetManifest>(datasetPath, "source dataset");
  const products = readJsonFile<SourceProductRecord[]>(productsPath, "source products");
  const curation = readJsonFile<CurationReport>(curationPath, "curation report");
  const review = normalizeApprovedManifest(readJsonFile<unknown>(reviewPath, "review manifest"));

  if (dataset.runId !== input.runId) throw new Error(`run id mismatch in dataset artifact: expected ${input.runId}, received ${dataset.runId}`);
  if (curation.runId !== input.runId) throw new Error(`run id mismatch in curation artifact: expected ${input.runId}, received ${curation.runId}`);
  if (review.runId !== reviewRunId) throw new Error(`run id mismatch in review artifact: expected ${reviewRunId}, received ${review.runId}`);
  if (review.sourceRunId !== dataset.runId || curation.sourceRunId !== dataset.runId) {
    throw new Error(`sourceRunId mismatch across source/curation/review artifacts for run ${input.runId}`);
  }
  if (!Array.isArray(products)) throw new Error(`Invalid source products artifact: ${productsPath}`);
  if (products.length !== dataset.productCount) {
    throw new Error(`dataset productCount mismatch: dataset=${dataset.productCount} products=${products.length}`);
  }

  return { dataset, products, curation, review };
}

function buildApprovedItems(input: ApprovedStagingExecutorInput): { approvedItems: ApprovedStagingItem[]; totalApprovedItems: number; sourceRunId: string } {
  const { dataset, products, curation, review } = loadArtifacts(input);
  const sourceRoot = input.sourceRoot ?? path.join("tmp", "source-datasets");
  const approvedDecisions = review.decisions.filter((decision) => decision.decision === "approved");
  const localCatalogIds = new Set(loadLocalCatalog().map((product) => product.id));
  const sourceByKey = new Map(products.map((product) => [product.sourceProductKey, product]));
  const curationByKey = new Map(curation.items.map((item) => [item.sourceProductKey, item]));
  const seenTargets = new Set<string>();

  const approvedItems = approvedDecisions.map<ApprovedStagingItem>((decision) => {
    const curatedItem = curationByKey.get(decision.sourceProductKey);
    const sourceProduct = sourceByKey.get(decision.sourceProductKey);
    if (!curatedItem) throw new Error(`Approved review item missing from curation report: ${decision.sourceProductKey}`);
    if (!sourceProduct) throw new Error(`Approved review item missing from source products: ${decision.sourceProductKey}`);
    if (!curatedItem.requiresHumanReview && curatedItem.curationDecision !== "ACCEPT_CANDIDATE") {
      throw new Error(`Approved review item is not curation-eligible for staging: ${decision.sourceProductKey}`);
    }
    if (!decision.resolutionType) throw new Error(`Approved decision must declare resolutionType for ${decision.sourceProductKey}`);
    if (decision.resolutionType === "map_to_existing") {
      if (!decision.approvedLocalProductId) {
        throw new Error(`map_to_existing requires approvedLocalProductId for ${decision.sourceProductKey}`);
      }
      if (!localCatalogIds.has(decision.approvedLocalProductId)) {
        throw new Error(`approvedLocalProductId does not exist in local catalog for ${decision.sourceProductKey}: ${decision.approvedLocalProductId}`);
      }
    }
    if (decision.resolutionType === "new_candidate" && decision.approvedLocalProductId) {
      throw new Error(`new_candidate must not carry approvedLocalProductId for ${decision.sourceProductKey}`);
    }

    const imageRootCandidates = [
      {
        label: "ingested images root",
        root: path.resolve(path.join("tmp", "source-images", dataset.runId)),
        basePath: process.cwd(),
        paths: sourceProduct.ingestedImagePaths ?? [],
      },
      {
        label: "source dataset images root",
        root: path.resolve(path.join(sourceRoot, dataset.runId, dataset.imagesPath)),
        basePath: path.join(sourceRoot, dataset.runId),
        paths: sourceProduct.downloadedImages ?? [],
      },
    ].filter((candidate) => candidate.paths.length > 0);

    const selectedImageCandidate = imageRootCandidates[0];
    const sourceImagePaths = (selectedImageCandidate?.paths ?? []).map((imagePath) => {
      if (typeof imagePath !== "string" || !isSafeRelativeImagePath(imagePath)) {
        throw new Error(`Malformed source image path for ${decision.sourceProductKey}: ${String(imagePath)}`);
      }
      const resolved = path.resolve(path.join(selectedImageCandidate.basePath, imagePath));
      if (!isPathInside(selectedImageCandidate.root, resolved)) {
        throw new Error(`Source image path escapes images root for ${decision.sourceProductKey}: ${imagePath}`);
      }
      if (!fs.existsSync(resolved)) throw new Error(`Missing source image for ${decision.sourceProductKey}: ${imagePath}`);
      return resolved;
    });

    const hasAlignedRoleHints = sourceProduct.imageUrls.length >= sourceImagePaths.length;
    const sourceImageRoleHints = sourceImagePaths.map((_, index) => {
      if (!hasAlignedRoleHints) return sourceProduct.imageUrls[index] ?? null;
      return sourceProduct.imageUrls[index] ?? null;
    });

    if (sourceImagePaths.length < 1) throw new Error(`Approved item has no source images: ${decision.sourceProductKey}`);
    const stagingTargetKey = createStagingTargetKey({
      sourceProductKey: decision.sourceProductKey,
      resolutionType: decision.resolutionType,
      approvedLocalProductId: decision.approvedLocalProductId ?? null,
      title: sourceProduct.title,
    });

    if (seenTargets.has(stagingTargetKey)) {
      throw new Error(`Staging target collision detected: ${stagingTargetKey}`);
    }
    seenTargets.add(stagingTargetKey);

    return {
      sourceProductKey: decision.sourceProductKey,
      sourceRunId: dataset.runId,
      reviewRunId: review.runId,
      resolutionType: decision.resolutionType,
      approvedLocalProductId: decision.approvedLocalProductId ?? null,
      sourceImagePaths,
      sourceImageRoleHints,
      sourceUrl: sourceProduct.sourceUrl,
      title: sourceProduct.title,
      imageCount: sourceImagePaths.length,
      stagingTargetKey,
    };
  });

  const ordered = approvedItems.sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
  return {
    totalApprovedItems: ordered.length,
    approvedItems: input.limit ? ordered.slice(0, input.limit) : ordered,
    sourceRunId: dataset.runId,
  };
}

async function stageItem(runId: string, outputRoot: string, item: ApprovedStagingItem, validateOnly: boolean): Promise<StagingExecutionItem> {
  const ordering = resolveGalleryImageOrder(item.sourceImagePaths.map((sourcePath, originalIndex) => ({
    sourcePath,
    originalIndex,
    roleHintPath: item.sourceImageRoleHints?.[originalIndex] ?? undefined,
  })));
  const orderedSourcePaths = ordering.ordered.map((entry) => entry.sourcePath);
  const itemWithResolvedOrdering: ApprovedStagingItem = { ...item, sourceImagePaths: orderedSourcePaths };
  const plannedOutputs = plannedOutputsForItem(outputRoot, runId, itemWithResolvedOrdering);
  const execution: StagingExecutionItem = {
    sourceProductKey: item.sourceProductKey,
    resolutionType: item.resolutionType,
    approvedLocalProductId: item.approvedLocalProductId,
    stagingTargetKey: item.stagingTargetKey,
    plannedOutputs,
    producedOutputs: [],
    status: "skipped",
    reasonCodes: validateOnly ? ["validate_only"] : [],
  };

  try {
    if (ordering.status !== "ok") {
      execution.status = "failed";
      execution.reasonCodes.push("review_required_no_safe_hero");
      execution.errorMessage = ordering.reason;
      return execution;
    }
    if (validateOnly) {
      if (orderedSourcePaths.join("\n") !== item.sourceImagePaths.join("\n")) execution.reasonCodes.push("role_order_applied");
      if (ordering.ordered.some((entry, index) => entry.role === "size_chart" && index > 0)) execution.reasonCodes.push("size_chart_deprioritized");
      execution.status = "skipped";
      return execution;
    }

    if (orderedSourcePaths.join("\n") !== item.sourceImagePaths.join("\n")) execution.reasonCodes.push("role_order_applied");
    if (ordering.ordered.some((entry, index) => entry.role === "size_chart" && index > 0)) execution.reasonCodes.push("size_chart_deprioritized");

    for (let index = 0; index < itemWithResolvedOrdering.sourceImagePaths.length; index++) {
      const sourceImagePath = itemWithResolvedOrdering.sourceImagePaths[index];
      const slot = index === 0 ? "cover" : String(index).padStart(2, "0");
      const outputDir = createStagingOutputDir(outputRoot, runId, item.stagingTargetKey);
      const outputBase = path.join(outputDir, slot);
      const { jpg, webp } = await renderOutputsWithSharp(sourceImagePath);

      const jpgPath = `${outputBase}.jpg`;
      const webpPath = `${outputBase}.webp`;
      await ensureWritableDir(path.dirname(jpgPath), ALLOWED_STAGING_ROOT);
      await fs.promises.writeFile(jpgPath, jpg);
      await fs.promises.writeFile(webpPath, webp);

      execution.producedOutputs.push(
        toPortablePath(path.relative(process.cwd(), jpgPath)),
        toPortablePath(path.relative(process.cwd(), webpPath)),
      );
    }

    execution.status = "staged";
    return execution;
  } catch (error) {
    execution.status = "failed";
    execution.reasonCodes.push("stage_failed");
    execution.errorMessage = error instanceof Error ? error.message : String(error);
    return execution;
  }
}

export async function runApprovedStagingExecutor(input: ApprovedStagingExecutorInput): Promise<ApprovedStagingExecutorOutput> {
  if (!input.runId?.trim()) throw new Error("Missing runId");
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  const outputRoot = assertInsideAllowedRoot(input.outputDir ?? path.join("tmp", "agent-staging"), ALLOWED_STAGING_ROOT, "staging output");
  const manifestRoot = assertInsideAllowedRoot(input.manifestDir ?? path.join("tmp", "agent-manifests"), ALLOWED_MANIFEST_ROOT, "manifest output");
  const reviewRunId = input.reviewRunId ?? input.runId;

  await ensureWritableDir(outputRoot, ALLOWED_STAGING_ROOT);
  await ensureWritableDir(manifestRoot, ALLOWED_MANIFEST_ROOT);

  const { approvedItems, totalApprovedItems, sourceRunId } = buildApprovedItems(input);
  const executionItems: StagingExecutionItem[] = [];
  for (const item of approvedItems) {
    executionItems.push(await stageItem(input.runId, outputRoot, item, input.validateOnly === true));
  }

  const report: StagingExecutionReport = {
    runId: input.runId,
    sourceRunId,
    reviewRunId,
    createdAt: new Date().toISOString(),
    summary: computeSummary(executionItems, totalApprovedItems, input.validateOnly === true),
    items: executionItems,
  };

  const reportPath = path.join(manifestRoot, `${input.runId}.staging.json`);
  const summaryPath = path.join(manifestRoot, `${input.runId}.staging-summary.md`);
  const summaryMarkdown = renderSummaryMarkdown(report);

  await safeWriteJson(reportPath, report, ALLOWED_MANIFEST_ROOT);
  await safeWriteText(summaryPath, summaryMarkdown, ALLOWED_MANIFEST_ROOT);

  return { approvedItems, report, reportPath, summaryPath };
}
