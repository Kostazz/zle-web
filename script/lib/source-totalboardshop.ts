import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeAuditChainHash, readLatestAuditHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { extFromContentType, jitterDelay, normalizeAllowedUrl, safeFetchBinary, type FetchLimits } from "./fetch-utils.ts";
import { ensureSourceRunDirs, type CrawlLog, type SourceDatasetManifest, type SourceProductRecord, writeJsonFile } from "./source-dataset.ts";
import { createFingerprint, createSourceProductKey, extractBrandListingProductLinks, parseTbsProductPage } from "./tbs-parser.ts";

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
    const sourceProductKey = createSourceProductKey(sourceSlug, sourceUrl);
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
      crawlLog.skippedProducts.push({
        sourceUrl,
        reasonCode: "missing_images",
        detail: "No allowlisted image successfully downloaded",
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
  };

  const datasetPath = path.join(runDir, "dataset.json");
  const productsPath = path.join(runDir, "products.json");
  const crawlLogPath = path.join(runDir, "crawl-log.json");

  await writeJsonFile(datasetPath, dataset);
  await writeJsonFile(productsPath, products);
  await writeJsonFile(crawlLogPath, crawlLog);

  const previousRunHash = await readLatestAuditHash(options.outputRoot);
  const auditArtifacts = {
    dataset: { path: "dataset.json", sha256: await sha256File(datasetPath) },
    products: { path: "products.json", sha256: await sha256File(productsPath) },
    crawlLog: { path: "crawl-log.json", sha256: await sha256File(crawlLogPath) },
  };

  const currentRunHash = computeAuditChainHash(options.runId, auditArtifacts, previousRunHash);
  const audit: AuditChainRecord = {
    runId: options.runId,
    createdAt: new Date().toISOString(),
    artifacts: auditArtifacts,
    chain: {
      previousRunHash,
      currentRunHash,
    },
  };

  const auditPath = path.join(runDir, "audit.json");
  await writeJsonFile(auditPath, audit);

  return {
    runDir,
    datasetPath,
    productsPath,
    crawlLogPath,
    auditPath,
    productCount: products.length,
    imageCount: dataset.imageCount,
  };
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
