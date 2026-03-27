import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalizeCategory, SUPPORTED_INTERNAL_CATEGORIES } from "./category-normalization.ts";
import type { SourceProductRecord } from "./source-dataset.ts";
import type { Product } from "@shared/schema";

export const DEFAULT_PUBLISH_REPORT_ROOT = path.resolve("tmp", "publish-reports");
export const DEFAULT_SOURCE_DATASET_ROOT = path.resolve("tmp", "source-datasets");
export const DEFAULT_LIVE_IMAGE_ROOT = path.resolve("client", "public", "images", "products");
export const DEFAULT_STOCK = 100;
const CANONICAL_SIZE_SET = new Set(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]);
const NON_SIZE_OPTION_PATTERNS = [
  /^vyberte možnost$/i,
  /^vyberte moznost$/i,
  /^zvolte možnost$/i,
  /^zvolte moznost$/i,
  /^vyberte variantu$/i,
  /^choose an? option$/i,
  /^select an? option$/i,
  /^choose size$/i,
  /^select size$/i,
  /^velikost$/i,
  /^size$/i,
];

const publishItemSchema = z.object({
  sourceProductKey: z.string().min(1),
  resolutionType: z.enum(["map_to_existing", "new_candidate"]),
  approvedLocalProductId: z.union([z.string().min(1), z.null()]),
  liveTargetKey: z.string().min(1),
  plannedOutputs: z.array(z.string()),
  publishedOutputs: z.array(z.string()),
  removedManagedOutputs: z.array(z.string()),
  status: z.enum(["published", "failed", "skipped"]),
  reasonCodes: z.array(z.string()),
  errorMessage: z.string().optional(),
}).strict();

