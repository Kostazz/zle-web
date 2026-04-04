import type { Product } from "@shared/schema";

export const ONE_SIZE = "ONE_SIZE";

const LOCAL_IMAGE_CANDIDATE_NAMES = [
  "cover.jpg",
  "cover.webp",
  "01.jpg",
  "01.webp",
  "02.jpg",
  "02.webp",
  "03.jpg",
  "03.webp",
  "04.jpg",
  "04.webp",
] as const;

const LOGICAL_GALLERY_SLOTS = ["cover", "01", "02", "03", "04"] as const;

type LogicalGallerySlot = (typeof LOGICAL_GALLERY_SLOTS)[number];

function getLogicalGallerySlot(imagePath: string): LogicalGallerySlot | null {
  const normalizedImagePath = normalizeImagePath(imagePath.trim());

  if (!normalizedImagePath || /^https?:\/\//i.test(normalizedImagePath) || normalizedImagePath.startsWith("data:")) {
    return null;
  }

  const normalizedLocalPath = normalizeLocalAssetPath(normalizedImagePath);
  const fileName = normalizedLocalPath.split("/").filter(Boolean).at(-1);

  if (!fileName) {
    return null;
  }

  const slotMatch = fileName.match(/^(cover|0[1-4])\.(jpg|webp)$/i);

  if (!slotMatch) {
    return null;
  }

  return slotMatch[1].toLowerCase() as LogicalGallerySlot;
}

function getLocalFallbackCandidatesBySlot(
  productId: string
): Array<{ slot: LogicalGallerySlot; candidates: string[] }> {
  const availableLocalNames = new Set<string>(LOCAL_IMAGE_CANDIDATE_NAMES);

  return LOGICAL_GALLERY_SLOTS.flatMap((slot) => {
    const jpgName = `${slot}.jpg`;
    const webpName = `${slot}.webp`;
    const candidates = [jpgName, webpName]
      .filter((name) => availableLocalNames.has(name))
      .map((name) => `/images/products/${productId}/${name}`);

    return candidates.length > 0 ? [{ slot, candidates }] : [];
  });
}

function mergeDeclaredAndFallbackCandidates(product: Pick<Product, "id" | "image" | "images">): string[] {
  const declaredCandidates = getOwnedDeclaredProductImages(product);
  const mergedCandidates: string[] = [];
  const seenDeclaredPaths = new Set<string>();
  const seenCandidatePaths = new Set<string>();
  const coveredSlots = new Set<LogicalGallerySlot>();

  for (const candidate of declaredCandidates) {
    if (seenDeclaredPaths.has(candidate)) {
      continue;
    }

    seenDeclaredPaths.add(candidate);
    seenCandidatePaths.add(candidate);
    mergedCandidates.push(candidate);

    const slot = getLogicalGallerySlot(candidate);
    if (slot) {
      coveredSlots.add(slot);
    }
  }

  for (const { slot, candidates } of getLocalFallbackCandidatesBySlot(product.id)) {
    if (coveredSlots.has(slot)) {
      continue;
    }

    let selectedCandidate: string | undefined;

    for (const candidatePath of candidates) {
      if (!seenCandidatePaths.has(candidatePath)) {
        selectedCandidate = candidatePath;
        break;
      }
    }

    if (selectedCandidate) {
      seenCandidatePaths.add(selectedCandidate);
      mergedCandidates.push(selectedCandidate);
    }

    coveredSlots.add(slot);
  }

  return mergedCandidates;
}

function normalizeImagePath(path: string): string {
  if (!path) {
    return "";
  }

  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) {
    return path;
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeLocalAssetPath(input: string): string {
  if (!input) {
    return "";
  }

  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  const segments = withLeadingSlash.split("/");
  const resolvedSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      resolvedSegments.pop();
      continue;
    }

    resolvedSegments.push(segment);
  }

  return `/${resolvedSegments.join("/")}`;
}

export function isImageOwnedByProduct(product: Pick<Product, "id">, imagePath: string): boolean {
  const normalizedImagePath = normalizeImagePath(imagePath.trim());

  if (!normalizedImagePath || /^https?:\/\//i.test(normalizedImagePath) || normalizedImagePath.startsWith("data:")) {
    return false;
  }

  const normalizedLocalPath = normalizeLocalAssetPath(normalizedImagePath);
  const segments = normalizedLocalPath.split("/").filter(Boolean);

  return (
    segments.length === 4 &&
    segments[0] === "images" &&
    segments[1] === "products" &&
    segments[2] === product.id &&
    Boolean(segments[3])
  );
}

export function getDeclaredProductImages(product: Pick<Product, "id" | "image" | "images">): string[] {
  const declaredCandidates = [product.image, ...(product.images ?? [])]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => normalizeImagePath(value.trim()))
    .filter((value) => isImageOwnedByProduct(product, value));

  return Array.from(new Set(declaredCandidates));
}

export function getOwnedDeclaredProductImages(product: Pick<Product, "id" | "image" | "images">): string[] {
  const declaredImages = getDeclaredProductImages(product);
  return declaredImages.filter((imagePath) => isImageOwnedByProduct(product, imagePath));
}

export function getProductImageCandidates(product: Pick<Product, "id" | "image" | "images">): string[] {
  return mergeDeclaredAndFallbackCandidates(product);
}

export function getOwnedProductGalleryImages(
  product: Pick<Product, "id" | "image" | "images">,
  limit = 8
): string[] {
  return mergeDeclaredAndFallbackCandidates(product).slice(0, Math.max(1, limit));
}

export function getSelectableSizes(product: Pick<Product, "sizes">): string[] {
  return product.sizes.length > 0 ? product.sizes : [ONE_SIZE];
}

export function requiresExplicitSizeSelection(product: Pick<Product, "sizes">): boolean {
  return product.sizes.length > 0;
}

export function getDefaultSelectedSize(product: Pick<Product, "sizes">): string | null {
  return requiresExplicitSizeSelection(product) ? null : ONE_SIZE;
}

export function formatSizeLabel(size: string): string {
  return size === ONE_SIZE ? "ONE SIZE" : size;
}
