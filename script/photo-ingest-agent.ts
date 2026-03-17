import path from "node:path";
import { runProductPhotoIngest } from "./lib/product-photo-ingest.ts";
import type { IngestSourceType } from "./lib/ingest-manifest.ts";

type CliArgs = {
  input?: string;
  output: string;
  report: string;
  reportDir: string;
  lockDir: string;
  dryRun: boolean;
  product?: string;
  maxImagesPerProduct: number;
  staged: boolean;
  stagingDir: string;
  manifestDir: string;
  runId?: string;
  sourceType: IngestSourceType;
};

function readCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: path.join("client", "public", "images", "products"),
    report: path.join("tmp", "photo-ingest-report.json"),
    reportDir: path.join("tmp", "agent-reports"),
    lockDir: path.join("script", ".locks"),
    dryRun: false,
    maxImagesPerProduct: 8,
    staged: false,
    stagingDir: path.join("tmp", "agent-staging"),
    manifestDir: path.join("tmp", "agent-manifests"),
    sourceType: "local",
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

    if (token === "--source-type") {
      const value = argv[index + 1] as IngestSourceType | undefined;
      if (value === "local" || value === "drive" || value === "manual") {
        args.sourceType = value;
      }
      index++;
      continue;
    }

    if (token === "--run-id") {
      args.runId = argv[index + 1];
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

    if (token === "--staged") {
      args.staged = true;
      continue;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(
    "Usage: npm run photos:ingest -- --input <path> [--staged] [--source-type local|drive|manual] [--run-id <id>] [--dry-run] [--product <id>] [--report <path>] [--output <path>] [--max-images-per-product <n>] [--lock-dir <path>]",
  );
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));

  if (!args.input) {
    printUsage();
    throw new Error("Missing required argument: --input");
  }

  const stagedReportId = args.runId ?? `run-${Date.now()}`;
  const reportPath = args.staged
    ? path.join(args.reportDir, `${stagedReportId}.json`)
    : args.report;

  const result = await runProductPhotoIngest({
    inputDir: args.input,
    outputDir: args.output,
    reportPath,
    lockDir: args.lockDir,
    dryRun: args.dryRun,
    productOverride: args.product,
    maxImagesPerProduct: args.maxImagesPerProduct,
    staged: args.staged,
    stagingDir: args.runId ? path.join(args.stagingDir, args.runId) : undefined,
    manifestDir: args.manifestDir,
    sourceType: args.sourceType,
    runId: args.runId,
  });

  const { report } = result;

  console.log(`run ${report.runId}`);
  console.log(`source ${report.sourceType}`);
  console.log(`staged ${report.staged}`);
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
  console.log(`report saved to ${path.resolve(process.cwd(), reportPath)}`);

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
