import path from "node:path";
import { runManualPublishExecutor } from "./lib/manual-publish-executor.ts";

type CliArgs = {
  runId: string;
  gateRunId?: string;
  reportDir: string;
  validateOnly: boolean;
};

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
