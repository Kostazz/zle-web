import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extFromContentType, normalizeAllowedUrl, safeFetchBinary, type FetchLimits } from "./lib/fetch-utils.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./lib/source-dataset.ts";

type CliArgs = {
  runId: string;
  validateOnly: boolean;
  maxImagesPerProduct?: number;
};

type IngestManifestProduct = {
  sourceProductKey: string;
  imageCount: number;
  ingestedImagePaths: string[];
  ingestedImages: Array<{ path: string; originalImageUrl: string; originalImageIndex: number }>;
  downloadedImageHashes: string[];
};

type IngestManifest = {
  runId: string;
  sourceRunId: string;
  createdAt: string;
  validateOnly: boolean;
  sourceDatasetPath: string;
  sourceProductsPath: string;
  outputRoot: string;
  downloadedImageCount: number;
  failedImageCount: number;
  failures: {
    sourceProductKey: string;
    imageUrl: string;
    reason: string;
  }[];
  products: IngestManifestProduct[];
};

const DATASET_ROOT = path.resolve("tmp", "source-datasets");
const IMAGE_ROOT = path.resolve("tmp", "source-images");
const DEFAULT_FETCH_LIMITS: FetchLimits = {
  timeoutMs: 15_000,
  maxHtmlBytes: 1_000_000,
  maxImageBytes: 8_000_000,
  minDelayMs: 0,
  maxDelayMs: 0,
};

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { runId: "", validateOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        i++;
        break;
      case "--validate-only":
        args.validateOnly = true;
        break;
      case "--max-images-per-product":
        args.maxImagesPerProduct = parsePositiveInt(next, "--max-images-per-product");
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{1,255}$/i.test(args.runId)) throw new Error("Invalid --run-id");
  return args;
}

