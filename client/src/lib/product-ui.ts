import type { Product } from "@shared/schema";
import path from "path";

export const ONE_SIZE = "ONE_SIZE";

const LOCAL_IMAGE_CANDIDATE_NAMES = [
  "cover.jpg",
  "cover.webp",
  "01.jpg",
  "01.webp",
  "02.jpg",
  "02.webp",
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

export function isImageOwnedByProduct(product: Pick<Product, "id">, imagePath: string): boolean {
  const normalizedImagePath = normalizeImagePath(imagePath.trim());

  if (!normalizedImagePath || /^https?:\/\//i.test(normalizedImagePath) || normalizedImagePath.startsWith("data:")) {
    return false;
  }

  const normalizedLocalPath = path.posix.normalize(normalizedImagePath);
  const segments = normalizedLocalPath.split("/").filter(Boolean);

  return (
    segments.length >= 4 &&
    segments[0] === "images" &&
    segments[1] === "products" &&
    segments[2] === product.id
  );
}

export function getDeclaredProductImages(product: Pick<Product, "id" | "image" | "images">): string[] {
  const declaredCandidates = [product.image, ...(product.images ?? [])]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => normalizeImagePath(value.trim()))
    .filter((value) => isImageOwnedByProduct(product, value));

  return Array.from(new Set(declaredCandidates));
}

export function getProductImageCandidates(product: Pick<Product, "id" | "image" | "images">): string[] {
  const localCandidates = LOCAL_IMAGE_CANDIDATE_NAMES.map(
    (fileName) => `/images/products/${product.id}/${fileName}`
  );

  const declaredCandidates = getDeclaredProductImages(product);

  return Array.from(new Set([...localCandidates, ...declaredCandidates]));
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
