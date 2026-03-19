import fs from "node:fs";
import path from "node:path";
import { deriveProductFingerprints } from "./delta-engine.ts";
import { DEFAULT_CATALOG_INDEX_PATH, loadLocalCatalog, readCatalogIndex } from "./catalog-index.ts";
import { reconcileSourceProducts } from "./reconciliation-agent.ts";
import type { AuditChainRecord } from "./audit-chain.ts";
import type { CurationDecision, CurationItem, CurationMode, CurationReport, CurationSummary, ReviewIssueType, ReviewQueueItem } from "./curation-types.ts";
import type { ReconciliationFilters, ReconciliationLimits } from "./reconciliation-types.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./source-dataset.ts";

export type CurationAgentInput = {
  runId: string;
  mode: CurationMode;
  category?: string;
  limit?: number;
  outputDir: string;
  sourceRoot?: string;
  indexPath?: string;
  reviewDecisionDir?: string;
};

export type CurationAgentOutput = {
  report: CurationReport;
  reviewQueue: ReviewQueueItem[];
  reportPath: string;
  reviewQueuePath: string;
  summaryPath: string;
};

const DEFAULT_LIMITS: ReconciliationLimits = {
  maxCandidatesPerRun: Number.MAX_SAFE_INTEGER,
  maxNewPerRun: Number.MAX_SAFE_INTEGER,
  maxChangedPerRun: Number.MAX_SAFE_INTEGER,
  maxReviewPerRun: Number.MAX_SAFE_INTEGER,
  maxUnchangedToInspectPerRun: Number.MAX_SAFE_INTEGER,
};

