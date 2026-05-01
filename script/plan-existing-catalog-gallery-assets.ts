import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classifyGalleryImageRole } from "./lib/gallery-image-role.ts";

type Classification =
  | "NEW"
  | "SAME"
  | "DUPLICATE_AFTER_NORMALIZATION"
  | "TECHNICAL_IMAGE"
  | "REQUIRES_MANUAL_REVIEW"
  | "NO_FREE_SLOT"
  | "LOCAL_PRODUCT_MISSING"
  | "SOURCE_PRODUCT_WITH_FAILED_IMAGE";

type IngestManifest = {
  runId: string;
  products: Array<{
    sourceProductKey: string;
    ingestedImages?: Array<{ path: string; originalImageUrl: string; originalImageIndex: number }>;
    ingestedImagePaths?: string[];
    downloadedImageHashes?: string[];
  }>;
  failures?: Array<{ sourceProductKey: string; imageUrl: string; reason: string }>;
};

type PlanItem = {
  sourceProductKey: string;
  localProductId: string | null;
  sourceImagePath: string | null;
  originalImageUrl: string | null;
  originalImageIndex: number | null;
  sourceHash: string | null;
  proposedSlot?: string;
  proposedFiles?: string[];
  classification: Classification;
  reasonCodes: string[];
};

function sha(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function slotFromBasename(file: string): string | null {
  const base = path.basename(file).toLowerCase();
  const slotMatch = base.match(/^(0[1-8])\.(jpg|jpeg|webp)$/);
  if (slotMatch) return slotMatch[1] ?? null;
  if (/^cover\.(jpg|jpeg|webp)$/.test(base)) return "cover";
  return null;
}


function isPathInside(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolvePlannerOutputDir(outputDirArg?: string): string {
  const allowedRoot = path.resolve("tmp", "gallery-missing-plans");
  const target = path.resolve(outputDirArg ?? allowedRoot);
  if (!isPathInside(allowedRoot, target)) {
    throw new Error(`Refusing --output-dir outside tmp/gallery-missing-plans: ${outputDirArg ?? target}`);
  }
  return target;
}
export function planFromData(manifest: IngestManifest, localRoot: string): { items: PlanItem[]; summary: Record<string, unknown> } {
  const items: PlanItem[] = [];

  for (const product of manifest.products) {
    const localProductId = product.sourceProductKey.split("--")[0] ?? "";
    const localDir = path.join(localRoot, localProductId);
    const mapped = localProductId.length > 0 && fs.existsSync(localDir) && fs.statSync(localDir).isDirectory();

    const localFiles = mapped ? fs.readdirSync(localDir) : [];
    const occupiedSlots = new Set(localFiles.map(slotFromBasename).filter((s): s is string => Boolean(s && s !== "cover")));
    const hashToLocalSlots = new Map<string, Set<string>>();
    const seenSourceHashes = new Set<string>();
    if (mapped) {
      for (const f of localFiles) {
        const slot = slotFromBasename(f);
        if (!slot) continue;
        const h = sha(path.join(localDir, f));
        if (!hashToLocalSlots.has(h)) hashToLocalSlots.set(h, new Set<string>());
        hashToLocalSlots.get(h)!.add(slot);
      }
    }

    const ingestedImages = product.ingestedImages ?? (product.ingestedImagePaths ?? []).map((p, i) => ({ path: p, originalImageUrl: "", originalImageIndex: i }));
    const productImgs = ingestedImages.map((img, idx) => ({
      ...img,
      idx,
      hash: product.downloadedImageHashes?.[idx] ?? null,
      role: classifyGalleryImageRole(img.originalImageUrl || img.path).role,
    }));

    const nonTechnical = productImgs.filter((i) => !["size_chart", "logo_or_technical"].includes(i.role));
    const technical = productImgs.filter((i) => ["size_chart", "logo_or_technical"].includes(i.role));

    let nextSlot = 1;
    const nextFreeSlot = () => {
      while (nextSlot <= 8) {
        const slot = String(nextSlot).padStart(2, "0");
        nextSlot++;
        if (!occupiedSlots.has(slot)) return slot;
      }
      return null;
    };

    for (const img of [...nonTechnical, ...technical]) {
      const sourceHash = img.hash;
      if (!mapped) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId: null, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "LOCAL_PRODUCT_MISSING", reasonCodes: ["local_product_folder_missing"] });
        continue;
      }
      if (["size_chart", "logo_or_technical"].includes(img.role)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "TECHNICAL_IMAGE", reasonCodes: ["technical_or_size_chart"] });
        continue;
      }
      if (sourceHash && hashToLocalSlots.has(sourceHash)) {
        const matchingSlots = hashToLocalSlots.get(sourceHash)!;
        const classification: Classification = matchingSlots.has("01") || matchingSlots.has("cover") ? "SAME" : "DUPLICATE_AFTER_NORMALIZATION";
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification, reasonCodes: ["hash_exists_in_local_folder"] });
        continue;
      }
      if (sourceHash && seenSourceHashes.has(sourceHash)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "DUPLICATE_AFTER_NORMALIZATION", reasonCodes: ["hash_duplicate_in_source_product"] });
        continue;
      }
      const free = nextFreeSlot();
      if (!free) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "NO_FREE_SLOT", reasonCodes: ["slots_01_08_occupied"] });
        continue;
      }
      occupiedSlots.add(free);
      if (sourceHash) seenSourceHashes.add(sourceHash);
      items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, proposedSlot: free, proposedFiles: [`${free}.jpg`, `${free}.webp`], classification: "NEW", reasonCodes: ["slot_missing_in_local_gallery"] });
    }
  }

  for (const failure of manifest.failures ?? []) {
    const localProductId = failure.sourceProductKey.split("--")[0] ?? "";
    const localDir = path.join(localRoot, localProductId);
    const mapped = localProductId.length > 0 && fs.existsSync(localDir) && fs.statSync(localDir).isDirectory();
    items.push({
      sourceProductKey: failure.sourceProductKey,
      localProductId: mapped ? localProductId : null,
      sourceImagePath: null,
      originalImageUrl: failure.imageUrl,
      originalImageIndex: null,
      sourceHash: null,
      classification: "SOURCE_PRODUCT_WITH_FAILED_IMAGE",
      reasonCodes: ["failed_source_image", failure.reason],
    });
  }

  const mappedProducts = new Set(manifest.products.map((p) => p.sourceProductKey.split("--")[0]).filter((id) => id && fs.existsSync(path.join(localRoot, id))));
  const summary = {
    totalSourceProducts: manifest.products.length,
    mappedProducts: mappedProducts.size,
    unmappedProducts: manifest.products.length - mappedProducts.size,
    totalSourceImages: items.length,
    byClassification: Object.fromEntries(Object.entries(items.reduce<Record<string, number>>((acc, i) => ((acc[i.classification] = (acc[i.classification] ?? 0) + 1), acc), {})).sort()),
    productsWithProposedNewFiles: new Set(items.filter((i) => i.classification === "NEW").map((i) => i.localProductId).filter(Boolean)).size,
    proposedNewLogicalImageCount: items.filter((i) => i.classification === "NEW").length,
    proposedNewOutputFileCount: items.filter((i) => i.classification === "NEW").reduce((n, i) => n + (i.proposedFiles?.length ?? 0), 0),
    productsWhere01Proposed: new Set(items.filter((i) => i.proposedSlot === "01").map((i) => i.localProductId).filter(Boolean)).size,
    productsWhere02Proposed: new Set(items.filter((i) => i.proposedSlot === "02").map((i) => i.localProductId).filter(Boolean)).size,
    productsRequiringManualReview: new Set(items.filter((i) => i.classification === "REQUIRES_MANUAL_REVIEW").map((i) => i.localProductId).filter(Boolean)).size,
  };
  return { items, summary };
}

