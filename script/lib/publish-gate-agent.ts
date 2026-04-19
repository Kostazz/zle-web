import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CurationReport } from "./curation-types.ts";
import type { PublishGateEligibilityStatus, PublishGateItem, PublishGateManifest, PublishGateSummary } from "./publish-gate-types.ts";
import type { StagingExecutionReport } from "./staging-review-types.ts";

export type PublishGateAgentInput = {
  runId: string;
  inputPath?: string;
  outputDir?: string;
  reviewDir?: string;
  stagingManifestDir?: string;
  curationDir?: string;
  writeTemplate?: boolean;
  validateOnly?: boolean;
};

export type PublishGateAgentOutput = {
  manifest: PublishGateManifest;
  summaryMarkdown: string;
  manifestPath?: string;
  summaryPath?: string;
};

const ALLOWED_OUTPUT_ROOT = path.resolve("tmp", "publish-gates");
const RELEASE_DECISIONS = ["ready_for_publish", "hold", "reject_release"] as const;
const releaseDecisionSchema = z.enum(RELEASE_DECISIONS);
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
  releaseDecision: releaseDecisionSchema,
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

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeOutputDir(outputDir: string): string {
  const resolved = path.resolve(outputDir);
  if (!isPathInside(ALLOWED_OUTPUT_ROOT, resolved)) {
    throw new Error(`Refusing to write outside tmp/publish-gates: ${outputDir}`);
  }
  return resolved;
}

function normalizeReasonCodes(reasonCodes: string[]): string[] {
  return Array.from(new Set(reasonCodes)).sort((a, b) => a.localeCompare(b));
}

function normalizeItem(item: PublishGateItem): PublishGateItem {
  return {
    sourceProductKey: item.sourceProductKey,
    sourceRunId: item.sourceRunId,
    reviewRunId: item.reviewRunId,
    stagingRunId: item.stagingRunId,
    resolutionType: item.resolutionType,
    approvedLocalProductId: item.approvedLocalProductId,
    stagingTargetKey: item.stagingTargetKey,
    plannedOutputs: [...item.plannedOutputs].sort((a, b) => a.localeCompare(b)),
    producedOutputs: [...item.producedOutputs].sort((a, b) => a.localeCompare(b)),
    eligibilityStatus: item.eligibilityStatus,
    reasonCodes: normalizeReasonCodes(item.reasonCodes),
    releaseDecision: item.releaseDecision,
    ...(item.operatorNotes && item.operatorNotes.trim() ? { operatorNotes: item.operatorNotes.trim() } : {}),
  };
}

function sortItems(items: PublishGateItem[]): PublishGateItem[] {
  return [...items].map(normalizeItem).sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
}

function computeSummary(items: PublishGateItem[]): PublishGateSummary {
  return {
    totalStagedItems: items.length,
    eligibleItems: items.filter((item) => item.eligibilityStatus === "eligible").length,
    blockedItems: items.filter((item) => item.eligibilityStatus === "blocked").length,
    readyForPublish: items.filter((item) => item.releaseDecision === "ready_for_publish").length,
    holdCount: items.filter((item) => item.releaseDecision === "hold").length,
    rejectReleaseCount: items.filter((item) => item.releaseDecision === "reject_release").length,
  };
}

