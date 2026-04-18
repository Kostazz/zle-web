import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeAuditChainHash, readLatestAuditHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { extFromContentType, jitterDelay, normalizeAllowedUrl, safeFetchBinary, type FetchLimits } from "./fetch-utils.ts";
import { ensureSourceRunDirs, type CrawlLog, type SourceDatasetManifest, type SourceProductRecord, writeJsonFile } from "./source-dataset.ts";
import { createFingerprint, createSourceProductKey, extractBrandListingProductLinks, parseTbsProductPage, sanitizeSlug } from "./tbs-parser.ts";



export type ManualTrustedProductSnapshot = {
  sourceUrl: string;
  title: string;
  brand: string;
  description: string;
  price: number;
  currency: "CZK";
  availability: string;
  category: string;
  images: string[];
  sizes?: string[];
  variants?: string[];
};

export type ManualTrustedSourceRunOptions = {
  runId: string;
  outputRoot: string;
  inputPath: string;
  snapshot: ManualTrustedProductSnapshot;
};

function deriveStructuredFromTitle(title: string): SourceProductRecord["structured"] {
  const lowered = title.toLowerCase();
  const productType = lowered.includes("mikina") ? "mikina" : lowered.includes("triko") ? "triko" : null;
  const audience = lowered.includes("pánská") ? "pánská" : lowered.includes("dámská") ? "dámská" : null;
  const lineNormalized = lowered.includes("skateboards") ? "skateboards" : null;
  const designMatch = title.match(/[–-]\s*([^()]+?)(?:\(|$)/);
  const designNormalized = designMatch?.[1]?.trim().toLowerCase() || null;
  const colorBlock = title.match(/\(([^)]+)\)/)?.[1] ?? "";
  const colorTokens = colorBlock.split(/[\/,]/).map((token) => token.trim().toLowerCase()).filter(Boolean);
  return { productType, audience, lineNormalized, designNormalized, colorTokens };
}

function normalizeManualBrand(rawBrand: string): "zle" {
  const normalized = rawBrand.toLowerCase().replace(/\s+/g, " ").trim();
  if (["zle", "zle skateboarding", "zle skateboards"].includes(normalized)) return "zle";
  throw new Error(`brand must be a trusted ZLE value, received: ${rawBrand || "<empty>"}`);
}

function formatManualPrice(price: number, currency: string): string {
  const normalizedPrice = Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/\.00$/, "");
  if (currency !== "CZK") throw new Error(`currency must be CZK, received: ${currency}`);
  return `${normalizedPrice.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kč`;
}

