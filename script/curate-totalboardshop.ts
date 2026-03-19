import path from "node:path";
import { runCurationAgent } from "./lib/curation-agent.ts";
import type { CurationMode } from "./lib/curation-types.ts";

type CliArgs = {
  runId: string;
  mode: CurationMode;
  category?: string;
  limit?: number;
  outputDir: string;
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
    mode: "bootstrap-replacement",
    outputDir: path.join("tmp", "curation"),
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        i++;
        break;
      case "--mode":
        if (next !== "bootstrap-replacement" && next !== "incremental-sync") {
          throw new Error("--mode must be bootstrap-replacement|incremental-sync");
        }
        args.mode = next;
        i++;
        break;
      case "--category":
        args.category = next;
        i++;
        break;
      case "--limit":
        args.limit = parsePositiveInt(next, "--limit");
        i++;
        break;
      case "--output-dir":
        args.outputDir = next ?? args.outputDir;
        i++;
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
  const result = await runCurationAgent(args);
  console.log(`run ${result.report.runId}`);
  console.log(`mode ${result.report.mode}`);
  console.log(`items ${result.report.summary.totalItems}`);
  console.log(`accepted ${result.report.summary.acceptedCandidates}`);
  console.log(`review ${result.report.summary.reviewRequired}`);
  console.log(`rejected ${result.report.summary.rejected}`);
  console.log(`curation ${result.reportPath}`);
  console.log(`review_queue ${result.reviewQueuePath}`);
  console.log(`summary ${result.summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
