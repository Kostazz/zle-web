import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadLocalCatalog } from "./catalog-index.ts";
import type { CurationItem, CurationReport, ReviewQueueItem } from "./curation-types.ts";

export type ReviewDecisionStatus = "approved" | "rejected" | "hold";
export type ReviewResolutionType = "map_to_existing" | "new_candidate";

export type ReviewDecisionEntry = {
  sourceProductKey: string;
  decision: ReviewDecisionStatus;
  resolutionType: ReviewResolutionType | null;
  approvedLocalProductId?: string;
  operatorNotes?: string;
};

export type ReviewDecisionManifest = {
  runId: string;
  createdAt: string;
  sourceRunId: string;
  decisions: ReviewDecisionEntry[];
};

export type ReviewDecisionSummary = {
  totalReviewedItems: number;
  approvedCount: number;
  rejectedCount: number;
  holdCount: number;
  approvalsMappedToExisting: number;
  approvalsMarkedAsNewCandidate: number;
  validationWarnings: string[];
  validationErrors: string[];
};

export type ReviewDecisionAgentInput = {
  runId: string;
  inputPath?: string;
  curationDir?: string;
  outputDir?: string;
  writeTemplate?: boolean;
};

export type ReviewDecisionAgentOutput = {
  report: CurationReport;
  reviewQueue: ReviewQueueItem[];
  manifest: ReviewDecisionManifest;
  summary: ReviewDecisionSummary;
  summaryMarkdown: string;
  manifestPath: string;
  summaryPath: string;
};

const ALLOWED_OUTPUT_ROOT = path.resolve("tmp", "review-decisions");
const ALLOWED_DECISION_STATUSES = new Set<ReviewDecisionStatus>(["approved", "rejected", "hold"]);
const ALLOWED_RESOLUTION_TYPES = new Set<ReviewResolutionType>(["map_to_existing", "new_candidate"]);

const reviewDecisionEntrySchema = z.object({
  sourceProductKey: z.string().min(1),
  decision: z.enum(["approved", "rejected", "hold"]),
  resolutionType: z.union([z.enum(["map_to_existing", "new_candidate"]), z.null()]),
  approvedLocalProductId: z.string().min(1).optional(),
  operatorNotes: z.string().optional(),
}).strict();

const reviewDecisionManifestSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  sourceRunId: z.string().min(1),
  decisions: z.array(reviewDecisionEntrySchema),
}).strict();

function readJsonFile(targetPath: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertFileExists(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing required artifact: ${label} at ${targetPath}`);
  }
}

function normalizeOutputDir(outputDir: string): string {
  const resolved = path.resolve(outputDir);
  const relative = path.relative(ALLOWED_OUTPUT_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside tmp/review-decisions: ${outputDir}`);
  }
  return resolved;
}

function normalizeDecisionEntry(entry: ReviewDecisionEntry): ReviewDecisionEntry {
  const normalized: ReviewDecisionEntry = {
    sourceProductKey: entry.sourceProductKey,
    decision: entry.decision,
    resolutionType: entry.resolutionType,
  };

  if (entry.approvedLocalProductId) normalized.approvedLocalProductId = entry.approvedLocalProductId;
  if (entry.operatorNotes && entry.operatorNotes.trim()) normalized.operatorNotes = entry.operatorNotes.trim();
  return normalized;
}

function sortDecisionEntries(entries: ReviewDecisionEntry[]): ReviewDecisionEntry[] {
  return [...entries]
    .map(normalizeDecisionEntry)
    .sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
}

function summarizeManifest(manifest: ReviewDecisionManifest, validationErrors: string[] = [], validationWarnings: string[] = []): ReviewDecisionSummary {
  const approved = manifest.decisions.filter((entry) => entry.decision === "approved");
  return {
    totalReviewedItems: manifest.decisions.length,
    approvedCount: approved.length,
    rejectedCount: manifest.decisions.filter((entry) => entry.decision === "rejected").length,
    holdCount: manifest.decisions.filter((entry) => entry.decision === "hold").length,
    approvalsMappedToExisting: approved.filter((entry) => entry.resolutionType === "map_to_existing").length,
    approvalsMarkedAsNewCandidate: approved.filter((entry) => entry.resolutionType === "new_candidate").length,
    validationWarnings,
    validationErrors,
  };
}

