import fs from "node:fs";
import path from "node:path";
import { sha256File } from "./audit-chain.ts";

type ArtifactMap = {
  review: string;
  staging: string;
  gate: string;
};

export type LineageProofInput = {
  runId: string;
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  gateRunId: string;
  reviewDir?: string;
  stagingManifestDir?: string;
  gateDir?: string;
  outputDir?: string;
};

export type LineageProofArtifact = {
  runId: string;
  verdict: "pass" | "fail";
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  gateRunId: string;
  artifactPaths: ArtifactMap;
  artifactHashes: Partial<ArtifactMap>;
  mismatches: string[];
  checkedAt: string;
};

const DEFAULT_REVIEW_DIR = path.resolve("tmp", "review-decisions");
const DEFAULT_STAGING_DIR = path.resolve("tmp", "agent-manifests");
const DEFAULT_GATE_DIR = path.resolve("tmp", "publish-gates");
const DEFAULT_OUTPUT_DIR = path.resolve("tmp", "lineage");

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInsideAllowedRoot(targetPath: string, allowedRoot: string, label: string): string {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(allowedRoot, resolved)) {
    throw new Error(`Refusing ${label} outside ${path.relative(process.cwd(), allowedRoot) || allowedRoot}: ${targetPath}`);
  }
  return resolved;
}

