import { runPipeline } from "./lib/pipeline-runner.ts";

type CliArgs = {
  runId?: string;
  mode: "staged-only" | "publish-approved";
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: "staged-only" };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];

    switch (token) {
      case "--run-id":
        args.runId = next;
        i++;
        break;
      case "--staged-only":
        args.mode = "staged-only";
        break;
      case "--publish-approved":
        args.mode = "publish-approved";
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPipeline(args);
  console.log(`run ${result.runId}`);
  console.log(`decision ${result.decision.decision}`);
  console.log(`publish_allowed ${result.decision.publishAllowed}`);
  console.log(`published ${result.published}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
