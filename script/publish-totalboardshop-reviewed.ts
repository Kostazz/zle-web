import fs from "node:fs";
import path from "node:path";
import type { PublishExecutionReport } from "./lib/publish-executor-types.ts";
import { runManualPublishExecutor } from "./lib/manual-publish-executor.ts";

type CliArgs = {
  runId: string;
  gateRunId?: string;
  reportDir: string;
  validateOnly: boolean;
};

const ALLOWED_REPORT_ROOT = path.resolve("tmp", "publish-reports");

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    reportDir: path.join("tmp", "publish-reports"),
    validateOnly: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        index++;
        break;
      case "--gate-run-id":
        args.gateRunId = next ?? "";
        index++;
        break;
      case "--report-dir":
        args.reportDir = next ?? args.reportDir;
        index++;
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

async function writeFailureArtifacts(args: CliArgs, message: string): Promise<{ reportPath: string; summaryPath: string }> {
  const reportDir = path.resolve(args.reportDir);
  if (!isPathInside(ALLOWED_REPORT_ROOT, reportDir)) {
    throw new Error(`Refusing to write outside tmp/publish-reports: ${args.reportDir}`);
  }

  await fs.promises.mkdir(reportDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const report: PublishExecutionReport = {
    runId: args.runId,
    sourceRunId: "unknown",
    reviewRunId: "unknown",
    stagingRunId: "unknown",
    gateRunId: args.gateRunId?.trim() || args.runId,
    createdAt,
    summary: {
      totalGateItems: 0,
      readyForPublish: 0,
      published: 0,
      failed: 1,
      skipped: 0,
      mappedToExisting: 0,
      newCandidatePublished: 0,
    },
    items: [{
      sourceProductKey: args.runId,
      resolutionType: "new_candidate",
      approvedLocalProductId: null,
      liveTargetKey: args.runId,
      plannedOutputs: [],
      publishedOutputs: [],
      removedManagedOutputs: [],
      status: "failed",
      reasonCodes: ["publish_validation_failed"],
      errorMessage: message,
    }],
  };

  const summary = [
    "# TotalBoardShop Manual Publish Summary",
    "",
    `- Run ID: ${args.runId}`,
    `- Gate Run ID: ${args.gateRunId?.trim() || args.runId}`,
    `- Created At: ${createdAt}`,
    `- Mode: ${args.validateOnly ? "validate-only" : "publish"}`,
    "",
    "## Validation Errors",
    `- ${message}`,
    "",
    "## Guardrails",
    "- Validation failed closed.",
    "- No live asset writes were executed.",
    "- Report writes are restricted to tmp/publish-reports.",
  ].join("\n");

  const reportPath = path.join(reportDir, `${args.runId}.publish.json`);
  const summaryPath = path.join(reportDir, `${args.runId}.summary.md`);
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(summaryPath, `${summary}\n`, "utf8");
  return { reportPath, summaryPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await runManualPublishExecutor(args);
    console.log(`run ${result.report.runId}`);
    console.log(`gate_run ${result.report.gateRunId}`);
    console.log(`mode ${args.validateOnly ? "validate-only" : "publish"}`);
    console.log(`ready ${result.report.summary.readyForPublish}`);
    console.log(`published ${result.report.summary.published}`);
    console.log(`failed ${result.report.summary.failed}`);
    console.log(`skipped ${result.report.summary.skipped}`);
    if (result.reportPath) console.log(`report ${result.reportPath}`);
    if (result.summaryPath) console.log(`summary ${result.summaryPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = await writeFailureArtifacts(args, message);
    console.error(message);
    console.error(`report ${failure.reportPath}`);
    console.error(`summary ${failure.summaryPath}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
