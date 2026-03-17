import path from "node:path";
import { products } from "../client/src/data/products.ts";
import { runProductPhotoIngest } from "./lib/product-photo-ingest.ts";
import type { IngestSourceType } from "./lib/ingest-manifest.ts";

type CliArgs = {
  input?: string;
  output: string;
  report?: string;
  reportDir: string;
  lockDir: string;
  dryRun: boolean;
  product?: string;
  maxImagesPerProduct: number;
  staged: boolean;
  direct: boolean;
  stagingDir: string;
  manifestDir: string;
  reviewDir: string;
  runId?: string;
  sourceType: IngestSourceType;
};

const LIVE_OUTPUT_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

function parseNumber(value: string | undefined, flag: string): number {
  if (!value || Number.isNaN(Number(value))) throw new Error(`${flag} requires a numeric value`);
  return Number(value);
}

function readCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: path.join("client", "public", "images", "products"),
    reportDir: path.join("tmp", "agent-reports"),
    lockDir: path.join("script", ".locks"),
    dryRun: false,
    maxImagesPerProduct: 8,
    staged: true,
    direct: false,
    stagingDir: path.join("tmp", "agent-staging"),
    manifestDir: path.join("tmp", "agent-manifests"),
    reviewDir: path.join("tmp", "agent-review"),
    sourceType: "local",
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case "--input":
        args.input = next;
        index++;
        break;
      case "--output":
        args.output = next ?? args.output;
        index++;
        break;
      case "--report":
        args.report = next;
        index++;
        break;
      case "--report-dir":
        args.reportDir = next ?? args.reportDir;
        index++;
        break;
      case "--manifest-dir":
        args.manifestDir = next ?? args.manifestDir;
        index++;
        break;
      case "--review-dir":
        args.reviewDir = next ?? args.reviewDir;
        index++;
        break;
      case "--staging-dir":
        args.stagingDir = next ?? args.stagingDir;
        index++;
        break;
      case "--lock-dir":
        args.lockDir = next ?? args.lockDir;
        index++;
        break;
      case "--product":
        args.product = next;
        index++;
        break;
      case "--source-type":
        if (next === "local" || next === "drive" || next === "manual") args.sourceType = next;
        else throw new Error("--source-type must be local|drive|manual");
        index++;
        break;
      case "--run-id":
        args.runId = next;
        index++;
        break;
      case "--max-images-per-product":
        args.maxImagesPerProduct = parseNumber(next, "--max-images-per-product");
        index++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--staged":
        args.staged = true;
        break;
      case "--direct":
        args.direct = true;
        args.staged = false;
        break;
      case "--no-sidecar-read":
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function assertSafeInput(inputPath: string): void {
  const resolved = path.resolve(process.cwd(), inputPath);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === path.resolve(process.cwd())) {
    throw new Error("Refusing dangerous broad input path");
  }
}

function assertDirectOutputAllowed(outputPath: string): void {
  const resolved = path.resolve(process.cwd(), outputPath);
  const rel = path.relative(LIVE_OUTPUT_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("--direct output must stay under client/public/images/products");
  }
}

function printUsage(): void {
  console.log(
    "Usage: npm run photos:ingest -- --input <path> [--staged] [--direct] [--source-type local|drive|manual] [--run-id <id>] [--dry-run] [--product <id>] [--report <path>] [--report-dir <path>] [--manifest-dir <path>] [--review-dir <path>] [--staging-dir <path>] [--output <path>] [--max-images-per-product <n>] [--lock-dir <path>]",
  );
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  if (!args.input?.trim()) {
    printUsage();
    throw new Error("Missing required argument: --input");
  }

  assertSafeInput(args.input);

  const knownProducts = new Set(products.map((product) => product.id));
  if (args.product && !knownProducts.has(args.product)) throw new Error(`Unknown product override: ${args.product}`);

  if (args.maxImagesPerProduct < 1 || !Number.isInteger(args.maxImagesPerProduct)) {
    throw new Error("--max-images-per-product must be a positive integer");
  }

  const runId = args.runId ?? `run-${Date.now()}`;
  const reportPath = args.report ?? path.join(args.reportDir, `${runId}.json`);
  const summaryPath = path.join(args.reportDir, `${runId}.summary.md`);
  const stagingRunDir = path.join(args.stagingDir, runId);

  if (args.direct && !args.output) throw new Error("--direct requires --output");
  if (args.direct) {
    assertDirectOutputAllowed(args.output);
  }
  if (!args.direct && args.output && args.output !== path.join("client", "public", "images", "products")) {
    // keep output inert in staged mode unless direct is set
    console.warn("--output is ignored in staged mode unless --direct is provided");
  }

  const result = await runProductPhotoIngest({
    inputDir: args.input,
    outputDir: args.output,
    reportPath,
    summaryPath,
    reviewDir: args.reviewDir,
    lockDir: args.lockDir,
    dryRun: args.dryRun,
    productOverride: args.product,
    maxImagesPerProduct: args.maxImagesPerProduct,
    staged: !args.direct,
    direct: args.direct,
    stagingDir: stagingRunDir,
    manifestDir: args.manifestDir,
    sourceType: args.sourceType,
    runId,
  });

  const { report } = result;
  console.log(`run ${report.runId}`);
  console.log(`source ${report.sourceType}`);
  console.log(`mode ${report.mode}`);
  console.log(`scanned ${report.totalFilesScanned} files`);
  console.log(`accepted ${report.imageFilesAccepted} images`);
  console.log(`matched files ${report.matchedFiles.length}`);
  console.log(`matched products ${report.matchedProducts.length}`);
  console.log(`unmatched ${report.unmatchedFiles.length} files`);
  console.log(`written ${report.writtenFiles.length} files`);
  console.log(`simulated ${report.simulatedFiles.length} files`);
  console.log(`skipped unchanged ${report.skippedUnchangedFiles.length} files`);
  console.log(`lock conflicts ${report.lockConflicts.length}`);
  console.log(`suspicious inputs ${report.suspiciousInputs.length}`);
  console.log(`review items ${report.reviewItems.length}`);
  console.log(`errors ${report.errors.length}`);
  console.log(`verdict ${report.verdict}`);
  console.log(`report saved to ${path.resolve(process.cwd(), reportPath)}`);
  if (report.summaryPath) console.log(`summary saved to ${path.resolve(process.cwd(), report.summaryPath)}`);
  if (report.reviewManifestPath) console.log(`review saved to ${path.resolve(process.cwd(), report.reviewManifestPath)}`);

  if (report.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