async function main() {
  const runId = process.argv.includes("--run-id") ? process.argv[process.argv.indexOf("--run-id") + 1] : "";
  const outDirArg = process.argv.includes("--output-dir") ? process.argv[process.argv.indexOf("--output-dir") + 1] : undefined;
  if (!runId) throw new Error("--run-id required");
  const ingestPath = path.resolve("tmp/source-images", `${runId}.ingest.json`);
  const raw = JSON.parse(await fs.promises.readFile(ingestPath, "utf8")) as IngestManifest;
  const { items, summary } = planFromData(raw, path.resolve("client/public/images/products"));
  const outputDir = resolvePlannerOutputDir(outDirArg);
  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(path.join(outputDir, `${runId}.json`), JSON.stringify({ runId, createdAt: new Date().toISOString(), items, summary }, null, 2));
  const md = [
    "# Existing Catalog Missing Gallery Asset Plan",
    "",
    `- Run ID: ${runId}`,
    `- Total source products: ${summary.totalSourceProducts}`,
    `- Mapped products: ${summary.mappedProducts}`,
    `- Unmapped products: ${summary.unmappedProducts}`,
    `- Total source images (including failed-source placeholders): ${summary.totalSourceImages}`,
    `- Proposed NEW logical images: ${summary.proposedNewLogicalImageCount}`,
    `- Proposed NEW output files (.jpg + .webp): ${summary.proposedNewOutputFileCount}`,
  ].join("\n") + "\n";
  await fs.promises.writeFile(path.join(outputDir, `${runId}.summary.md`), md, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