function readJsonFile<T>(targetPath: string, label: string): T {
  try {
    const raw = fs.readFileSync(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertFileExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing required artifact: ${label} at ${targetPath}`);
  }
}

function hasStableSourceIdentity(product: SourceProductRecord): { ok: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!product.sourceProductKey) reasonCodes.push("missing_source_product_key");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*--[a-f0-9]{10}$/i.test(product.sourceProductKey)) reasonCodes.push("invalid_source_product_key");
  if (!product.sourceSlug?.trim()) reasonCodes.push("missing_source_slug");
  if (!product.sourceUrl?.trim()) reasonCodes.push("missing_source_url");
  if (!product.title?.trim()) reasonCodes.push("missing_title");
  if ((product.downloadedImages?.length ?? 0) < 1) reasonCodes.push("missing_images");
  return { ok: reasonCodes.length === 0, reasonCodes };
}

function dedupeReasonCodes(reasonCodes: string[]): string[] {
  return Array.from(new Set(reasonCodes));
}

function toReviewIssueType(reasonCodes: string[]): ReviewIssueType {
  if (reasonCodes.includes("run_id_mismatch")) return "RUN_ID_MISMATCH";
  if (reasonCodes.includes("multiple_close_candidates") || reasonCodes.includes("local_product_collision")) return "AMBIGUOUS_MAPPING";
  if (reasonCodes.includes("no_strong_candidate")) return "WEAK_SIGNAL";
  return "RECONCILIATION_REVIEW";
}

function buildHumanAction(issueType: ReviewIssueType, proposedLocalProductId: string | null): string {
  if (issueType === "AMBIGUOUS_MAPPING") return "Choose the correct local product mapping or reject the candidate.";
  if (issueType === "WEAK_SIGNAL") return proposedLocalProductId
    ? "Verify that the proposed mapping is truly the same product before allowing staging."
    : "Decide whether this source item should map to an existing local product or remain rejected.";
  if (issueType === "RUN_ID_MISMATCH") return "Investigate artifact integrity before any downstream processing.";
  return "Review reconciliation notes and approve or reject the candidate manually.";
}

function computeSummary(items: CurationItem[]): CurationSummary {
  return items.reduce<CurationSummary>((summary, item) => {
    summary.totalItems += 1;
    if (item.curationDecision === "ACCEPT_CANDIDATE") summary.acceptedCandidates += 1;
    if (item.curationDecision === "REVIEW_REQUIRED") summary.reviewRequired += 1;
    if (item.curationDecision === "REJECTED") summary.rejected += 1;
    if (item.proposedLocalProductId) summary.deterministicMatches += 1;
    if (item.curationDecision === "ACCEPT_CANDIDATE" && !item.proposedLocalProductId) summary.proposedNewCandidates += 1;
    if (item.reasonCodes.some((code) => ["brand_not_zle", "missing_source_product_key", "invalid_source_product_key", "missing_source_slug", "missing_source_url", "missing_title", "missing_images"].includes(code))) {
      summary.malformedRejected += 1;
    }
    return summary;
  }, {
    totalItems: 0,
    acceptedCandidates: 0,
    reviewRequired: 0,
    rejected: 0,
    deterministicMatches: 0,
    proposedNewCandidates: 0,
    malformedRejected: 0,
  });
}

function renderSummaryMarkdown(report: CurationReport, reviewQueue: ReviewQueueItem[]): string {
  const lines = [
    `# TotalBoardShop Curation Summary`,
    "",
    `- Run ID: ${report.runId}`,
    `- Source Run ID: ${report.sourceRunId}`,
    `- Created At: ${report.createdAt}`,
    `- Mode: ${report.mode}`,
    "",
    "## Summary Counts",
    `- Total items: ${report.summary.totalItems}`,
    `- Accepted candidates: ${report.summary.acceptedCandidates}`,
    `- Review required: ${report.summary.reviewRequired}`,
    `- Rejected: ${report.summary.rejected}`,
    `- Deterministic matches: ${report.summary.deterministicMatches}`,
    `- Accepted new candidates: ${report.summary.proposedNewCandidates}`,
    `- Malformed rejected: ${report.summary.malformedRejected}`,
    `- Review queue items: ${reviewQueue.length}`,
    "",
    "## Layer Guardrails",
    "- This run is review-first only.",
    "- No publish action was executed.",
    "- No staging action was executed.",
    "- No writes were made outside tmp/curation and tmp/review-decisions.",
  ];
  return `${lines.join("\n")}\n`;
}

export async function runCurationAgent(input: CurationAgentInput): Promise<CurationAgentOutput> {
  const sourceRoot = input.sourceRoot ?? path.join("tmp", "source-datasets");
  const indexPath = input.indexPath ?? DEFAULT_CATALOG_INDEX_PATH;
  const runDir = path.join(sourceRoot, input.runId);
  const datasetPath = path.join(runDir, "dataset.json");

  assertFileExists(datasetPath, "dataset");
  const dataset = readJsonFile<SourceDatasetManifest>(datasetPath, "dataset");
  if (dataset.runId !== input.runId) throw new Error(`run id mismatch in dataset artifact: expected ${input.runId}, received ${dataset.runId}`);

  const productsPath = path.join(runDir, dataset.productsPath);
  const auditPath = path.join(runDir, dataset.auditPath);
  assertFileExists(productsPath, "products");
  assertFileExists(auditPath, "audit");

  const products = readJsonFile<SourceProductRecord[]>(productsPath, "products");
  const audit = readJsonFile<AuditChainRecord>(auditPath, "audit");

  if (!Array.isArray(products)) throw new Error(`Invalid products artifact: ${productsPath}`);
  if (audit.runId !== input.runId) throw new Error(`run id mismatch in audit artifact: expected ${input.runId}, received ${audit.runId}`);
  if (products.length !== dataset.productCount) throw new Error(`dataset productCount mismatch: dataset=${dataset.productCount} products=${products.length}`);

  const filters: ReconciliationFilters = {
    category: input.category,
    limit: input.limit,
  };

  const index = await readCatalogIndex(indexPath);
  const localCatalog = loadLocalCatalog();
  const { report: reconciliationReport } = reconcileSourceProducts({
    runId: input.runId,
    mode: input.mode,
    sourceProducts: products,
    localCatalog,
    index,
    limits: DEFAULT_LIMITS,
    filters,
    lastDecision: null,
  });

  const sourceByKey = new Map(products.map((product) => [product.sourceProductKey, product]));
  const curatedItems: CurationItem[] = [];
  const reviewQueue: ReviewQueueItem[] = [];

  for (const reconciliationItem of reconciliationReport.items) {
    const source = sourceByKey.get(reconciliationItem.sourceProductKey);
    if (!source) {
      throw new Error(`Missing source product for reconciliation item: ${reconciliationItem.sourceProductKey}`);
    }

    const fingerprints = deriveProductFingerprints(source);
    const sourceIdentity = hasStableSourceIdentity(source);
    const baseReasonCodes = dedupeReasonCodes([...reconciliationItem.reasonCodes]);

    let curationDecision: CurationDecision;
    const reasonCodes = [...baseReasonCodes];

    if (source.brandNormalized !== "zle") {
      curationDecision = "REJECTED";
      reasonCodes.push("brand_not_zle");
    } else if (!sourceIdentity.ok) {
      curationDecision = "REJECTED";
      reasonCodes.push(...sourceIdentity.reasonCodes);
    } else if (reconciliationItem.reconciliation === "REVIEW") {
      curationDecision = "REVIEW_REQUIRED";
      reasonCodes.push("reconciliation_review");
    } else if (reasonCodes.includes("multiple_close_candidates") || reasonCodes.includes("local_product_collision")) {
      curationDecision = "REVIEW_REQUIRED";
      reasonCodes.push("ambiguous_mapping_signal");
    } else if (!reconciliationItem.matchedLocalProductId && reasonCodes.includes("no_strong_candidate") && reconciliationItem.delta !== "NEW") {
      curationDecision = "REVIEW_REQUIRED";
      reasonCodes.push("weak_signal_requires_review");
    } else {
      curationDecision = "ACCEPT_CANDIDATE";
      reasonCodes.push(reconciliationItem.matchedLocalProductId ? "accepted_deterministic_match" : "accepted_valid_new_candidate");
    }

    const dedupedReasonCodes = dedupeReasonCodes(reasonCodes);
    const item: CurationItem = {
      sourceProductKey: source.sourceProductKey,
      sourceUrl: source.sourceUrl,
      title: source.title,
      brandNormalized: source.brandNormalized,
      categoryRaw: source.categoryRaw,
      structured: source.structured,
      priceCzk: source.priceCzk,
      sizes: [...source.sizes],
      imageCount: source.downloadedImages.length,
      proposedLocalProductId: reconciliationItem.matchedLocalProductId,
      reconciliation: reconciliationItem.reconciliation,
      delta: reconciliationItem.delta,
      curationDecision,
      reasonCodes: dedupedReasonCodes,
      requiresHumanReview: curationDecision === "REVIEW_REQUIRED",
      fingerprints: {
        identityFingerprint: fingerprints.identityFingerprint,
        contentFingerprint: fingerprints.contentFingerprint,
        imageFingerprint: fingerprints.imageFingerprint,
      },
    };
    curatedItems.push(item);

    if (item.requiresHumanReview) {
      const issueType = toReviewIssueType(item.reasonCodes);
      reviewQueue.push({
        sourceProductKey: item.sourceProductKey,
        sourceUrl: item.sourceUrl,
        title: item.title,
        proposedLocalProductId: item.proposedLocalProductId,
        issueType,
        reasonCodes: item.reasonCodes,
        humanActionRequired: buildHumanAction(issueType, item.proposedLocalProductId),
      });
    }
  }

  const createdAt = new Date().toISOString();
  const report: CurationReport = {
    runId: input.runId,
    sourceRunId: dataset.runId,
    createdAt,
    mode: input.mode,
    summary: computeSummary(curatedItems),
    items: curatedItems,
  };

  await fs.promises.mkdir(input.outputDir, { recursive: true });
  const reportPath = path.join(input.outputDir, `${input.runId}.curation.json`);
  const reviewQueuePath = path.join(input.outputDir, `${input.runId}.review-queue.json`);
  const summaryPath = path.join(input.outputDir, `${input.runId}.summary.md`);

  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await fs.promises.writeFile(reviewQueuePath, JSON.stringify(reviewQueue, null, 2), "utf8");
  await fs.promises.writeFile(summaryPath, renderSummaryMarkdown(report, reviewQueue), "utf8");

  return { report, reviewQueue, reportPath, reviewQueuePath, summaryPath };
}
