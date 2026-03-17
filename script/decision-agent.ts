import fs from "node:fs";
import path from "node:path";
import { decideRun } from "./lib/decision-agent.ts";

type CliArgs = {
  runId: string;
  decisionDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    decisionDir: path.join("tmp", "agent-decisions"),
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next;
        i++;
        break;
      case "--decision-dir":
        args.decisionDir = next;
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId) throw new Error("Missing --run-id");
  return args as CliArgs;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const decision = decideRun(args.runId);
  await fs.promises.mkdir(args.decisionDir, { recursive: true });
  const outPath = path.join(args.decisionDir, `${args.runId}.decision.json`);
  await fs.promises.writeFile(outPath, JSON.stringify(decision, null, 2), "utf8");

  console.log(`run ${decision.runId}`);
  console.log(`decision ${decision.decision}`);
  console.log(`publish_allowed ${decision.publishAllowed}`);
  console.log(`reason_codes ${decision.reasonCodes.join(",") || "none"}`);
  console.log(`output ${outPath}`);

  if (decision.decision === "REJECT") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
