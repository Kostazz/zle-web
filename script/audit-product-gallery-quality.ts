import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

import type { Product } from "@shared/schema";

export type FindingLevel = "info" | "warning" | "risk" | "error";

export type FindingCode =
  | "single_image_product"
  | "low_image_count"
  | "possible_size_chart_cover"
  | "possible_size_chart_in_gallery"
  | "possible_brand_logo_cover";

export type AuditFinding = {
  level: FindingLevel;
  code: FindingCode;
  productId: string;
  category: string;
  imageCount: number;
  message: string;
  evidence: {
    imagePath?: string;
    reason: string;
    role: "cover" | "gallery" | "unknown";
  };
};

export type ProductAuditRow = {
  productId: string;
  name: string;
  category: string;
  coverImage: string | null;
  galleryImages: string[];
  imageCount: number;
  findings: AuditFinding[];
};

type ImageSignals = {
  width: number;
  height: number;
  aspectRatio: number;
  whiteRatio: number;
  darkRatio: number;
  edgeDensity: number;
  colorfulness: number;
};

export type AuditReport = {
  runId: string;
  createdAt: string;
  status: "ok" | "failed";
  readOnly: true;
  counts: {
    products: number;
    errors: number;
    risks: number;
    warnings: number;
    info: number;
  };
  thresholds: Record<string, number>;
  galleryImageCountByCategory: Record<string, Record<string, number>>;
  productsNeedingManualReview: string[];
  findings: AuditFinding[];
  products: ProductAuditRow[];
};

const CATEGORY_MIN_IMAGES: Record<string, number> = {
  tee: 2,
  hoodie: 3,
  cap: 2,
};

const SIZE_CHART_HINTS = [
  "size-chart",
  "size_chart",
  "sizechart",
  "measurement-chart",
  "measurement_chart",
  "measurements",
  "tabulka-velikosti",
  "velikostni-tabulka",
  "rozmery",
  "size guide",
  "size-guide",
];

const BRAND_LOGO_HINTS = ["logo", "brandmark", "wordmark", "logotype", "znacka"];

function normalizeRunId(raw: string): string {
  const runId = raw.trim();
  if (!runId) throw new Error("Missing required --run-id <runId> argument.");
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error("Invalid --run-id: only [A-Za-z0-9._-] allowed.");
  }
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\")) {
    throw new Error("Invalid --run-id: path traversal and separators are not allowed.");
  }
  return runId;
}

function parseArgs(argv: string[]): { runId: string } {
  const flagIndex = argv.indexOf("--run-id");
  const rawRunId = flagIndex === -1 ? "" : argv[flagIndex + 1] ?? "";
  return { runId: normalizeRunId(rawRunId) };
}

function normalizeCategory(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (normalized.includes("hood")) return "hoodie";
  if (normalized.includes("tee") || normalized.includes("tricko") || normalized.includes("t-shirt") || normalized === "shirt") return "tee";
  if (normalized.includes("cap") || normalized.includes("hat") || normalized.includes("kšilt")) return "cap";
  return normalized || "unknown";
}

function tokenizePath(value: string): string {
  return value.toLowerCase().replace(/[_%]+/g, "-");
}

