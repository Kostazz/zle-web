import path from "node:path";
import { createSourceRunId, runTotalboardshopSourceAgent } from "./lib/source-totalboardshop.ts";

type CliArgs = {
  runId?: string;
  outputRoot: string;
  seedUrl: string;
  maxPages: number;
  maxProducts: number;
  maxImagesPerProduct: number;
  maxImageBytes: number;
};

function parseInteger(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outputRoot: path.join("tmp", "source-datasets"),
    seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
    maxPages: 40,
    maxProducts: 30,
    maxImagesPerProduct: 8,
    maxImageBytes: 8_000_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next;
        i++;
        break;
      case "--output-root":
        args.outputRoot = next ?? args.outputRoot;
        i++;
        break;
      case "--seed-url":
        args.seedUrl = next ?? args.seedUrl;
        i++;
        break;
      case "--max-pages":
        args.maxPages = parseInteger(next, "--max-pages");
        i++;
        break;
      case "--max-products":
        args.maxProducts = parseInteger(next, "--max-products");
        i++;
        break;
      case "--max-images-per-product":
        args.maxImagesPerProduct = parseInteger(next, "--max-images-per-product");
        i++;
        break;
      case "--max-image-bytes":
        args.maxImageBytes = parseInteger(next, "--max-image-bytes");
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.runId ?? createSourceRunId();

  const result = await runTotalboardshopSourceAgent({
    runId,
    outputRoot: args.outputRoot,
    seedUrl: args.seedUrl,
    maxPages: args.maxPages,
    maxProducts: args.maxProducts,
    maxImagesPerProduct: args.maxImagesPerProduct,
    maxImageBytes: args.maxImageBytes,
  });

  console.log(`run ${runId}`);
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