function validateManualSnapshot(snapshot: unknown): ManualTrustedProductSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("manual snapshot must be a JSON object");
  const candidate = snapshot as Record<string, unknown>;
  const requiredStringFields = ["sourceUrl", "title", "brand", "description", "availability", "category"] as const;
  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== "string" || !candidate[field]?.trim()) throw new Error(`missing required field: ${field}`);
  }
  if (typeof candidate.price !== "number" || !Number.isFinite(candidate.price) || candidate.price < 0) throw new Error("price must be a non-negative number");
  if (candidate.currency !== "CZK") throw new Error("currency must be CZK");
  if (!Array.isArray(candidate.images) || candidate.images.length < 1) throw new Error("images must contain at least one URL");
  const images = candidate.images.map((value, index) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`images[${index}] must be a non-empty string`);
    normalizeAllowedUrl(value);
    return value;
  });
  normalizeAllowedUrl(String(candidate.sourceUrl));
  const sizes = candidate.sizes === undefined ? [] : Array.isArray(candidate.sizes) ? candidate.sizes : (()=>{ throw new Error("sizes must be an array of strings when provided"); })();
  const variants = candidate.variants === undefined ? [] : Array.isArray(candidate.variants) ? candidate.variants : (()=>{ throw new Error("variants must be an array of strings when provided"); })();
  for (const [label, values] of [["sizes", sizes], ["variants", variants]] as const) {
    values.forEach((value, index) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${label}[${index}] must be a non-empty string`);
    });
  }
  return {
    sourceUrl: String(candidate.sourceUrl),
    title: String(candidate.title).trim(),
    brand: String(candidate.brand).trim(),
    description: String(candidate.description).trim(),
    price: candidate.price as number,
    currency: "CZK",
    availability: String(candidate.availability).trim(),
    category: String(candidate.category).trim(),
    images,
    sizes: sizes.map((value) => String(value).trim()).filter(Boolean),
    variants: variants.map((value) => String(value).trim()).filter(Boolean),
  };
}

async function writeSourceArtifacts(options: {
  runId: string;
  outputRoot: string;
  dataset: SourceDatasetManifest;
  products: SourceProductRecord[];
  crawlLog: CrawlLog;
}): Promise<{ runDir: string; datasetPath: string; productsPath: string; crawlLogPath: string; auditPath: string; productCount: number; imageCount: number }> {
  const { runDir } = await ensureSourceRunDirs(options.outputRoot, options.runId);
  const datasetPath = path.join(runDir, "dataset.json");
  const productsPath = path.join(runDir, "products.json");
  const crawlLogPath = path.join(runDir, "crawl-log.json");

  await writeJsonFile(datasetPath, options.dataset);
  await writeJsonFile(productsPath, options.products);
  await writeJsonFile(crawlLogPath, options.crawlLog);

  const previousRunHash = await readLatestAuditHash(options.outputRoot);
  const auditArtifacts = {
    dataset: { path: "dataset.json", sha256: await sha256File(datasetPath) },
    products: { path: "products.json", sha256: await sha256File(productsPath) },
    crawlLog: { path: "crawl-log.json", sha256: await sha256File(crawlLogPath) },
  };

  const currentRunHash = computeAuditChainHash(options.runId, auditArtifacts, previousRunHash);
  const audit: AuditChainRecord & { sourceMode: SourceDatasetManifest["mode"]; trust: NonNullable<CrawlLog["trust"]> } = {
    runId: options.runId,
    createdAt: new Date().toISOString(),
    artifacts: auditArtifacts,
    chain: { previousRunHash, currentRunHash },
    sourceMode: options.dataset.mode,
    trust: options.crawlLog.trust ?? { sourceType: "live-crawl", operatorProvided: false, notes: [] },
  };

  const auditPath = path.join(runDir, "audit.json");
  await writeJsonFile(auditPath, audit);

  return { runDir, datasetPath, productsPath, crawlLogPath, auditPath, productCount: options.products.length, imageCount: options.dataset.imageCount };
}

export function parseManualTrustedProductSnapshot(input: string): ManualTrustedProductSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`invalid manual snapshot JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateManualSnapshot(parsed);
}

export async function runTotalboardshopManualSourceAgent(options: ManualTrustedSourceRunOptions): Promise<{ runDir: string; datasetPath: string; productsPath: string; crawlLogPath: string; auditPath: string; productCount: number; imageCount: number }> {
  const snapshot = validateManualSnapshot(options.snapshot);
  const sourceUrl = normalizeAllowedUrl(snapshot.sourceUrl).toString();
  const sourceSlug = sanitizeSlug(new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) ?? "");
  if (!sourceSlug) throw new Error("sourceUrl must contain a stable product slug path segment");
  const sourceProductKey = createSourceProductKey(sourceSlug);

  const productRecord: SourceProductRecord = {
    sourceProductKey,
    sourceUrl,
    sourceSlug,
    title: snapshot.title,
    brandRaw: snapshot.brand,
    brandNormalized: normalizeManualBrand(snapshot.brand),
    categoryRaw: snapshot.category,
    tagRaw: snapshot.availability,
    priceText: formatManualPrice(snapshot.price, snapshot.currency),
    priceCzk: Math.round(snapshot.price),
    optionsRaw: [...(snapshot.variants ?? [])],
    sizes: [...(snapshot.sizes ?? [])],
    descriptionRaw: snapshot.description,
    structured: deriveStructuredFromTitle(snapshot.title),
    imageUrls: [...snapshot.images],
    downloadedImages: [...snapshot.images],
    downloadedImageHashes: [],
    fingerprint: createFingerprint({
      sourceUrl, title: snapshot.title, brand: snapshot.brand, category: snapshot.category, price: snapshot.price, currency: snapshot.currency, availability: snapshot.availability, images: snapshot.images, sizes: snapshot.sizes ?? [], variants: snapshot.variants ?? [], inputType: "manual-trusted-snapshot",
    }),
  };

  const crawlLog: CrawlLog = {
    seedUrls: [],
    visitedPages: [],
    skippedUrls: [],
    skippedProducts: [],
    skippedProductSummary: {},
    downloadErrors: [],
    limits: { maxPages: 1, maxProducts: 1, maxImagesPerProduct: snapshot.images.length, maxImageBytes: 0 },
    mode: "manual-trusted-snapshot",
    trust: { sourceType: "manual-trusted", operatorProvided: true, inputPath: options.inputPath, notes: ["Operator-provided local trusted snapshot used instead of live crawl.", "No network fetch was attempted in this manual-source path."] },
  };

  const dataset: SourceDatasetManifest = {
    runId: options.runId,
    source: "totalboardshop",
    sourceRoot: "https://totalboardshop.cz/",
    createdAt: new Date().toISOString(),
    mode: "manual-trusted-snapshot",
    scope: { brand: "ZLE", matchMode: "exact" },
    productCount: 1,
    imageCount: snapshot.images.length,
    productsPath: "products.json",
    crawlLogPath: "crawl-log.json",
    auditPath: "audit.json",
    imagesPath: "images",
    sourceInput: { type: "manual-trusted", operatorProvided: true, inputPath: options.inputPath },
  };

  return writeSourceArtifacts({ runId: options.runId, outputRoot: options.outputRoot, dataset, products: [productRecord], crawlLog });
}
function summarizeSkippedProducts(skippedProducts: CrawlLog["skippedProducts"]): Record<string, number> {
  return skippedProducts.reduce<Record<string, number>>((summary, item) => {
    summary[item.reasonCode] = (summary[item.reasonCode] ?? 0) + 1;
    return summary;
  }, {});
}

