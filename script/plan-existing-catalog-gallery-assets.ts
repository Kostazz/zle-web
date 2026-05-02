import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classifyGalleryImageRole, type GalleryImageRole } from "./lib/gallery-image-role.ts";

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
  candidateSlot?: string;
  candidateFiles?: string[];
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

export function validateRunId(runId: string): string {
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId) || runId.includes("..") || runId.startsWith(".")) {
    throw new Error(`Unsafe run id: ${runId}`);
  }
  return runId;
}

function deriveSafeLocalProductId(sourceProductKey: string): { id: string | null; reason?: string } {
  const raw = sourceProductKey.split("--")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw) || raw.includes("..") || raw.includes("/") || raw.includes("\\") || raw.startsWith(".") || /\s/.test(raw)) {
    return { id: null, reason: "unsafe_local_product_id" };
  }
  return { id: raw };
}

function safeLocalDir(localRoot: string, localProductId: string): string {
  const resolvedRoot = path.resolve(localRoot);
  const resolvedDir = path.resolve(path.join(resolvedRoot, localProductId));
  if (!isPathInside(resolvedRoot, resolvedDir)) throw new Error(`Unsafe local product path: ${localProductId}`);
  return resolvedDir;
}



function isSlotEligibleGalleryRole(role: GalleryImageRole): boolean {
  return role === "product" || role === "product_detail" || role === "back_detail" || role === "fabric_detail";
}
export function planFromData(manifest: IngestManifest, localRoot: string): { items: PlanItem[]; summary: Record<string, unknown> } {
  const items: PlanItem[] = [];
  const resolvedLocalRoot = path.resolve(localRoot);

  for (const product of manifest.products) {
    const idInfo = deriveSafeLocalProductId(product.sourceProductKey);
    const localProductId = idInfo.id;
    const unsafeId = !localProductId;
    const localDir = localProductId ? safeLocalDir(resolvedLocalRoot, localProductId) : null;
    const mapped = Boolean(localDir && fs.existsSync(localDir) && fs.statSync(localDir).isDirectory());

    const localFiles = mapped ? fs.readdirSync(localDir!) : [];
    const occupiedSlots = new Set(localFiles.map(slotFromBasename).filter((s): s is string => Boolean(s && s !== "cover")));
    const hashToLocalSlots = new Map<string, Set<string>>();
    const hardSeenSourceHashesForProduct = new Set<string>();
    const candidateSeenSourceHashesForProduct = new Set<string>();
    if (mapped) {
      for (const f of localFiles) {
        const slot = slotFromBasename(f);
        if (!slot) continue;
        const h = sha(path.join(localDir!, f));
        if (!hashToLocalSlots.has(h)) hashToLocalSlots.set(h, new Set<string>());
        hashToLocalSlots.get(h)!.add(slot);
      }
    }

    const ingestedImages = product.ingestedImages ?? (product.ingestedImagePaths ?? []).map((p, i) => ({ path: p, originalImageUrl: "", originalImageIndex: i }));
    const productImgs = ingestedImages.map((img, idx) => ({
      ...img,
      hash: product.downloadedImageHashes?.[idx] ?? null,
      role: classifyGalleryImageRole(img.originalImageUrl || img.path).role,
    }));

    const hardOccupiedSlots = new Set(occupiedSlots);
    let nextHardSlot = 1;
    const nextFreeHardSlot = () => {
      while (nextHardSlot <= 8) {
        const slot = String(nextHardSlot).padStart(2, "0");
        nextHardSlot++;
        if (!hardOccupiedSlots.has(slot)) return slot;
      }
      return null;
    };
    const pendingUnknownCandidates: Array<{ itemIndex: number }> = [];

    for (const img of productImgs) {
      const sourceHash = img.hash;
      const baseReason = unsafeId ? ["unsafe_local_product_id"] : ["local_product_folder_missing"];
      if (!mapped) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId: localProductId ?? null, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "LOCAL_PRODUCT_MISSING", reasonCodes: baseReason });
        continue;
      }
      if (img.role === "size_chart" || img.role === "logo_or_technical") {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "TECHNICAL_IMAGE", reasonCodes: ["technical_or_size_chart", `role_${img.role}`] });
        continue;
      }
      if (img.role === "reject") {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "REQUIRES_MANUAL_REVIEW", reasonCodes: ["unsupported_gallery_image_role", `role_${img.role}`] });
        continue;
      }
      if (!sourceHash) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash: null, classification: "REQUIRES_MANUAL_REVIEW", reasonCodes: ["missing_source_hash", `role_${img.role}`] });
        continue;
      }
      if (hashToLocalSlots.has(sourceHash)) {
        const matchingSlots = hashToLocalSlots.get(sourceHash)!;
        const classification: Classification = matchingSlots.has("01") || matchingSlots.has("cover") ? "SAME" : "DUPLICATE_AFTER_NORMALIZATION";
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification, reasonCodes: ["hash_exists_in_local_folder"] });
        continue;
      }
      if (img.role === "unknown" && hardSeenSourceHashesForProduct.has(sourceHash)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "DUPLICATE_AFTER_NORMALIZATION", reasonCodes: ["duplicate_source_hash_in_product"] });
        continue;
      }
      if (img.role === "unknown" && candidateSeenSourceHashesForProduct.has(sourceHash)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "DUPLICATE_AFTER_NORMALIZATION", reasonCodes: ["duplicate_source_hash_in_product"] });
        continue;
      }
      if (img.role !== "unknown" && hardSeenSourceHashesForProduct.has(sourceHash)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "DUPLICATE_AFTER_NORMALIZATION", reasonCodes: ["duplicate_source_hash_in_product"] });
        continue;
      }
      if (img.role === "unknown") {
        candidateSeenSourceHashesForProduct.add(sourceHash);
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "REQUIRES_MANUAL_REVIEW", reasonCodes: ["role_unknown"] });
        pendingUnknownCandidates.push({ itemIndex: items.length - 1 });
        continue;
      }
      if (!isSlotEligibleGalleryRole(img.role)) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "REQUIRES_MANUAL_REVIEW", reasonCodes: ["unsupported_gallery_image_role", `role_${img.role}`] });
        continue;
      }
      const free = nextFreeHardSlot();
      if (!free) {
        items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, classification: "NO_FREE_SLOT", reasonCodes: ["slots_01_08_occupied"] });
        continue;
      }
      occupiedSlots.add(free);
      hardOccupiedSlots.add(free);
      hardSeenSourceHashesForProduct.add(sourceHash);
      items.push({ sourceProductKey: product.sourceProductKey, localProductId, sourceImagePath: img.path, originalImageUrl: img.originalImageUrl || null, originalImageIndex: img.originalImageIndex, sourceHash, proposedSlot: free, proposedFiles: [`${free}.jpg`, `${free}.webp`], classification: "NEW", reasonCodes: ["slot_missing_in_local_gallery"] });
    }

    const candidateOccupiedSlots = new Set(hardOccupiedSlots);
    let nextCandidateSlot = 1;
    const nextFreeCandidateSlot = () => {
      while (nextCandidateSlot <= 8) {
        const slot = String(nextCandidateSlot).padStart(2, "0");
        nextCandidateSlot++;
        if (!candidateOccupiedSlots.has(slot)) return slot;
      }
      return null;
    };
    for (const pending of pendingUnknownCandidates) {
      const item = items[pending.itemIndex];
      if (!item) continue;
      const slot = nextFreeCandidateSlot();
      if (!slot) {
        item.reasonCodes = ["unknown_role_no_free_slot", "role_unknown"];
        continue;
      }
      candidateOccupiedSlots.add(slot);
      item.candidateSlot = slot;
      item.candidateFiles = [`${slot}.jpg`, `${slot}.webp`];
      item.reasonCodes = ["unknown_role_candidate_for_missing_slot", "role_unknown"];
    }
  }

  for (const failure of manifest.failures ?? []) {
    const idInfo = deriveSafeLocalProductId(failure.sourceProductKey);
    const localProductId = idInfo.id;
    const mapped = Boolean(localProductId && fs.existsSync(safeLocalDir(resolvedLocalRoot, localProductId)) && fs.statSync(safeLocalDir(resolvedLocalRoot, localProductId)).isDirectory());
    items.push({
      sourceProductKey: failure.sourceProductKey,
      localProductId: mapped ? localProductId : null,
      sourceImagePath: null,
      originalImageUrl: failure.imageUrl,
      originalImageIndex: null,
      sourceHash: null,
      classification: "SOURCE_PRODUCT_WITH_FAILED_IMAGE",
      reasonCodes: idInfo.id ? ["failed_source_image", failure.reason] : ["failed_source_image", "unsafe_local_product_id", failure.reason],
    });
  }

  const mappedProducts = new Set(manifest.products
    .map((p) => deriveSafeLocalProductId(p.sourceProductKey).id)
    .filter((id): id is string => Boolean(id))
    .filter((id) => {
      const dir = safeLocalDir(resolvedLocalRoot, id);
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    }));

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
    reviewCandidateLogicalImageCount: items.filter((i) => Boolean(i.candidateSlot)).length,
    reviewCandidateOutputFileCount: items.reduce((n, i) => n + (i.candidateFiles?.length ?? 0), 0),
    productsWithReviewCandidates: new Set(items.filter((i) => Boolean(i.candidateSlot)).map((i) => i.localProductId).filter(Boolean)).size,
    productsWhereCandidate01: new Set(items.filter((i) => i.candidateSlot === "01").map((i) => i.localProductId).filter(Boolean)).size,
    productsWhereCandidate02: new Set(items.filter((i) => i.candidateSlot === "02").map((i) => i.localProductId).filter(Boolean)).size,
  };
  return { items, summary };
}

