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
  const localCandidates = LOCAL_IMAGE_CANDIDATE_NAMES.map(
    (fileName) => `/images/products/${product.id}/${fileName}`
  );

  const declaredCandidates = getOwnedDeclaredProductImages(product);

  return Array.from(new Set([...localCandidates, ...declaredCandidates]));
}

export function getOwnedProductGalleryImages(
  product: Pick<Product, "id" | "image" | "images">,
  limit = 8
): string[] {
  const localCandidates = LOCAL_IMAGE_CANDIDATE_NAMES.map(
    (fileName) => `/images/products/${product.id}/${fileName}`
  );
  const declaredCandidates = [...getOwnedDeclaredProductImages(product)].sort((a, b) => a.localeCompare(b));
  const mergedCandidates = [...localCandidates];
  const seenCandidates = new Set(localCandidates);

  for (const candidate of declaredCandidates) {
    if (seenCandidates.has(candidate)) {
      continue;
    }

    mergedCandidates.push(candidate);
    seenCandidates.add(candidate);
  }

  return Array.from(new Set(mergedCandidates)).slice(0, Math.max(1, limit));
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