function renderSummaryMarkdown(runId: string, manifest: ReviewDecisionManifest, summary: ReviewDecisionSummary): string {
  const lines = [
    `# TotalBoardShop Review Decision Summary`,
    "",
    `- Run ID: ${runId}`,
    `- Source Run ID: ${manifest.sourceRunId}`,
    `- Created At: ${manifest.createdAt}`,
    "",
    "## Summary Counts",
    `- Total reviewed items: ${summary.totalReviewedItems}`,
    `- Approved count: ${summary.approvedCount}`,
    `- Rejected count: ${summary.rejectedCount}`,
    `- Hold count: ${summary.holdCount}`,
    `- Approvals mapped to existing: ${summary.approvalsMappedToExisting}`,
    `- Approvals marked as new_candidate: ${summary.approvalsMarkedAsNewCandidate}`,
    "",
    "## Guardrails",
    "- This manifest is the authoritative human review checkpoint for downstream staging eligibility.",
    "- Validation fails closed on ambiguous, duplicate, malformed, or out-of-contract decisions.",
    "- No staging action was executed.",
    "- No publish action was executed.",
    "- No writes were made outside tmp/review-decisions.",
  ];

  if (summary.validationWarnings.length > 0) {
    lines.push("", "## Validation Warnings", ...summary.validationWarnings.map((warning) => `- ${warning}`));
  }

  if (summary.validationErrors.length > 0) {
    lines.push("", "## Validation Errors", ...summary.validationErrors.map((error) => `- ${error}`));
  }

  return `${lines.join("\n")}\n`;
}

function loadArtifacts(runId: string, curationDir: string): { report: CurationReport; reviewQueue: ReviewQueueItem[] } {
  const reportPath = path.join(curationDir, `${runId}.curation.json`);
  const reviewQueuePath = path.join(curationDir, `${runId}.review-queue.json`);
  assertFileExists(reportPath, "curation report");
  assertFileExists(reviewQueuePath, "review queue");

  const report = readJsonFile(reportPath, "curation report") as CurationReport;
  const reviewQueue = readJsonFile(reviewQueuePath, "review queue") as ReviewQueueItem[];

  if (report.runId !== runId) throw new Error(`run id mismatch in curation report: expected ${runId}, received ${report.runId}`);
  if (!Array.isArray(report.items)) throw new Error(`Invalid curation report items: ${reportPath}`);
  if (!Array.isArray(reviewQueue)) throw new Error(`Invalid review queue content: ${reviewQueuePath}`);

  return { report, reviewQueue };
}

function isReviewEligible(item: CurationItem): boolean {
  return item.requiresHumanReview || item.curationDecision === "ACCEPT_CANDIDATE";
}

function constructTemplateManifest(report: CurationReport): ReviewDecisionManifest {
  const decisions = report.items
    .filter(isReviewEligible)
    .map<ReviewDecisionEntry>((item) => ({
      sourceProductKey: item.sourceProductKey,
      decision: "hold",
      resolutionType: null,
    }));

  return {
    runId: report.runId,
    createdAt: new Date().toISOString(),
    sourceRunId: report.sourceRunId,
    decisions: sortDecisionEntries(decisions),
  };
}

function validateManifestShape(raw: unknown): ReviewDecisionManifest {
  const parsed = reviewDecisionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((entry) => `${entry.path.join(".") || "manifest"}: ${entry.message}`).join("; ");
    throw new Error(`Invalid review decision manifest shape: ${issue}`);
  }
  return {
    ...parsed.data,
    decisions: sortDecisionEntries(parsed.data.decisions),
  };
}

function validateAgainstCuration(report: CurationReport, manifest: ReviewDecisionManifest): void {
  if (manifest.runId !== report.runId) {
    throw new Error(`run id mismatch in review manifest: expected ${report.runId}, received ${manifest.runId}`);
  }
  if (manifest.sourceRunId !== report.sourceRunId) {
    throw new Error(`sourceRunId mismatch in review manifest: expected ${report.sourceRunId}, received ${manifest.sourceRunId}`);
  }

  const localCatalogIds = new Set(loadLocalCatalog().map((product) => product.id));
  const curationItems = new Map(report.items.map((item) => [item.sourceProductKey, item]));
  const eligibleSourceKeys = report.items.filter(isReviewEligible).map((item) => item.sourceProductKey);
  const seenSourceKeys = new Set<string>();
  const seenApprovedLocalProductIds = new Set<string>();

  for (const decision of manifest.decisions) {
    if (!ALLOWED_DECISION_STATUSES.has(decision.decision)) {
      throw new Error(`Invalid decision status for ${decision.sourceProductKey}: ${decision.decision}`);
    }
    if (decision.resolutionType !== null && !ALLOWED_RESOLUTION_TYPES.has(decision.resolutionType)) {
      throw new Error(`Invalid resolutionType for ${decision.sourceProductKey}: ${decision.resolutionType}`);
    }
    if (seenSourceKeys.has(decision.sourceProductKey)) {
      throw new Error(`Duplicate decision for sourceProductKey=${decision.sourceProductKey}`);
    }
    seenSourceKeys.add(decision.sourceProductKey);

    const curatedItem = curationItems.get(decision.sourceProductKey);
    if (!curatedItem) {
      throw new Error(`Decision references unknown sourceProductKey=${decision.sourceProductKey}`);
    }
    if (!isReviewEligible(curatedItem)) {
      throw new Error(`Decision targets non-review-eligible rejected item: ${decision.sourceProductKey}`);
    }

    if (decision.decision === "approved") {
      if (decision.resolutionType === null) {
        throw new Error(`Approved decision must declare resolutionType for ${decision.sourceProductKey}`);
      }
      if (decision.resolutionType === "map_to_existing") {
        if (!decision.approvedLocalProductId) {
          throw new Error(`map_to_existing requires approvedLocalProductId for ${decision.sourceProductKey}`);
        }
        if (!localCatalogIds.has(decision.approvedLocalProductId)) {
          throw new Error(`approvedLocalProductId does not exist in local catalog for ${decision.sourceProductKey}: ${decision.approvedLocalProductId}`);
        }
        if (seenApprovedLocalProductIds.has(decision.approvedLocalProductId)) {
          throw new Error(`Conflicting approvals map multiple source items to local product ${decision.approvedLocalProductId}`);
        }
        seenApprovedLocalProductIds.add(decision.approvedLocalProductId);
      } else if (decision.approvedLocalProductId) {
        throw new Error(`new_candidate must not carry approvedLocalProductId for ${decision.sourceProductKey}`);
      }
    }

    if (decision.decision !== "approved") {
      if (decision.resolutionType !== null) {
        throw new Error(`${decision.decision} must not carry resolutionType for ${decision.sourceProductKey}`);
      }
      if (decision.approvedLocalProductId) {
        throw new Error(`${decision.decision} must not carry approvedLocalProductId for ${decision.sourceProductKey}`);
      }
    }
  }

  if (manifest.decisions.length !== eligibleSourceKeys.length) {
    throw new Error(`Review manifest must include exactly one decision for each eligible item: expected ${eligibleSourceKeys.length}, received ${manifest.decisions.length}`);
  }

  for (const sourceProductKey of eligibleSourceKeys) {
    if (!seenSourceKeys.has(sourceProductKey)) {
      throw new Error(`Review manifest is missing decision for eligible sourceProductKey=${sourceProductKey}`);
    }
  }
}