async function main() {
  const runIdArg = process.argv.includes("--run-id") ? process.argv[process.argv.indexOf("--run-id") + 1] : "";
  const outDirArg = process.argv.includes("--output-dir") ? process.argv[process.argv.indexOf("--output-dir") + 1] : undefined;
  const runId = validateRunId(runIdArg);

  const ingestPath = path.resolve("tmp/source-images", `${runId}.ingest.json`);
  const raw = JSON.parse(await fs.promises.readFile(ingestPath, "utf8")) as IngestManifest;
  const { items, summary } = planFromData(raw, path.resolve("client/public/images/products"));
  const outputDir = resolvePlannerOutputDir(outDirArg);
  await fs.promises.mkdir(outputDir, { recursive: true });

  const outputJsonPath = path.resolve(path.join(outputDir, `${runId}.json`));
  const outputSummaryPath = path.resolve(path.join(outputDir, `${runId}.summary.md`));
  const allowedRoot = path.resolve("tmp", "gallery-missing-plans");
  if (!isPathInside(outputDir, outputJsonPath) || !isPathInside(outputDir, outputSummaryPath) || !isPathInside(allowedRoot, outputJsonPath) || !isPathInside(allowedRoot, outputSummaryPath)) {
    throw new Error("Refusing output path outside tmp/gallery-missing-plans");
  }

  await fs.promises.writeFile(outputJsonPath, JSON.stringify({ runId, createdAt: new Date().toISOString(), items, summary }, null, 2));
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
    `- Review candidate logical images (role_unknown): ${summary.reviewCandidateLogicalImageCount}`,
    `- Review candidate output files (.jpg + .webp): ${summary.reviewCandidateOutputFileCount}`,
    `- Products with review candidates: ${summary.productsWithReviewCandidates}`,
  ].join("\n") + "\n";
  await fs.promises.writeFile(outputSummaryPath, md, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
