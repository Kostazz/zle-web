import fs from "node:fs";
import path from "node:path";

export type SourceDatasetManifest = {
  runId: string;
  source: "totalboardshop";
  sourceRoot: "https://totalboardshop.cz/";
  createdAt: string;
  mode: "crawl-snapshot";
  scope: {
    brand: "ZLE";
    matchMode: "exact";
  };
  productCount: number;
  imageCount: number;
  productsPath: "products.json";
  crawlLogPath: "crawl-log.json";
  auditPath: "audit.json";
  imagesPath: "images";
};

export type SourceProductRecord = {
  sourceProductKey: string;
  sourceUrl: string;
  sourceSlug: string;
  title: string;
  brandRaw: string;
  brandNormalized: "zle";
  categoryRaw: string;
  tagRaw: string | null;
  priceText: string;
  priceCzk: number | null;
  optionsRaw: string[];
  sizes: string[];
  descriptionRaw: string;
  structured: {
    productType: string | null;
    audience: string | null;
    lineNormalized: string | null;
    designNormalized: string | null;
    colorTokens: string[];
  };
  imageUrls: string[];
  downloadedImages: string[];
  fingerprint: string;
};

export type CrawlLog = {
  seedUrls: string[];
  visitedPages: string[];
  skippedUrls: Array<{ url: string; reasonCode: string; detail?: string }>;
  skippedProducts: Array<{ sourceUrl: string; reasonCode: string; detail?: string }>;
  downloadErrors: Array<{ sourceUrl: string; imageUrl?: string; reasonCode: string; detail: string }>;
  limits: {
    maxPages: number;
    maxProducts: number;
    maxImagesPerProduct: number;
    maxImageBytes: number;
  };
};

export async function ensureSourceRunDirs(outputRoot: string, runId: string): Promise<{ runDir: string; imageRoot: string }> {
  const runDir = path.join(outputRoot, runId);
  const imageRoot = path.join(runDir, "images");
  await fs.promises.mkdir(imageRoot, { recursive: true });
  return { runDir, imageRoot };
}

export async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, JSON.stringify(value, null, 2), "utf8");
}