async function writeManifestArtifacts(outputDir: string, manifest: ReviewDecisionManifest, summaryMarkdown: string): Promise<{ manifestPath: string; summaryPath: string }> {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${manifest.runId}.review.json`);
  const summaryPath = path.join(outputDir, `${manifest.runId}.summary.md`);
  await fs.promises.writeFile(manifestPath, JSON.stringify({ ...manifest, decisions: sortDecisionEntries(manifest.decisions) }, null, 2), "utf8");
  await fs.promises.writeFile(summaryPath, summaryMarkdown, "utf8");
  return { manifestPath, summaryPath };
}

export async function writeReviewDecisionTemplate(input: ReviewDecisionAgentInput): Promise<ReviewDecisionAgentOutput> {
  const curationDir = input.curationDir ?? path.join("tmp", "curation");
  const outputDir = normalizeOutputDir(input.outputDir ?? path.join("tmp", "review-decisions"));
  const { report, reviewQueue } = loadArtifacts(input.runId, curationDir);
  const manifest = constructTemplateManifest(report);
  const summary = summarizeManifest(manifest);
  const summaryMarkdown = renderSummaryMarkdown(input.runId, manifest, summary);
  const { manifestPath, summaryPath } = await writeManifestArtifacts(outputDir, manifest, summaryMarkdown);
  return { report, reviewQueue, manifest, summary, summaryMarkdown, manifestPath, summaryPath };
}

export async function validateReviewDecisionManifest(input: ReviewDecisionAgentInput): Promise<ReviewDecisionAgentOutput> {
  const curationDir = input.curationDir ?? path.join("tmp", "curation");
  const outputDir = normalizeOutputDir(input.outputDir ?? path.join("tmp", "review-decisions"));
  const { report, reviewQueue } = loadArtifacts(input.runId, curationDir);
  const manifestPath = input.inputPath ?? path.join(outputDir, `${input.runId}.review.json`);
  assertFileExists(manifestPath, "review decision manifest");

  const rawManifest = readJsonFile(manifestPath, "review decision manifest");
  const manifest = validateManifestShape(rawManifest);
  validateAgainstCuration(report, manifest);
  const summary = summarizeManifest(manifest);
  const summaryMarkdown = renderSummaryMarkdown(input.runId, manifest, summary);
  return {
    report,
    reviewQueue,
    manifest,
    summary,
    summaryMarkdown,
    manifestPath: path.join(outputDir, `${manifest.runId}.review.json`),
    summaryPath: path.join(outputDir, `${manifest.runId}.summary.md`),
  };
}

export async function runReviewDecisionAgent(input: ReviewDecisionAgentInput): Promise<ReviewDecisionAgentOutput> {
  const validated = await validateReviewDecisionManifest(input);
  const outputDir = normalizeOutputDir(input.outputDir ?? path.join("tmp", "review-decisions"));
  const { manifestPath, summaryPath } = await writeManifestArtifacts(outputDir, validated.manifest, validated.summaryMarkdown);
  return { ...validated, manifestPath, summaryPath };
}