function toAssetFilesystemPath(imagePath: string): string | null {
  const normalized = imagePath.trim();
  if (!normalized.startsWith("/images/products/")) return null;
  const withoutLeading = normalized.slice(1);
  const candidate = path.resolve("client", "public", withoutLeading);
  const allowedRoot = path.resolve("client", "public", "images", "products");
  const rel = path.relative(allowedRoot, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return candidate;
}

export function detectSizeChartByPath(value: string): { hit: boolean; reason: string } {
  const normalized = tokenizePath(value);
  const matched = SIZE_CHART_HINTS.find((hint) => normalized.includes(hint));
  return matched
    ? { hit: true, reason: `filename/path contains '${matched}'` }
    : { hit: false, reason: "no conservative size-chart hint" };
}

export function detectBrandLogoByPath(value: string): { hit: boolean; reason: string } {
  const normalized = tokenizePath(value);
  const hasLogoHint = BRAND_LOGO_HINTS.some((hint) => normalized.includes(hint));
  const hasProductHint = /(hood|tee|shirt|cap|mikina|triko|front|back)/.test(normalized);
  if (hasLogoHint && !hasProductHint) {
    return { hit: true, reason: "filename/path suggests logo/brandmark without product-view hint" };
  }
  return { hit: false, reason: "no conservative logo-only hint" };
}

export function inferSizeChartFromSignals(signals: ImageSignals): { hit: boolean; reason: string } {
  const isChartLike =
    signals.whiteRatio >= 0.66 &&
    signals.edgeDensity >= 0.14 &&
    signals.colorfulness <= 0.19 &&
    signals.aspectRatio >= 0.65 &&
    signals.aspectRatio <= 1.75;

  return isChartLike
    ? {
        hit: true,
        reason: `pixels suggest chart-like image (whiteRatio=${signals.whiteRatio.toFixed(2)}, edgeDensity=${signals.edgeDensity.toFixed(2)}, colorfulness=${signals.colorfulness.toFixed(2)})`,
      }
    : { hit: false, reason: "pixel metadata does not confidently indicate chart-like composition" };
}

export function inferLogoCoverFromSignals(signals: ImageSignals): { hit: boolean; reason: string } {
  const isLogoLike =
    signals.whiteRatio >= 0.72 &&
    signals.edgeDensity >= 0.02 &&
    signals.edgeDensity <= 0.14 &&
    signals.colorfulness <= 0.12 &&
    signals.aspectRatio >= 0.7 &&
    signals.aspectRatio <= 1.8;

  return isLogoLike
    ? {
        hit: true,
        reason: `pixels suggest sparse/logo-like composition (whiteRatio=${signals.whiteRatio.toFixed(2)}, edgeDensity=${signals.edgeDensity.toFixed(2)}, colorfulness=${signals.colorfulness.toFixed(2)})`,
      }
    : { hit: false, reason: "pixel metadata does not confidently indicate logo-only composition" };
}

function toDeclaredImages(product: Product): string[] {
  const values: string[] = [];
  if (typeof product.image === "string" && product.image.trim()) values.push(product.image.trim());
  if (Array.isArray(product.images)) {
    for (const image of product.images) {
      if (typeof image === "string" && image.trim()) values.push(image.trim());
    }
  }
  return Array.from(new Set(values));
}

function inferCoverImage(product: Product, declaredImages: string[]): string | null {
  if (typeof product.image === "string" && product.image.trim()) return product.image.trim();
  return declaredImages[0] ?? null;
}

function createFinding(input: Omit<AuditFinding, "imageCount"> & { imageCount: number }): AuditFinding {
  return {
    ...input,
  };
}

export function auditProducts(
  products: Product[],
  options?: { imageSignalsByPath?: Map<string, ImageSignals> },
): Omit<AuditReport, "runId" | "createdAt" | "status"> {
  const findings: AuditFinding[] = [];
  const rows: ProductAuditRow[] = [];
  const categoryHistogram = new Map<string, Map<number, number>>();
  const manualReview = new Set<string>();
  const imageSignalsByPath = options?.imageSignalsByPath;

  for (const product of products) {
    const category = normalizeCategory(product.category);
    const declaredImages = toDeclaredImages(product);
    const coverImage = inferCoverImage(product, declaredImages);
    const galleryImages = coverImage ? declaredImages.filter((img) => img !== coverImage) : declaredImages;
    const imageCount = declaredImages.length;
    const rowFindings: AuditFinding[] = [];

    if (imageCount < 2) {
      const finding = createFinding({
        level: "warning",
        code: "single_image_product",
        productId: product.id,
        category,
        imageCount,
        message: "Product has fewer than 2 declared images.",
        evidence: { role: "unknown", reason: "declared image count below 2" },
      });
      rowFindings.push(finding);
      findings.push(finding);
      manualReview.add(product.id);
    }

    const minForCategory = CATEGORY_MIN_IMAGES[category];
    if (typeof minForCategory === "number" && imageCount < minForCategory) {
      const finding = createFinding({
        level: "risk",
        code: "low_image_count",
        productId: product.id,
        category,
        imageCount,
        message: `Category '${category}' has ${imageCount} images; expected at least ${minForCategory}.`,
        evidence: { role: "unknown", reason: `threshold for ${category} is ${minForCategory}` },
      });
      rowFindings.push(finding);
      findings.push(finding);
      manualReview.add(product.id);
    }

    if (coverImage) {
      const sizeHitByPath = detectSizeChartByPath(coverImage);
      const coverSignals = imageSignalsByPath?.get(coverImage) ?? null;
      const sizeHitByPixels = coverSignals ? inferSizeChartFromSignals(coverSignals) : { hit: false, reason: "image metadata unavailable" };
      if (sizeHitByPath.hit || sizeHitByPixels.hit) {
        const finding = createFinding({
          level: "risk",
          code: "possible_size_chart_cover",
          productId: product.id,
          category,
          imageCount,
          message: "Cover image may be a size/measurement chart (conservative filename/path or non-OCR pixel-signal heuristic).",
          evidence: {
            imagePath: coverImage,
            reason: sizeHitByPixels.hit ? sizeHitByPixels.reason : sizeHitByPath.reason,
            role: "cover",
          },
        });
        rowFindings.push(finding);
        findings.push(finding);
        manualReview.add(product.id);
      }

      const logoHitByPath = detectBrandLogoByPath(coverImage);
      const logoHitByPixels = coverSignals ? inferLogoCoverFromSignals(coverSignals) : { hit: false, reason: "image metadata unavailable" };
      if (logoHitByPath.hit || logoHitByPixels.hit) {
        const finding = createFinding({
          level: "risk",
          code: "possible_brand_logo_cover",
          productId: product.id,
          category,
          imageCount,
          message: "Cover image may be logo/brand-only (conservative filename/path or non-OCR pixel-signal heuristic).",
          evidence: {
            imagePath: coverImage,
            reason: logoHitByPixels.hit ? logoHitByPixels.reason : logoHitByPath.reason,
            role: "cover",
          },
        });
        rowFindings.push(finding);
        findings.push(finding);
        manualReview.add(product.id);
      }
    }

    for (const image of galleryImages) {
      const sizeHitByPath = detectSizeChartByPath(image);
      const gallerySignals = imageSignalsByPath?.get(image) ?? null;
      const sizeHitByPixels = gallerySignals ? inferSizeChartFromSignals(gallerySignals) : { hit: false, reason: "image metadata unavailable" };
      if (!sizeHitByPath.hit && !sizeHitByPixels.hit) continue;
      const finding = createFinding({
        level: "warning",
        code: "possible_size_chart_in_gallery",
        productId: product.id,
        category,
        imageCount,
        message: "Gallery may contain a size/measurement chart (conservative filename/path or non-OCR pixel-signal heuristic; warning only unless used as cover).",
        evidence: {
          imagePath: image,
          reason: sizeHitByPixels.hit ? sizeHitByPixels.reason : sizeHitByPath.reason,
          role: "gallery",
        },
      });
      rowFindings.push(finding);
      findings.push(finding);
    }

    if (!categoryHistogram.has(category)) categoryHistogram.set(category, new Map());
    const categoryBucket = categoryHistogram.get(category)!;
    categoryBucket.set(imageCount, (categoryBucket.get(imageCount) ?? 0) + 1);

    rows.push({
      productId: product.id,
      name: product.name,
      category,
      coverImage,
      galleryImages,
      imageCount,
      findings: rowFindings,
    });
  }

  const galleryImageCountByCategory: Record<string, Record<string, number>> = {};
  for (const [category, bucket] of Array.from(categoryHistogram.entries())) {
    galleryImageCountByCategory[category] = {};
    for (const [count, amount] of Array.from(bucket.entries()).sort((a, b) => a[0] - b[0])) {
      galleryImageCountByCategory[category][String(count)] = amount;
    }
  }

  const counts = {
    products: products.length,
    errors: findings.filter((f) => f.level === "error").length,
    risks: findings.filter((f) => f.level === "risk").length,
    warnings: findings.filter((f) => f.level === "warning").length,
    info: findings.filter((f) => f.level === "info").length,
  };

  return {
    readOnly: true,
    counts,
    thresholds: CATEGORY_MIN_IMAGES,
    galleryImageCountByCategory,
    productsNeedingManualReview: Array.from(manualReview).sort((a, b) => a.localeCompare(b)),
    findings,
    products: rows,
  };
}

async function extractImageSignalsFromPath(imagePath: string): Promise<ImageSignals | null> {
  const filePath = toAssetFilesystemPath(imagePath);
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;

  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (width <= 0 || height <= 0 || channels < 3) return null;

  const pixelCount = width * height;
  let whiteCount = 0;
  let darkCount = 0;
  let colorfulnessAccumulator = 0;
  let strongGradientCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      if (r >= 242 && g >= 242 && b >= 242) whiteCount += 1;
      if (r <= 25 && g <= 25 && b <= 25) darkCount += 1;
      colorfulnessAccumulator += (Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r)) / (3 * 255);

      if (x === 0 || y === 0) continue;
      const left = ((y * width + (x - 1)) * channels);
      const up = (((y - 1) * width + x) * channels);
      const leftGray = ((data[left] ?? 0) + (data[left + 1] ?? 0) + (data[left + 2] ?? 0)) / 3;
      const upGray = ((data[up] ?? 0) + (data[up + 1] ?? 0) + (data[up + 2] ?? 0)) / 3;
      const currentGray = (r + g + b) / 3;
      const grad = Math.abs(currentGray - leftGray) + Math.abs(currentGray - upGray);
      if (grad >= 46) strongGradientCount += 1;
    }
  }

  return {
    width,
    height,
    aspectRatio: width / height,
    whiteRatio: whiteCount / pixelCount,
    darkRatio: darkCount / pixelCount,
    edgeDensity: strongGradientCount / pixelCount,
    colorfulness: colorfulnessAccumulator / pixelCount,
  };
}