const publishReportSchema = z.object({
  runId: z.string().min(1),
  sourceRunId: z.string().min(1),
  reviewRunId: z.string().min(1),
  stagingRunId: z.string().min(1),
  gateRunId: z.string().min(1),
  createdAt: z.string().min(1),
  summary: z.object({
    totalGateItems: z.number().int().nonnegative(),
    readyForPublish: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    mappedToExisting: z.number().int().nonnegative(),
    newCandidatePublished: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(publishItemSchema),
  debug: z.object({
    hadPartialResults: z.boolean(),
    errorStage: z.enum(["validation", "execution"]),
  }).optional(),
}).strict();

const sourceProductSchema: z.ZodType<SourceProductRecord> = z.object({
  sourceProductKey: z.string().min(1),
  sourceUrl: z.string().min(1),
  sourceSlug: z.string().min(1),
  title: z.string().min(1),
  brandRaw: z.string(),
  brandNormalized: z.literal("zle"),
  categoryRaw: z.string().min(1),
  tagRaw: z.union([z.string(), z.null()]),
  priceText: z.string(),
  priceCzk: z.union([z.number().int().nonnegative(), z.null()]),
  optionsRaw: z.array(z.string()),
  sizes: z.array(z.string()),
  descriptionRaw: z.string(),
  structured: z.object({
    productType: z.union([z.string(), z.null()]),
    audience: z.union([z.string(), z.null()]),
    lineNormalized: z.union([z.string(), z.null()]),
    designNormalized: z.union([z.string(), z.null()]),
    colorTokens: z.array(z.string()),
  }).strict(),
  imageUrls: z.array(z.string()),
  downloadedImages: z.array(z.string()),
  ingestedImagePaths: z.array(z.string()).optional(),
  downloadedImageHashes: z.array(z.string()),
  fingerprint: z.string().min(1),
}).strict();

const sourceProductsSchema = z.array(sourceProductSchema);

export type ProductWriter = {
  upsertProduct(product: Product): Promise<{ action: "inserted" | "updated"; product: Product }>;
};

export type ImportTotalboardshopProductsInput = {
  runId: string;
  reportRoot?: string;
  sourceRoot?: string;
  liveImageRoot?: string;
  productWriter: ProductWriter;
  logger?: Pick<Console, "log" | "error">;
};

export type ImportSummary = {
  runId: string;
  sourceRunId: string;
  totalPublishedItems: number;
  importedNewCandidateItems: number;
  skippedItems: number;
  failedItems: number;
  inserted: number;
  updated: number;
};

export type ImportResult = {
  summary: ImportSummary;
  products: Product[];
};

function readJsonFile(targetPath: string, label: string): unknown {
  if (!fs.existsSync(targetPath)) throw new Error(`Missing required artifact: ${label} at ${targetPath}`);
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertPortablePathInside(root: string, child: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedRoot, resolvedChild);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes allowed root: ${child}`);
  }
  return resolvedChild;
}

function listManagedLiveImages(productDir: string, liveTargetKey: string, liveImageRoot: string): { image: string; images: string[] } {
  const safeDir = assertPortablePathInside(liveImageRoot, productDir, "Live asset directory");
  if (!fs.existsSync(safeDir)) throw new Error(`Missing live asset directory for ${liveTargetKey}: ${productDir}`);
  const entries = fs.readdirSync(safeDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const coverCandidates = ["cover.jpg", "cover.webp"];
  const main = coverCandidates.find((name) => files.includes(name));
  if (!main) throw new Error(`Missing required main image for ${liveTargetKey}: expected cover.jpg or cover.webp`);

  const gallery = files
    .filter((name) => /^(?:cover|\d{2})\.(?:jpg|webp)$/i.test(name))
    .sort((a, b) => {
      const rank = (value: string): [number, number, number] => {
        const lowered = value.toLowerCase();
        const isCover = lowered.startsWith("cover.") ? 0 : 1;
        const sequence = isCover === 0 ? 0 : Number.parseInt(lowered.slice(0, 2), 10);
        const extRank = lowered.endsWith(".jpg") ? 0 : 1;
        return [isCover, Number.isFinite(sequence) ? sequence : 999, extRank];
      };
      const left = rank(a);
      const right = rank(b);
      return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || a.localeCompare(b);
    })
    .filter((name, index, all) => {
      if (index === 0) return true;
      const stem = name.replace(/\.(jpg|webp)$/i, "");
      const priorPreferred = all.slice(0, index).find((candidate) => candidate.replace(/\.(jpg|webp)$/i, "") === stem);
      return !priorPreferred;
    })
    .map((name) => `/images/products/${liveTargetKey}/${name}`);

  return {
    image: `/images/products/${liveTargetKey}/${main}`,
    images: gallery,
  };
}

function normalizeCategory(source: SourceProductRecord): Product["category"] {
  const normalized = canonicalizeCategory(source.structured.productType ?? source.categoryRaw);
  if (!normalized || !SUPPORTED_INTERNAL_CATEGORIES.includes(normalized as (typeof SUPPORTED_INTERNAL_CATEGORIES)[number])) {
    throw new Error(
      `Unsupported catalog category for ${source.sourceProductKey}: categoryRaw="${source.categoryRaw}" productType="${source.structured.productType ?? "null"}" normalized="${normalized ?? "null"}" supported=${SUPPORTED_INTERNAL_CATEGORIES.join(",")}`,
    );
  }
  return normalized;
}

function normalizeSizeTokenStrict(rawValue: string): string | null {
  const compact = rawValue.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (!compact) return null;
  if (/^3XL$/.test(compact)) return "XXXL";
  if (/^2XL$/.test(compact)) return "XXL";
  if (!CANONICAL_SIZE_SET.has(compact)) return null;
  return compact;
}

function isKnownNonSizeOption(rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  return NON_SIZE_OPTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function deriveSizesFromOptionsRawStrict(optionsRaw: string[]): string[] {
  const parsed: string[] = [];
  const seen = new Set<string>();

  for (const option of optionsRaw) {
    if (isKnownNonSizeOption(option)) continue;
    const normalized = normalizeSizeTokenStrict(option);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parsed.push(normalized);
  }

  return parsed;
}

function resolveImportedSizes(source: SourceProductRecord): string[] {
  if (source.sizes.length > 0) return [...source.sizes];
  return deriveSizesFromOptionsRawStrict(source.optionsRaw);
}

export function mapPublishedItemToProduct(source: SourceProductRecord, liveTargetKey: string, liveImageRoot = DEFAULT_LIVE_IMAGE_ROOT): Product {
  if (!source.title.trim()) throw new Error(`Missing required title for ${source.sourceProductKey}`);
  if (source.priceCzk === null || !Number.isInteger(source.priceCzk) || source.priceCzk < 0) {
    throw new Error(`Missing required priceCzk for ${source.sourceProductKey}`);
  }

  const productDir = assertPortablePathInside(liveImageRoot, path.join(liveImageRoot, liveTargetKey), "Live asset directory");
  const { image, images } = listManagedLiveImages(productDir, liveTargetKey, liveImageRoot);
  const ownedPrefix = `/images/products/${liveTargetKey}/`;
  const ownedImages = images.filter((img) => img.startsWith(ownedPrefix));
  if (ownedImages.length < 1) throw new Error(`No managed gallery images found for ${liveTargetKey}`);
  if (ownedImages.length !== images.length) {
    throw new Error(`Detected non-owned image path(s) while mapping ${liveTargetKey}; refusing import`);
  }
  if (!image.startsWith(ownedPrefix)) {
    throw new Error(`Detected non-owned primary image path while mapping ${liveTargetKey}; refusing import`);
  }

  return {
    id: liveTargetKey,
    name: source.title,
    price: source.priceCzk,
    sizes: resolveImportedSizes(source),
    category: normalizeCategory(source),
    description: source.descriptionRaw ?? "",
    stock: DEFAULT_STOCK,
    isActive: true,
    image,
    images: ownedImages,
    productModel: "new",
    unitCost: null,
    stockOwner: null,
    pricingMode: null,
    pricingPercent: null,
  };
}

export async function runImportTotalboardshopProducts(input: ImportTotalboardshopProductsInput): Promise<ImportResult> {
  const logger = input.logger ?? console;
  const reportRoot = path.resolve(input.reportRoot ?? DEFAULT_PUBLISH_REPORT_ROOT);
  const sourceRoot = path.resolve(input.sourceRoot ?? DEFAULT_SOURCE_DATASET_ROOT);
  const liveImageRoot = path.resolve(input.liveImageRoot ?? DEFAULT_LIVE_IMAGE_ROOT);

  const reportPath = path.join(reportRoot, `${input.runId}.publish.json`);
  const report = publishReportSchema.parse(readJsonFile(reportPath, "publish report"));
  const sourceRunId = report.sourceRunId;
  const sourceProductsPath = path.join(sourceRoot, sourceRunId, "products.json");
  const sourceProducts = sourceProductsSchema.parse(readJsonFile(sourceProductsPath, "source products"));
  const sourceByKey = new Map(sourceProducts.map((product) => [product.sourceProductKey, product]));

  const publishedItems = report.items.filter((item) => item.status === "published");
  const importableItems = publishedItems.filter((item) => item.resolutionType === "new_candidate");
  const failedItems = report.items.filter((item) => item.status === "failed").length;
  const skippedItems = report.items.filter((item) => item.status === "skipped" || item.resolutionType === "map_to_existing").length;

  const importedProducts: Product[] = [];
  let inserted = 0;
  let updated = 0;

  for (const item of importableItems) {
    const source = sourceByKey.get(item.sourceProductKey);
    if (!source) throw new Error(`Missing source product match for ${item.sourceProductKey} in source run ${sourceRunId}`);
    const product = mapPublishedItemToProduct(source, item.liveTargetKey, liveImageRoot);
    const result = await input.productWriter.upsertProduct(product);
    importedProducts.push(result.product);
    if (result.action === "inserted") inserted += 1;
    else updated += 1;
  }

  const summary: ImportSummary = {
    runId: input.runId,
    sourceRunId,
    totalPublishedItems: publishedItems.length,
    importedNewCandidateItems: importableItems.length,
    skippedItems,
    failedItems,
    inserted,
    updated,
  };

  logger.log(`run id: ${summary.runId}`);
  logger.log(`source run id: ${summary.sourceRunId}`);
  logger.log(`total published items: ${summary.totalPublishedItems}`);
  logger.log(`imported new_candidate items: ${summary.importedNewCandidateItems}`);
  logger.log(`skipped items: ${summary.skippedItems}`);
  logger.log(`failed items: ${summary.failedItems}`);

  return { summary, products: importedProducts };
}