export type SourceRunOptions = {
  runId: string;
  outputRoot: string;
  seedUrl: string;
  maxPages: number;
  maxProducts: number;
  maxImagesPerProduct: number;
  maxImageBytes: number;
};

const DEFAULT_FETCH_LIMITS: Omit<FetchLimits, "maxImageBytes"> = {
  timeoutMs: 15_000,
  maxHtmlBytes: 1_500_000,
  minDelayMs: 100,
  maxDelayMs: 400,
};

function inferExt(url: string, contentType: string): string {
  const fromCt = extFromContentType(contentType);
  if (fromCt !== ".img") return fromCt;
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return ".jpg";
  if (pathname.endsWith(".png")) return ".png";
  if (pathname.endsWith(".webp")) return ".webp";
  return ".jpg";
}

export async function runTotalboardshopSourceAgent(options: SourceRunOptions): Promise<{ runDir: string; datasetPath: string; productsPath: string; crawlLogPath: string; auditPath: string; productCount: number; imageCount: number }> {
  normalizeAllowedUrl(options.seedUrl);
  const { runDir, imageRoot } = await ensureSourceRunDirs(options.outputRoot, options.runId);

  const crawlLog: CrawlLog = {
    seedUrls: [options.seedUrl],
    visitedPages: [],
    skippedUrls: [],
    skippedProducts: [],
    skippedProductSummary: {},
    downloadErrors: [],
    limits: {
      maxPages: options.maxPages,
      maxProducts: options.maxProducts,
      maxImagesPerProduct: options.maxImagesPerProduct,
      maxImageBytes: options.maxImageBytes,
    },
  };

  const fetchLimits: FetchLimits = {
    ...DEFAULT_FETCH_LIMITS,
    maxImageBytes: options.maxImageBytes,
  };

  const listingFetch = await safeFetchBinary(options.seedUrl, fetchLimits, "html");
  const listingHtml = listingFetch.body.toString("utf8");
  crawlLog.visitedPages.push(options.seedUrl);

  const candidateLinks = extractBrandListingProductLinks(options.seedUrl, listingHtml);
  const allowedCandidates = candidateLinks.slice(0, options.maxPages);
  const products: SourceProductRecord[] = [];

  for (const sourceUrl of allowedCandidates) {
    if (products.length >= options.maxProducts) {
      crawlLog.skippedUrls.push({ url: sourceUrl, reasonCode: "max_products_reached" });
      continue;
    }

    await jitterDelay(fetchLimits);

    let productHtml = "";
    try {
      normalizeAllowedUrl(sourceUrl);
      const fetched = await safeFetchBinary(sourceUrl, fetchLimits, "html");
      productHtml = fetched.body.toString("utf8");
      crawlLog.visitedPages.push(sourceUrl);
    } catch (error) {
      crawlLog.skippedUrls.push({
        url: sourceUrl,
        reasonCode: "fetch_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const parsed = parseTbsProductPage(sourceUrl, productHtml);
    if (!parsed.product) {
      crawlLog.skippedProducts.push({
        sourceUrl,
        reasonCode: parsed.failure?.code ?? "parse_failed",
        detail: parsed.failure?.reason,
      });
      continue;
    }

    const sourceSlug = parsed.product.sourceSlug;
    let sourceProductKey = "";
    try {
      sourceProductKey = createSourceProductKey(sourceSlug);
    } catch (error) {
      crawlLog.skippedProducts.push({
        sourceUrl,
        reasonCode: "missing_stable_source_identity",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const productImageDir = path.join(imageRoot, sourceProductKey);
    await fs.promises.mkdir(productImageDir, { recursive: true });

    const downloadedImages: string[] = [];
    const downloadedImageHashes: string[] = [];
    const allowlistedImages = parsed.product.imageUrls.filter((imageUrl) => {
      try {
        normalizeAllowedUrl(imageUrl);
        return true;
      } catch {
        crawlLog.downloadErrors.push({
          sourceUrl,
          imageUrl,
          reasonCode: "image_host_blocked",
          detail: "Image URL is outside allowlisted hosts",
        });
        return false;
      }
    });

    for (let i = 0; i < allowlistedImages.length && i < options.maxImagesPerProduct; i++) {
      const imageUrl = allowlistedImages[i];
      try {
        await jitterDelay(fetchLimits);
        const fetchedImage = await safeFetchBinary(imageUrl, fetchLimits, "image");
        const ext = inferExt(imageUrl, fetchedImage.contentType);
        const fileName = `${String(i + 1).padStart(2, "0")}${ext}`;
        const relativePath = path.posix.join("images", sourceProductKey, fileName);
        await fs.promises.writeFile(path.join(runDir, relativePath), fetchedImage.body);
        downloadedImages.push(relativePath);
        downloadedImageHashes.push(`sha256:${crypto.createHash("sha256").update(fetchedImage.body).digest("hex")}`);
      } catch (error) {
        crawlLog.downloadErrors.push({
          sourceUrl,
          imageUrl,
          reasonCode: "image_download_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (downloadedImages.length < 1) {
      const imageFailure = parsed.product.imageExtractionFailure;
      crawlLog.skippedProducts.push({
        sourceUrl,
        reasonCode: imageFailure?.code ?? "missing_images",
        detail: imageFailure?.reason ?? "No allowlisted image successfully downloaded",
      });
      continue;
    }

    const normalizedTitle = parsed.product.title.toLowerCase();
    if (parsed.product.brandNormalized !== "zle") {
      crawlLog.skippedProducts.push({ sourceUrl, reasonCode: "brand_not_zle" });
      continue;
    }

    if (normalizedTitle.includes(" santa cruz ") || normalizedTitle.includes(" thrasher ")) {
      crawlLog.skippedProducts.push({ sourceUrl, reasonCode: "contradictory_title_brand" });
      continue;
    }

    const productRecord: SourceProductRecord = {
      sourceProductKey,
      sourceUrl,
      sourceSlug,
      title: parsed.product.title,
      brandRaw: parsed.product.brandRaw,
      brandNormalized: parsed.product.brandNormalized,
      categoryRaw: parsed.product.categoryRaw,
      tagRaw: parsed.product.tagRaw,
      priceText: parsed.product.priceText,
      priceCzk: parsed.product.priceCzk,
      optionsRaw: parsed.product.optionsRaw,
      sizes: parsed.product.sizes,
      descriptionRaw: [parsed.product.descriptionRaw, parsed.product.additionalInfoRaw].filter(Boolean).join("\n\n"),
      structured: parsed.product.structured,
      imageUrls: parsed.product.imageUrls,
      downloadedImages,
      downloadedImageHashes,
      fingerprint: createFingerprint({
        sourceUrl,
        title: parsed.product.title,
        brand: parsed.product.brandRaw,
        category: parsed.product.categoryRaw,
        priceText: parsed.product.priceText,
        imageUrls: parsed.product.imageUrls,
      }),
    };

    products.push(productRecord);
  }

  crawlLog.skippedProductSummary = summarizeSkippedProducts(crawlLog.skippedProducts);

  const dataset: SourceDatasetManifest = {
    runId: options.runId,
    source: "totalboardshop",
    sourceRoot: "https://totalboardshop.cz/",
    createdAt: new Date().toISOString(),
    mode: "crawl-snapshot",
    scope: {
      brand: "ZLE",
      matchMode: "exact",
    },
    productCount: products.length,
    imageCount: products.reduce((acc, item) => acc + item.downloadedImages.length, 0),
    productsPath: "products.json",
    crawlLogPath: "crawl-log.json",
    auditPath: "audit.json",
    imagesPath: "images",
    sourceInput: {
      type: "live-crawl",
      operatorProvided: false,
    },
  };

  crawlLog.mode = "crawl-snapshot";
  crawlLog.trust = {
    sourceType: "live-crawl",
    operatorProvided: false,
    notes: ["Artifacts originated from the live TotalBoardShop crawl path."],
  };

  return writeSourceArtifacts({
    runId: options.runId,
    outputRoot: options.outputRoot,
    dataset,
    products,
    crawlLog,
  });
}

export function createSourceRunId(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const rand = crypto.randomBytes(3).toString("hex");
  return `tbs-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
}
