import path from "node:path";
import { runProductPhotoIngest } from "./lib/product-photo-ingest.ts";

type CliArgs = {
  input?: string;
  output: string;
  report: string;
  lockDir: string;
  dryRun: boolean;
  product?: string;
  maxImagesPerProduct: number;
};

function readCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: path.join("client", "public", "images", "products"),
    report: path.join("tmp", "photo-ingest-report.json"),
    lockDir: path.join("script", ".locks"),
    dryRun: false,
    maxImagesPerProduct: 8,
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

    if (token === "--lock-dir") {
      args.lockDir = argv[index + 1] ?? args.lockDir;
      index++;
      continue;
    }

    if (token === "--product") {
      args.product = argv[index + 1];
      index++;
      continue;
    }

    if (token === "--max-images-per-product") {
      const raw = argv[index + 1];
      if (!raw || Number.isNaN(Number(raw))) {
        throw new Error("--max-images-per-product requires a numeric value");
      }
      args.maxImagesPerProduct = Number(raw);
      index++;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(
    "Usage: npm run photos:ingest -- --input <path> [--dry-run] [--product <id>] [--report <path>] [--output <path>] [--max-images-per-product <n>] [--lock-dir <path>]",
  );
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));

  if (!args.input) {
    printUsage();
    throw new Error("Missing required argument: --input");
  }

  const result = await runProductPhotoIngest({
    inputDir: args.input,
    outputDir: args.output,
    reportPath: args.report,
    lockDir: args.lockDir,
    dryRun: args.dryRun,
    productOverride: args.product,
    maxImagesPerProduct: args.maxImagesPerProduct,
  });

  const { report } = result;

  console.log(`scanned ${report.totalFilesScanned} files`);
  console.log(`accepted ${report.imageFilesAccepted} images`);
  console.log(`matched files ${report.matchedFiles.length}`);
  console.log(`matched products ${report.matchedProducts.length}`);
  console.log(`unmatched ${report.unmatchedFiles.length} files`);
  console.log(`written ${report.writtenFiles.length} files`);
  console.log(`simulated ${report.simulatedFiles.length} files`);
  console.log(`skipped unchanged ${report.skippedUnchangedFiles.length} files`);
  console.log(`errors ${report.errors.length}`);
  console.log(`lock conflicts ${report.lockConflicts.length}`);
  console.log(`report saved to ${path.resolve(process.cwd(), args.report)}`);

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
