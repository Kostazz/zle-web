import { writeLineageProof } from "./lib/lineage-proof.ts";

type CliArgs = {
  runId: string;
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  gateRunId: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    sourceRunId: "",
    reviewRunId: "",
    stagingRunId: "",
    gateRunId: "",
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1] ?? "";
    switch (token) {
      case "--run-id": args.runId = next; index++; break;
      case "--source-run-id": args.sourceRunId = next; index++; break;
      case "--review-run-id": args.reviewRunId = next; index++; break;
      case "--staging-run-id": args.stagingRunId = next; index++; break;
      case "--gate-run-id": args.gateRunId = next; index++; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId) throw new Error("Missing --run-id");
  if (!args.sourceRunId) throw new Error("Missing --source-run-id");
  if (!args.reviewRunId) throw new Error("Missing --review-run-id");
  if (!args.stagingRunId) throw new Error("Missing --staging-run-id");
  if (!args.gateRunId) throw new Error("Missing --gate-run-id");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeLineageProof(args);
  console.log(`run ${result.artifact.runId}`);
  console.log(`verdict ${result.artifact.verdict}`);
  console.log(`artifact ${result.artifactPath}`);
  console.log(`summary ${result.summaryPath}`);
  if (result.artifact.mismatches.length > 0) {
    for (const mismatch of result.artifact.mismatches) console.log(`mismatch ${mismatch}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
