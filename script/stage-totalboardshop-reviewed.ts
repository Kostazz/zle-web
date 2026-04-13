import fs from "node:fs";
import path from "node:path";
import { runApprovedStagingExecutor } from "./lib/staging-review-executor.ts";

type CliArgs = {
  runId: string;
  reviewRunId?: string;
  reviewRunIdExplicit: boolean;
  outputDir: string;
  manifestDir: string;
  limit?: number;
  validateOnly: boolean;
};

type StagingFailureArtifact = {
  runId: string;
  phase: "stage-reviewed" | "validate-only";
  status: "failed";
  failureCode: string;
  failureReason: string;
  timestamp: string;
  upstreamRunIds: {
    sourceRunId?: string;
    reviewRunId?: string;
  };
  inputArtifacts: {
    datasetPath?: string;
    productsPath?: string;
    curationPath?: string;
    reviewPath?: string;
    outputDir: string;
    manifestDir: string;
  };
};

type CurationItem = {
  sourceProductKey: string;
  sourceUrl: string;
  title: string;
  curationDecision: "ACCEPT_CANDIDATE" | "REVIEW_REQUIRED" | "REJECTED";
  requiresHumanReview: boolean;
  proposedLocalProductId: string | null;
};

type CurationReport = {
  runId: string;
  sourceRunId: string;
  items: CurationItem[];
};

type ReviewDecisionEntry = {
  sourceProductKey: string;
  decision: "approved";
  resolutionType: "map_to_existing" | "new_candidate";
  approvedLocalProductId?: string;
  operatorNotes?: string;
};

type ReviewDecisionManifest = {
  runId: string;
  createdAt: string;
  sourceRunId: string;
  decisions: ReviewDecisionEntry[];
};

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    reviewRunIdExplicit: false,
    outputDir: path.join("tmp", "agent-staging"),
    manifestDir: path.join("tmp", "agent-manifests"),
    validateOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        i++;
        break;
      case "--review-run-id":
        args.reviewRunId = next ?? "";
        args.reviewRunIdExplicit = true;
        i++;
        break;
      case "--output-dir":
        args.outputDir = next ?? args.outputDir;
        i++;
        break;
      case "--manifest-dir":
        args.manifestDir = next ?? args.manifestDir;
        i++;
        break;
      case "--limit":
        args.limit = parsePositiveInt(next, "--limit");
        i++;
        break;
      case "--validate-only":
        args.validateOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId) throw new Error("Missing --run-id");
  return args;
}