function renderSummaryMarkdown(manifest: PublishGateManifest): string {
  const lines = [
    "# TotalBoardShop Publish Gate Summary",
    "",
    `- Run ID: ${manifest.runId}`,
    `- Source Run ID: ${manifest.sourceRunId}`,
    `- Review Run ID: ${manifest.reviewRunId}`,
    `- Staging Run ID: ${manifest.stagingRunId}`,
    `- Created At: ${manifest.createdAt}`,
    "",
    "## Summary Counts",
    `- Total staged items: ${manifest.summary.totalStagedItems}`,
    `- Eligible items: ${manifest.summary.eligibleItems}`,
    `- Blocked items: ${manifest.summary.blockedItems}`,
    `- Ready for publish: ${manifest.summary.readyForPublish}`,
    `- Hold count: ${manifest.summary.holdCount}`,
    `- Reject release count: ${manifest.summary.rejectReleaseCount}`,
    "",
    "## Guardrails",
    "- Review approval and release approval are separate checkpoints.",
    "- This layer never executes publish.",
    "- This layer never writes live assets.",
    "- Writes are restricted to tmp/publish-gates.",
    "- Validation fails closed on malformed, duplicate, blocked, or lineage-breaking inputs.",
  ];

  if (manifest.items.length > 0) {
    lines.push("", "## Item Outcomes");
    for (const item of manifest.items) {
      lines.push(`- ${item.sourceProductKey}: ${item.releaseDecision} (${item.eligibilityStatus}) -> ${item.stagingTargetKey}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function loadArtifacts(input: PublishGateAgentInput): {
  review: { runId: string; sourceRunId: string; decisions: Array<{ sourceProductKey: string; decision: string }> };
  staging: StagingExecutionReport;
  curation: CurationReport;
} {
  const reviewDir = input.reviewDir ?? path.join("tmp", "review-decisions");
  const stagingManifestDir = input.stagingManifestDir ?? path.join("tmp", "agent-manifests");
  const curationDir = input.curationDir ?? path.join("tmp", "curation");
  const reviewPath = path.join(reviewDir, `${input.runId}.review.json`);
  const stagingPath = path.join(stagingManifestDir, `${input.runId}.staging.json`);
  const curationPath = path.join(curationDir, `${input.runId}.curation.json`);

  assertFileExists(reviewPath, "review manifest");
  assertFileExists(stagingPath, "staging report");
  assertFileExists(curationPath, "curation report");

  const review = readJsonFile<{ runId: string; sourceRunId: string; decisions: Array<{ sourceProductKey: string; decision: string }> }>(reviewPath, "review manifest");
  const staging = readJsonFile<StagingExecutionReport>(stagingPath, "staging report");
  const curation = readJsonFile<CurationReport>(curationPath, "curation report");

  if (review.runId !== input.runId) throw new Error(`run id mismatch in review manifest: expected ${input.runId}, received ${review.runId}`);
  if (staging.runId !== input.runId) throw new Error(`run id mismatch in staging report: expected ${input.runId}, received ${staging.runId}`);
  if (curation.runId !== input.runId) throw new Error(`run id mismatch in curation report: expected ${input.runId}, received ${curation.runId}`);
  if (review.sourceRunId !== staging.sourceRunId || curation.sourceRunId !== staging.sourceRunId) {
    throw new Error(`sourceRunId mismatch across curation/review/staging artifacts for run ${input.runId}`);
  }

  return { review, staging, curation };
}

function evaluateEligibility(
  plannedOutputs: string[],
  producedOutputs: string[],
  baseReasonCodes: string[],
): { eligibilityStatus: PublishGateEligibilityStatus; reasonCodes: string[] } {
  const reasons = [...baseReasonCodes];
  const plannedSet = new Set(plannedOutputs);
  const producedSet = new Set(producedOutputs);
  if (producedOutputs.length < 1) reasons.push("missing_produced_outputs");
  if (plannedOutputs.length !== producedOutputs.length) reasons.push("planned_output_count_mismatch");
  if (plannedSet.size !== plannedOutputs.length || producedSet.size !== producedOutputs.length) reasons.push("duplicate_output_path");
  if (plannedOutputs.some((output) => !producedSet.has(output)) || producedOutputs.some((output) => !plannedSet.has(output))) {
    reasons.push("planned_vs_produced_mismatch");
  }

  const reasonCodes = normalizeReasonCodes(reasons);
  return {
    eligibilityStatus: reasonCodes.length > 0 ? "blocked" : "eligible",
    reasonCodes,
  };
}

function buildManifestFromArtifacts(input: PublishGateAgentInput): PublishGateManifest {
  const { review, staging, curation } = loadArtifacts(input);
  const approvedKeys = new Set(review.decisions.filter((decision) => decision.decision === "approved").map((decision) => decision.sourceProductKey));
  const curationByKey = new Map(curation.items.map((item) => [item.sourceProductKey, item]));
  const stagedItems = staging.items.filter((item) => item.status === "staged");

  const items = stagedItems.map<PublishGateItem>((item) => {
    if (!approvedKeys.has(item.sourceProductKey)) {
      throw new Error(`Staged item is not review-approved: ${item.sourceProductKey}`);
    }
    const curatedItem = curationByKey.get(item.sourceProductKey);
    if (!curatedItem) {
      throw new Error(`Staged item missing from curation report: ${item.sourceProductKey}`);
    }

    const eligibility = evaluateEligibility(item.plannedOutputs, item.producedOutputs, []);
    return {
      sourceProductKey: item.sourceProductKey,
      sourceRunId: staging.sourceRunId,
      reviewRunId: staging.reviewRunId,
      stagingRunId: staging.runId,
      resolutionType: item.resolutionType,
      approvedLocalProductId: item.approvedLocalProductId,
      stagingTargetKey: item.stagingTargetKey,
      plannedOutputs: item.plannedOutputs,
      producedOutputs: item.producedOutputs,
      eligibilityStatus: eligibility.eligibilityStatus,
      reasonCodes: eligibility.reasonCodes,
      releaseDecision: "hold",
    };
  });

  const orderedItems = sortItems(items);
  return {
    runId: input.runId,
    sourceRunId: staging.sourceRunId,
    reviewRunId: staging.reviewRunId,
    stagingRunId: staging.runId,
    createdAt: new Date().toISOString(),
    summary: computeSummary(orderedItems),
    items: orderedItems,
  };
}

function buildTemplateManifest(input: PublishGateAgentInput): PublishGateManifest {
  return buildManifestFromArtifacts(input);
}

function validateManifestShape(raw: unknown): PublishGateManifest {
  const parsed = publishGateManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((entry) => `${entry.path.join(".") || "manifest"}: ${entry.message}`).join("; ");
    throw new Error(`Invalid publish gate manifest shape: ${issue}`);
  }
  const items = sortItems(parsed.data.items);
  return {
    ...parsed.data,
    items,
    summary: computeSummary(items),
  };
}

function validateAgainstArtifacts(input: PublishGateAgentInput, manifest: PublishGateManifest): PublishGateManifest {
  const { review, staging, curation } = loadArtifacts(input);
  if (manifest.runId !== input.runId) throw new Error(`run id mismatch in publish gate manifest: expected ${input.runId}, received ${manifest.runId}`);
  if (manifest.sourceRunId !== staging.sourceRunId) throw new Error(`sourceRunId mismatch in publish gate manifest: expected ${staging.sourceRunId}, received ${manifest.sourceRunId}`);
  if (manifest.reviewRunId !== staging.reviewRunId) throw new Error(`reviewRunId mismatch in publish gate manifest: expected ${staging.reviewRunId}, received ${manifest.reviewRunId}`);
  if (manifest.stagingRunId !== staging.runId) throw new Error(`stagingRunId mismatch in publish gate manifest: expected ${staging.runId}, received ${manifest.stagingRunId}`);

  const approvedKeys = new Set(review.decisions.filter((decision) => decision.decision === "approved").map((decision) => decision.sourceProductKey));
  const stagedByKey = new Map(staging.items.filter((item) => item.status === "staged").map((item) => [item.sourceProductKey, item]));
  const curationKeys = new Set(curation.items.map((item) => item.sourceProductKey));
  const seenSourceKeys = new Set<string>();
  const seenTargets = new Map<string, string>();
  const seenOutputs = new Map<string, string>();

  for (const item of manifest.items) {
    if (seenSourceKeys.has(item.sourceProductKey)) throw new Error(`Duplicate release decision for sourceProductKey=${item.sourceProductKey}`);
    seenSourceKeys.add(item.sourceProductKey);

    if (!curationKeys.has(item.sourceProductKey)) throw new Error(`Publish gate item missing from curation lineage: ${item.sourceProductKey}`);
    if (!approvedKeys.has(item.sourceProductKey)) throw new Error(`Publish gate item is not review-approved: ${item.sourceProductKey}`);

    const stagedItem = stagedByKey.get(item.sourceProductKey);
    if (!stagedItem) throw new Error(`Publish gate item does not correspond to an existing staged item: ${item.sourceProductKey}`);

    const existingTargetOwner = seenTargets.get(item.stagingTargetKey);
    if (existingTargetOwner && existingTargetOwner !== item.sourceProductKey) {
      throw new Error(`Release batch target collision: ${item.stagingTargetKey} (${existingTargetOwner}, ${item.sourceProductKey})`);
    }
    seenTargets.set(item.stagingTargetKey, item.sourceProductKey);

    for (const output of item.producedOutputs) {
      const existingOutputOwner = seenOutputs.get(output);
      if (existingOutputOwner && existingOutputOwner !== item.sourceProductKey) {
        throw new Error(`Release batch live-name collision: ${output} (${existingOutputOwner}, ${item.sourceProductKey})`);
      }
      seenOutputs.set(output, item.sourceProductKey);
    }

    if (item.sourceRunId !== staging.sourceRunId) throw new Error(`sourceRunId mismatch for ${item.sourceProductKey}`);
    if (item.reviewRunId !== staging.reviewRunId) throw new Error(`reviewRunId mismatch for ${item.sourceProductKey}`);
    if (item.stagingRunId !== staging.runId) throw new Error(`stagingRunId mismatch for ${item.sourceProductKey}`);
    if (item.resolutionType !== stagedItem.resolutionType) throw new Error(`resolutionType mismatch for ${item.sourceProductKey}`);
    if ((item.approvedLocalProductId ?? null) !== (stagedItem.approvedLocalProductId ?? null)) {
      throw new Error(`approvedLocalProductId mismatch for ${item.sourceProductKey}`);
    }
    if (item.stagingTargetKey !== stagedItem.stagingTargetKey) throw new Error(`stagingTargetKey mismatch for ${item.sourceProductKey}`);

    const computedEligibility = evaluateEligibility(stagedItem.plannedOutputs, stagedItem.producedOutputs, []);
    if (item.plannedOutputs.join("\n") !== [...stagedItem.plannedOutputs].sort((a, b) => a.localeCompare(b)).join("\n")) {
      throw new Error(`plannedOutputs mismatch for ${item.sourceProductKey}`);
    }
    if (item.producedOutputs.join("\n") !== [...stagedItem.producedOutputs].sort((a, b) => a.localeCompare(b)).join("\n")) {
      throw new Error(`producedOutputs mismatch for ${item.sourceProductKey}`);
    }
    if (item.eligibilityStatus !== computedEligibility.eligibilityStatus) {
      throw new Error(`eligibilityStatus mismatch for ${item.sourceProductKey}: expected ${computedEligibility.eligibilityStatus}, received ${item.eligibilityStatus}`);
    }
    if (normalizeReasonCodes(item.reasonCodes).join("\n") !== computedEligibility.reasonCodes.join("\n")) {
      throw new Error(`reasonCodes mismatch for ${item.sourceProductKey}`);
    }
    if (item.releaseDecision === "ready_for_publish" && item.eligibilityStatus !== "eligible") {
      throw new Error(`ready_for_publish is only allowed for eligible items: ${item.sourceProductKey}`);
    }
  }

  if (manifest.items.length !== stagedByKey.size) {
    throw new Error(`Publish gate manifest must include exactly one item for each staged item: expected ${stagedByKey.size}, received ${manifest.items.length}`);
  }

  for (const sourceProductKey of Array.from(stagedByKey.keys())) {
    if (!seenSourceKeys.has(sourceProductKey)) throw new Error(`Publish gate manifest is missing staged item ${sourceProductKey}`);
  }

  const items = sortItems(manifest.items);
  return {
    runId: manifest.runId,
    sourceRunId: manifest.sourceRunId,
    reviewRunId: manifest.reviewRunId,
    stagingRunId: manifest.stagingRunId,
    createdAt: manifest.createdAt,
    summary: computeSummary(items),
    items,
  };
}

async function writeArtifacts(outputDir: string, manifest: PublishGateManifest, summaryMarkdown: string): Promise<{ manifestPath: string; summaryPath: string }> {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${manifest.runId}.publish-gate.json`);
  const summaryPath = path.join(outputDir, `${manifest.runId}.summary.md`);
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.promises.writeFile(summaryPath, summaryMarkdown, "utf8");
  return { manifestPath, summaryPath };
}

export async function writePublishGateTemplate(input: PublishGateAgentInput): Promise<PublishGateAgentOutput> {
  const outputDir = normalizeOutputDir(input.outputDir ?? path.join("tmp", "publish-gates"));
  const manifest = buildTemplateManifest(input);
  const summaryMarkdown = renderSummaryMarkdown(manifest);
  const { manifestPath, summaryPath } = await writeArtifacts(outputDir, manifest, summaryMarkdown);
  return { manifest, summaryMarkdown, manifestPath, summaryPath };
}

export async function validatePublishGateManifest(input: PublishGateAgentInput): Promise<PublishGateAgentOutput> {
  const rawManifestPath = input.inputPath ?? path.join(input.outputDir ?? path.join("tmp", "publish-gates"), `${input.runId}.publish-gate.json`);
  assertFileExists(rawManifestPath, "publish gate manifest");
  const manifest = validateAgainstArtifacts(input, validateManifestShape(readJsonFile<unknown>(rawManifestPath, "publish gate manifest")));
  return { manifest, summaryMarkdown: renderSummaryMarkdown(manifest) };
}

export async function runPublishGateAgent(input: PublishGateAgentInput): Promise<PublishGateAgentOutput> {
  const outputDir = normalizeOutputDir(input.outputDir ?? path.join("tmp", "publish-gates"));
  const manifest = validateAgainstArtifacts(input, validateManifestShape(buildManifestFromArtifacts(input)));
  const summaryMarkdown = renderSummaryMarkdown(manifest);
  const { manifestPath, summaryPath } = await writeArtifacts(outputDir, manifest, summaryMarkdown);
  return { manifest, summaryMarkdown, manifestPath, summaryPath };
}

export function formatPublishGateStdout(manifest: PublishGateManifest, mode: "write-template" | "validate-only" | "normalize"): string[] {
  return [
    `run ${manifest.runId}`,
    `source_run ${manifest.sourceRunId}`,
    `review_run ${manifest.reviewRunId}`,
    `staging_run ${manifest.stagingRunId}`,
    `mode ${mode}`,
    `total_staged ${manifest.summary.totalStagedItems}`,
    `eligible ${manifest.summary.eligibleItems}`,
    `blocked ${manifest.summary.blockedItems}`,
    `ready_for_publish ${manifest.summary.readyForPublish}`,
    `hold ${manifest.summary.holdCount}`,
    `reject_release ${manifest.summary.rejectReleaseCount}`,
  ];
}
