import fs from "node:fs";
import path from "node:path";
import { runApprovedStagingExecutor } from "./lib/staging-review-executor.ts";

type CliArgs = {
  runId: string;
  reviewRunId?: string;
  outputDir: string;
  manifestDir: string;
  limit?: number;
  validateOnly: boolean;
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

async function writeFailureSummary(args: CliArgs, message: string): Promise<string> {
  const allowedRoot = path.resolve("tmp", "agent-manifests");
  const manifestDir = path.resolve(args.manifestDir);
  const relative = path.relative(allowedRoot, manifestDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside tmp/agent-manifests: ${args.manifestDir}`);
  }
  await fs.promises.mkdir(manifestDir, { recursive: true });
  const summaryPath = path.join(manifestDir, `${args.runId}.staging-summary.md`);
  const lines = [
    "# TotalBoardShop Approved Staging Summary",
    "",
    `- Run ID: ${args.runId}`,
    `- Review Run ID: ${args.reviewRunId ?? args.runId}`,
    `- Created At: ${new Date().toISOString()}`,
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
  await fs.promises.writeFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
  return summaryPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
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
    const summaryPath = await writeFailureSummary(args, message);
    console.error(message);
    console.error(`summary ${summaryPath}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