function validateManifestDir(manifestDir: string): string {
  const allowedRoot = path.resolve("tmp", "agent-manifests");
  const resolved = path.resolve(manifestDir);
  const relative = path.relative(allowedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside tmp/agent-manifests: ${manifestDir}`);
  }
  return resolved;
}

function classifyFailure(message: string): string {
  if (/Missing required artifact/i.test(message)) return "missing_required_artifact";
  if (/Invalid .* JSON/i.test(message)) return "invalid_json";
  if (/mismatch|collision/i.test(message)) return "lineage_or_collision_failure";
  if (/outside tmp\/agent-manifests/i.test(message)) return "manifest_path_rejected";
  if (/outside tmp\/agent-staging/i.test(message)) return "staging_path_rejected";
  if (/Unknown argument|Missing --run-id|positive integer/i.test(message)) return "cli_usage_error";
  return "staging_failed_closed";
}

function defaultReviewPath(args: CliArgs): string {
  const reviewRunId = args.reviewRunId ?? args.runId;
  return path.join("tmp", "review-decisions", `${reviewRunId}.review.json`);
}

function readCurationReport(args: CliArgs): CurationReport {
  const curationPath = path.join("tmp", "curation", `${args.runId}.curation.json`);
  try {
    return JSON.parse(fs.readFileSync(curationPath, "utf8")) as CurationReport;
  } catch (error) {
    throw new Error(`Invalid curation report JSON: ${curationPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function shouldUseAutoApprovedBridge(report: CurationReport): boolean {
  return report.items.every((item) => !item.requiresHumanReview);
}

function buildAutoApprovedManifest(args: CliArgs, report: CurationReport): ReviewDecisionManifest {
  const reviewRunId = args.reviewRunId ?? args.runId;
  const decisions = report.items
    .filter((item) => item.curationDecision === "ACCEPT_CANDIDATE" && !item.requiresHumanReview)
    .map<ReviewDecisionEntry>((item) => {
      const mappedId = item.proposedLocalProductId ?? undefined;
      return {
        sourceProductKey: item.sourceProductKey,
        decision: "approved",
        resolutionType: mappedId ? "map_to_existing" : "new_candidate",
        approvedLocalProductId: mappedId,
        operatorNotes: "auto-approved: curation ACCEPT_CANDIDATE with requiresHumanReview=false",
      };
    })
    .sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));

  return {
    runId: reviewRunId,
    createdAt: new Date().toISOString(),
    sourceRunId: report.sourceRunId,
    decisions,
  };
}

async function writeFailureArtifacts(args: CliArgs, message: string): Promise<{ reportPath: string; summaryPath: string }> {
  const manifestDir = validateManifestDir(args.manifestDir);
  await fs.promises.mkdir(manifestDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const reviewRunId = args.reviewRunId ?? args.runId;
  const reportPath = path.join(manifestDir, `${args.runId}.staging.json`);
  const summaryPath = path.join(manifestDir, `${args.runId}.staging-summary.md`);
  const artifact: StagingFailureArtifact = {
    runId: args.runId,
    phase: args.validateOnly ? "validate-only" : "stage-reviewed",
    status: "failed",
    failureCode: classifyFailure(message),
    failureReason: message,
    timestamp,
    upstreamRunIds: {
      sourceRunId: args.runId,
      reviewRunId,
    },
    inputArtifacts: {
      datasetPath: path.join("tmp", "source-datasets", args.runId, "dataset.json"),
      productsPath: path.join("tmp", "source-datasets", args.runId, "products.json"),
      curationPath: path.join("tmp", "curation", `${args.runId}.curation.json`),
      reviewPath: path.join("tmp", "review-decisions", `${reviewRunId}.review.json`),
      outputDir: args.outputDir,
      manifestDir: args.manifestDir,
    },
  };
  const lines = [
    "# TotalBoardShop Approved Staging Summary",
    "",
    `- Run ID: ${args.runId}`,
    `- Review Run ID: ${reviewRunId}`,
    `- Created At: ${timestamp}`,
    `- Phase: ${artifact.phase}`,
    `- Status: failed`,
    `- Failure Code: ${artifact.failureCode}`,
    "",
    "## Validation Errors",
    `- ${message}`,
    "",
    "## Guardrails",
    "- Validation failed closed.",
    "- No publish action was executed.",
    "- No live asset writes were allowed.",
    "- Writes are restricted to tmp/agent-staging and tmp/agent-manifests.",
  ];
  await fs.promises.writeFile(reportPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
  return { reportPath, summaryPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    const reviewPath = defaultReviewPath(args);
    const hasReviewManifest = fs.existsSync(reviewPath);

    if (!hasReviewManifest && !args.reviewRunIdExplicit) {
      const curation = readCurationReport(args);
      if (shouldUseAutoApprovedBridge(curation)) {
        const manifest = buildAutoApprovedManifest(args, curation);
        await fs.promises.mkdir(path.dirname(reviewPath), { recursive: true });
        await fs.promises.writeFile(reviewPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      }
    }

    const result = await runApprovedStagingExecutor(args);

    console.log(`run ${result.report.runId}`);
    console.log(`review_run ${result.report.reviewRunId}`);
    console.log(`mode ${args.validateOnly ? "validate-only" : "stage-reviewed"}`);
    console.log(`approved ${result.report.summary.totalApprovedItems}`);
    console.log(`selected ${result.report.summary.selectedItems}`);
    console.log(`staged ${result.report.summary.stagedItems}`);
    console.log(`failed ${result.report.summary.failedItems}`);
    console.log(`skipped ${result.report.summary.skippedItems}`);
    console.log(`manifest ${result.reportPath}`);
    console.log(`summary ${result.summaryPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = await writeFailureArtifacts(args, message);
    console.error(message);
    console.error(`manifest ${failure.reportPath}`);
    console.error(`summary ${failure.summaryPath}`);
    process.exit(1);
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  let args: CliArgs | null = null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    console.error(message);
    process.exit(1);
  }
  try {
    const failure = await writeFailureArtifacts(args, message);
    console.error(message);
    console.error(`manifest ${failure.reportPath}`);
    console.error(`summary ${failure.summaryPath}`);
  } catch (artifactError) {
    console.error(message);
    console.error(artifactError instanceof Error ? artifactError.message : String(artifactError));
  }
  process.exit(1);
});
