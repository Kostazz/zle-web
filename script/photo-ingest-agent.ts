import path from "node:path";
import { runProductPhotoIngest } from "./lib/product-photo-ingest.ts";

type CliArgs = {
  input?: string;
  output: string;
  report: string;
  dryRun: boolean;
  product?: string;
};

function readCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: path.join("client", "public", "images", "products"),
    report: path.join("tmp", "photo-ingest-report.json"),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--input") {
      args.input = argv[index + 1];
      index++;
      continue;
    }

    if (token === "--output") {
      args.output = argv[index + 1] ?? args.output;
      index++;
      continue;
    }

    if (token === "--report") {
      args.report = argv[index + 1] ?? args.report;
      index++;
      continue;
    }

    if (token === "--product") {
      args.product = argv[index + 1];
      index++;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function printUsage(): void {
  console.log("Usage: npm run photos:ingest -- --input <path> [--dry-run] [--product <id>] [--report <path>] [--output <path>]");
}

async function main() {
  const args = readCliArgs(process.argv.slice(2));
  if (!args.input) {
    printUsage();
    throw new Error("Missing required argument: --input");
  }

  const result = await runProductPhotoIngest({
    inputDir: args.input,
    outputDir: args.output,
    reportPath: args.report,
    dryRun: args.dryRun,
    productOverride: args.product,
  });

  const { report } = result;

  console.log(`scanned ${report.totalFilesScanned} files`);
  console.log(`accepted ${report.imageFilesAccepted} images`);
  console.log(`matched ${report.matchedProducts.length} products`);
  console.log(`unmatched ${report.unmatchedFiles.length} files`);
  console.log(`wrote ${report.writtenFiles.length} files`);
  console.log(`report saved to ${path.resolve(process.cwd(), args.report)}`);

  if (report.errors.length > 0) {
    console.error(`errors ${report.errors.length}`);
    for (const error of report.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