async function buildImageSignalsMap(products: Product[]): Promise<Map<string, ImageSignals>> {
  const imageSignalsByPath = new Map<string, ImageSignals>();
  const uniquePaths = new Set<string>();

  for (const product of products) {
    for (const imagePath of toDeclaredImages(product)) uniquePaths.add(imagePath);
  }

  for (const imagePath of Array.from(uniquePaths)) {
    try {
      const signals = await extractImageSignalsFromPath(imagePath);
      if (signals) imageSignalsByPath.set(imagePath, signals);
    } catch {
      // Fail closed + read-only: skip unsafe/unreadable images and preserve unknown role inference.
    }
  }

  return imageSignalsByPath;
}

function createSummaryMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# Product Gallery Quality Audit Summary");
  lines.push("");
  lines.push(`- Run ID: ${report.runId}`);
  lines.push(`- Created At: ${report.createdAt}`);
  lines.push(`- Read Only: ${report.readOnly ? "yes" : "no"}`);
  lines.push(`- Products Audited: ${report.counts.products}`);
  lines.push("");
  lines.push("## Severity Totals");
  lines.push("");
  lines.push(`- errors: ${report.counts.errors}`);
  lines.push(`- risks: ${report.counts.risks}`);
  lines.push(`- warnings: ${report.counts.warnings}`);
  lines.push(`- info: ${report.counts.info}`);
  lines.push("");
  lines.push("## Gallery Image Count by Category");
  lines.push("");
  for (const category of Object.keys(report.galleryImageCountByCategory).sort((a, b) => a.localeCompare(b))) {
    lines.push(`### ${category}`);
    const bucket = report.galleryImageCountByCategory[category];
    for (const imageCount of Object.keys(bucket).sort((a, b) => Number(a) - Number(b))) {
      lines.push(`- ${imageCount} image(s): ${bucket[imageCount]}`);
    }
    lines.push("");
  }

  lines.push("## Products Needing Manual Review");
  lines.push("");
  if (report.productsNeedingManualReview.length === 0) {
    lines.push("- none");
  } else {
    for (const productId of report.productsNeedingManualReview) lines.push(`- ${productId}`);
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  lines.push("- Heuristics are conservative and metadata-based only (path/filename clues + non-OCR pixel signals).");
  lines.push("- If image role cannot be inferred safely, the audit records role as `unknown` rather than erroring.");

  return `${lines.join("\n")}\n`;
}

