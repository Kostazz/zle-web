import fs from "node:fs";
import path from "node:path";
import { parseManualTrustedProductSnapshot, runTotalboardshopManualSourceAgent } from "./lib/source-totalboardshop.ts";

type CliArgs = {
  runId: string;
  input: string;
  outputRoot: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    outputRoot: path.join("tmp", "source-datasets"),
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next;
        i++;
        break;
      case "--input":
        args.input = next;
        i++;
        break;
      case "--output-root":
        args.outputRoot = next ?? args.outputRoot;
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId?.trim()) throw new Error("Missing --run-id");
  if (!args.input?.trim()) throw new Error("Missing --input");

  return {
    runId: args.runId,
    input: args.input,
    outputRoot: args.outputRoot ?? path.join("tmp", "source-datasets"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const rawInput = await fs.promises.readFile(inputPath, "utf8");
  const snapshot = parseManualTrustedProductSnapshot(rawInput);
  const result = await runTotalboardshopManualSourceAgent({
    runId: args.runId,
    outputRoot: args.outputRoot,
    inputPath,
    snapshot,
  });

  console.log(`run ${args.runId}`);
  console.log(`mode manual-trusted-snapshot`);
  console.log(`products ${result.productCount}`);
  console.log(`images ${result.imageCount}`);
  console.log(`dataset ${result.datasetPath}`);
  console.log(`products_json ${result.productsPath}`);
  console.log(`crawl_log ${result.crawlLogPath}`);
  console.log(`audit ${result.auditPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