function assertInsideRoot(root: string, targetPath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} outside allowed root: ${targetPath}`);
  }
  return resolvedTarget;
}

function readJsonFile<T>(targetPath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function inferExt(url: string, contentType: string): string {
  const fromCt = extFromContentType(contentType);
  if (fromCt !== ".img") return fromCt;
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return ".png";
  if (pathname.endsWith(".webp")) return ".webp";
  return ".jpg";
}

function sha256(buffer: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function isFatalImageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Malformed URL:") ||
    error.message.includes("Non-HTTPS URL blocked:") ||
    error.message.includes("Non-allowlisted host blocked:") ||
    error.message.includes("outside allowed root")
  );
}

async function safeWriteBinary(targetPath: string, value: Buffer): Promise<void> {
  const resolved = assertInsideRoot(IMAGE_ROOT, targetPath, "Refusing image write");
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, value);
}

async function safeWriteJson(targetPath: string, value: unknown, root: string): Promise<void> {
  const resolved = assertInsideRoot(root, targetPath, "Refusing json write");
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function safeWriteText(targetPath: string, value: string, root: string): Promise<void> {
  const resolved = assertInsideRoot(root, targetPath, "Refusing text write");
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, value, "utf8");
}

export async function runTotalboardshopSourceIngest(args: CliArgs): Promise<IngestManifest> {
  const runDir = assertInsideRoot(DATASET_ROOT, path.join(DATASET_ROOT, args.runId), "Run dir");
  const datasetPath = assertInsideRoot(DATASET_ROOT, path.join(runDir, "dataset.json"), "Dataset path");
  const productsPath = assertInsideRoot(DATASET_ROOT, path.join(runDir, "products.json"), "Products path");
  if (!fs.existsSync(productsPath)) throw new Error(`Missing products.json for run ${args.runId}`);
  if (!fs.existsSync(datasetPath)) throw new Error(`Missing dataset.json for run ${args.runId}`);

  const dataset = readJsonFile<SourceDatasetManifest>(datasetPath, "source dataset");
  const products = readJsonFile<SourceProductRecord[]>(productsPath, "source products");
  if (dataset.runId !== args.runId) throw new Error(`run id mismatch in dataset artifact: expected ${args.runId}, received ${dataset.runId}`);
  if (!Array.isArray(products) || products.length < 1) throw new Error(`Source products artifact is empty for run ${args.runId}`);

  const outputRoot = assertInsideRoot(IMAGE_ROOT, path.join(IMAGE_ROOT, args.runId), "Output root");
  const manifestProducts: IngestManifestProduct[] = [];
  let downloadedImageCount = 0;
  let failedImageCount = 0;
  const failures: IngestManifest["failures"] = [];

  for (const product of products) {
    if (!product.sourceProductKey?.trim()) throw new Error("Missing sourceProductKey");
    if (!Array.isArray(product.imageUrls) || product.imageUrls.length < 1) {
      throw new Error(`Missing image URLs for ${product.sourceProductKey}`);
    }
    const productRoot = assertInsideRoot(outputRoot, path.join(outputRoot, product.sourceProductKey), "Product image dir");
    const limit = Math.min(product.imageUrls.length, args.maxImagesPerProduct ?? product.imageUrls.length);
    const ingestedImagePaths: string[] = [];
    const ingestedImages: Array<{ path: string; originalImageUrl: string; originalImageIndex: number }> = [];
    const downloadedImageHashes: string[] = [];

    for (let i = 0; i < limit; i++) {
      const imageUrl = product.imageUrls[i];
      try {
        const normalized = normalizeAllowedUrl(imageUrl).toString();
        const fetched = await safeFetchBinary(normalized, DEFAULT_FETCH_LIMITS, "image");
        const ext = inferExt(normalized, fetched.contentType);
        const fileName = `${String(ingestedImagePaths.length + 1).padStart(2, "0")}${ext}`;
        const absoluteTarget = assertInsideRoot(productRoot, path.join(productRoot, fileName), "Image target");
        const relativeTarget = path.relative(process.cwd(), absoluteTarget).split(path.sep).join("/");
        if (!args.validateOnly) await safeWriteBinary(absoluteTarget, fetched.body);
        ingestedImagePaths.push(relativeTarget);
        ingestedImages.push({
          path: relativeTarget,
          originalImageUrl: imageUrl,
          originalImageIndex: i,
        });
        downloadedImageHashes.push(sha256(fetched.body));
        downloadedImageCount += 1;
      } catch (error) {
        if (isFatalImageError(error)) throw error;
        failedImageCount += 1;
        failures.push({
          sourceProductKey: product.sourceProductKey,
          imageUrl,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    product.ingestedImagePaths = ingestedImagePaths;
    product.ingestedImages = ingestedImages;
    product.downloadedImageHashes = downloadedImageHashes;
    manifestProducts.push({
      sourceProductKey: product.sourceProductKey,
      imageCount: ingestedImagePaths.length,
      ingestedImagePaths,
      ingestedImages,
      downloadedImageHashes,
    });
  }

  if (!args.validateOnly) {
    await safeWriteJson(productsPath, products, DATASET_ROOT);
  }

  const manifest: IngestManifest = {
    runId: args.runId,
    sourceRunId: dataset.runId,
    createdAt: new Date().toISOString(),
    validateOnly: args.validateOnly,
    sourceDatasetPath: path.relative(process.cwd(), datasetPath).split(path.sep).join("/"),
    sourceProductsPath: path.relative(process.cwd(), productsPath).split(path.sep).join("/"),
    outputRoot: path.relative(process.cwd(), outputRoot).split(path.sep).join("/"),
    downloadedImageCount,
    failedImageCount,
    failures,
    products: manifestProducts,
  };

  if (!args.validateOnly) {
    await safeWriteJson(path.join(outputRoot, "image-manifest.json"), manifest, IMAGE_ROOT);
    await safeWriteJson(path.join(IMAGE_ROOT, `${args.runId}.ingest.json`), manifest, IMAGE_ROOT);
    const summary = [
      "# TotalBoardShop Source Image Ingest Summary",
      "",
      `- Run ID: ${manifest.runId}`,
      `- Source Run ID: ${manifest.sourceRunId}`,
      `- Created At: ${manifest.createdAt}`,
      `- Source Dataset Path: ${manifest.sourceDatasetPath}`,
      `- Source Products Path: ${manifest.sourceProductsPath}`,
      `- Output Root: ${manifest.outputRoot}`,
      `- Downloaded Image Count: ${manifest.downloadedImageCount}`,
      `- Failed Image Count: ${manifest.failedImageCount}`,
      `- Validate Only: ${manifest.validateOnly ? "yes" : "no"}`,
    ].join("\n");
    await safeWriteText(path.join(IMAGE_ROOT, `${args.runId}.summary.md`), `${summary}\n`, IMAGE_ROOT);
  }

  return manifest;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runTotalboardshopSourceIngest(args);
  console.log(`run ${result.runId}`);
  console.log(`source_run ${result.sourceRunId}`);
  console.log(`downloaded ${result.downloadedImageCount}`);
  console.log(`failed ${result.failedImageCount}`);
  console.log(`output_root ${result.outputRoot}`);
  console.log(`validate_only ${result.validateOnly ? "yes" : "no"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