export async function runProductGalleryAudit(runId: string): Promise<{ jsonPath: string; summaryPath: string; report: AuditReport }> {
  const safeRunId = normalizeRunId(runId);
  const { storage } = await import("../server/storage.ts");
  const products = await storage.getProducts();
  const imageSignalsByPath = await buildImageSignalsMap(products);

  const partial = auditProducts(products, { imageSignalsByPath });
  const report: AuditReport = {
    runId: safeRunId,
    createdAt: new Date().toISOString(),
    status: partial.counts.errors > 0 ? "failed" : "ok",
    ...partial,
  };

  const outputDir = path.resolve("tmp", "product-gallery-audits");
  const jsonPath = path.join(outputDir, `${safeRunId}.json`);
  const summaryPath = path.join(outputDir, `${safeRunId}.summary.md`);

  await fs.promises.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.promises.writeFile(summaryPath, createSummaryMarkdown(report), "utf8"),
  ]);

  return { jsonPath, summaryPath, report };
}

async function main(): Promise<void> {
  const { runId } = parseArgs(process.argv.slice(2));
  const result = await runProductGalleryAudit(runId);
  console.log(`runId: ${result.report.runId}`);
  console.log(`products audited: ${result.report.counts.products}`);
  console.log(`findings: ${result.report.findings.length}`);
  console.log(`created: ${result.jsonPath}`);
  console.log(`created: ${result.summaryPath}`);
}

const entrypointPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypointPath) {
  main()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { pool } = await import("../server/db.ts");
      await pool.end();
    });
}

export { parseArgs, normalizeRunId, createSummaryMarkdown };