function readJsonFile<T>(targetPath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function resolveHashes(paths: ArtifactMap): Promise<Partial<ArtifactMap>> {
  const hashes: Partial<ArtifactMap> = {};
  for (const [key, artifactPath] of Object.entries(paths) as Array<[keyof ArtifactMap, string]>) {
    if (!fs.existsSync(artifactPath)) continue;
    hashes[key] = await sha256File(artifactPath);
  }
  return hashes;
}

function renderSummaryMarkdown(artifact: LineageProofArtifact): string {
  const lines = [
    "# TotalBoardShop Lineage Proof",
    "",
    `- Run ID: ${artifact.runId}`,
    `- Verdict: ${artifact.verdict}`,
    `- Source Run ID: ${artifact.sourceRunId}`,
    `- Review Run ID: ${artifact.reviewRunId}`,
    `- Staging Run ID: ${artifact.stagingRunId}`,
    `- Gate Run ID: ${artifact.gateRunId}`,
    `- Checked At: ${artifact.checkedAt}`,
    "",
    "## Artifact Paths",
    `- Review: ${artifact.artifactPaths.review}`,
    `- Staging: ${artifact.artifactPaths.staging}`,
    `- Gate: ${artifact.artifactPaths.gate}`,
    "",
    "## Artifact Hashes",
    `- Review: ${artifact.artifactHashes.review ?? "missing"}`,
    `- Staging: ${artifact.artifactHashes.staging ?? "missing"}`,
    `- Gate: ${artifact.artifactHashes.gate ?? "missing"}`,
  ];

  if (artifact.mismatches.length > 0) {
    lines.push("", "## Mismatches", ...artifact.mismatches.map((item) => `- ${item}`));
  } else {
    lines.push("", "## Mismatches", "- none");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeLineageProof(input: LineageProofInput): Promise<{ artifact: LineageProofArtifact; artifactPath: string; summaryPath: string }> {
  const reviewDir = assertInsideAllowedRoot(input.reviewDir ?? DEFAULT_REVIEW_DIR, DEFAULT_REVIEW_DIR, "review lineage dir");
  const stagingDir = assertInsideAllowedRoot(input.stagingManifestDir ?? DEFAULT_STAGING_DIR, DEFAULT_STAGING_DIR, "staging lineage dir");
  const gateDir = assertInsideAllowedRoot(input.gateDir ?? DEFAULT_GATE_DIR, DEFAULT_GATE_DIR, "gate lineage dir");
  const outputDir = assertInsideAllowedRoot(input.outputDir ?? DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_DIR, "lineage output dir");

  const artifactPaths: ArtifactMap = {
    review: path.join(reviewDir, `${input.reviewRunId}.review.json`),
    staging: path.join(stagingDir, `${input.stagingRunId}.staging.json`),
    gate: path.join(gateDir, `${input.gateRunId}.publish-gate.json`),
  };

  const mismatches: string[] = [];
  for (const [label, artifactPath] of Object.entries(artifactPaths)) {
    if (!fs.existsSync(artifactPath)) mismatches.push(`Missing ${label} artifact: ${artifactPath}`);
  }

  let review: { runId: string; sourceRunId: string } | null = null;
  let staging: { runId: string; sourceRunId: string; reviewRunId: string } | null = null;
  let gate: { runId: string; sourceRunId: string; reviewRunId: string; stagingRunId: string } | null = null;

  if (fs.existsSync(artifactPaths.review)) {
    review = readJsonFile(artifactPaths.review, "review manifest");
    const reviewArtifact = review!;
    if (reviewArtifact.runId !== input.reviewRunId) mismatches.push(`review.runId expected ${input.reviewRunId} but received ${reviewArtifact.runId}`);
    if (reviewArtifact.sourceRunId !== input.sourceRunId) mismatches.push(`review.sourceRunId expected ${input.sourceRunId} but received ${reviewArtifact.sourceRunId}`);
  }
  if (fs.existsSync(artifactPaths.staging)) {
    staging = readJsonFile(artifactPaths.staging, "staging report");
    const stagingArtifact = staging!;
    if (stagingArtifact.runId !== input.stagingRunId) mismatches.push(`staging.runId expected ${input.stagingRunId} but received ${stagingArtifact.runId}`);
    if (stagingArtifact.sourceRunId !== input.sourceRunId) mismatches.push(`staging.sourceRunId expected ${input.sourceRunId} but received ${stagingArtifact.sourceRunId}`);
    if (stagingArtifact.reviewRunId !== input.reviewRunId) mismatches.push(`staging.reviewRunId expected ${input.reviewRunId} but received ${stagingArtifact.reviewRunId}`);
  }
  if (fs.existsSync(artifactPaths.gate)) {
    gate = readJsonFile(artifactPaths.gate, "publish gate manifest");
    const gateArtifact = gate!;
    if (gateArtifact.runId !== input.gateRunId) mismatches.push(`gate.runId expected ${input.gateRunId} but received ${gateArtifact.runId}`);
    if (gateArtifact.sourceRunId !== input.sourceRunId) mismatches.push(`gate.sourceRunId expected ${input.sourceRunId} but received ${gateArtifact.sourceRunId}`);
    if (gateArtifact.reviewRunId !== input.reviewRunId) mismatches.push(`gate.reviewRunId expected ${input.reviewRunId} but received ${gateArtifact.reviewRunId}`);
    if (gateArtifact.stagingRunId !== input.stagingRunId) mismatches.push(`gate.stagingRunId expected ${input.stagingRunId} but received ${gateArtifact.stagingRunId}`);
  }

  if (review && staging && review.sourceRunId !== staging.sourceRunId) {
    mismatches.push(`review/staging sourceRunId mismatch: ${review.sourceRunId} vs ${staging.sourceRunId}`);
  }
  if (staging && gate && staging.reviewRunId !== gate.reviewRunId) {
    mismatches.push(`staging/gate reviewRunId mismatch: ${staging.reviewRunId} vs ${gate.reviewRunId}`);
  }
  if (staging && gate && staging.runId !== gate.stagingRunId) {
    mismatches.push(`staging/gate stagingRunId mismatch: ${staging.runId} vs ${gate.stagingRunId}`);
  }

  await fs.promises.mkdir(outputDir, { recursive: true });
  const artifact: LineageProofArtifact = {
    runId: input.runId,
    verdict: mismatches.length === 0 ? "pass" : "fail",
    sourceRunId: input.sourceRunId,
    reviewRunId: input.reviewRunId,
    stagingRunId: input.stagingRunId,
    gateRunId: input.gateRunId,
    artifactPaths,
    artifactHashes: await resolveHashes(artifactPaths),
    mismatches,
    checkedAt: new Date().toISOString(),
  };
  const artifactPath = path.join(outputDir, `${input.runId}.lineage.json`);
  const summaryPath = path.join(outputDir, `${input.runId}.summary.md`);
  await fs.promises.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(summaryPath, renderSummaryMarkdown(artifact), "utf8");
  return { artifact, artifactPath, summaryPath };
}
