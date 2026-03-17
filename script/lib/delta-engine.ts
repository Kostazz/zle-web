import crypto from "node:crypto";
import { normalizeText } from "./catalog-index.ts";
import { canonicalizeCategory } from "./category-normalization.ts";
import type { CatalogIndexEntry, DeltaResult } from "./reconciliation-types.ts";
import type { SourceProductRecord } from "./source-dataset.ts";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(payload)).digest("hex")}`;
}

function normalizeCategory(raw: string): string {
  return canonicalizeCategory(raw) ?? normalizeText(raw);
}

function normalizeSizes(values: string[]): string[] {
  return values.map((s) => normalizeText(s)).filter(Boolean).sort();
}

function normalizeOptions(values: string[]): string[] {
  return values.map((v) => normalizeText(v)).filter(Boolean).sort();
}

export function deriveProductFingerprints(product: SourceProductRecord): {
  identityFingerprint: string;
  contentFingerprint: string;
  imageFingerprint: string;
  titleNormalized: string;
} {
  const titleNormalized = normalizeText(product.title);
  const identityPayload = {
    brand: product.brandNormalized,
    title: titleNormalized,
    slug: normalizeText(product.sourceSlug),
    category: normalizeCategory(product.categoryRaw),
    structured: {
      productType: normalizeText(product.structured.productType ?? ""),
      audience: normalizeText(product.structured.audience ?? ""),
      line: normalizeText(product.structured.lineNormalized ?? ""),
      design: normalizeText(product.structured.designNormalized ?? ""),
      colors: [...product.structured.colorTokens].map((c) => normalizeText(c)).filter(Boolean).sort(),
    },
  };

  const identityFingerprint = hashPayload(identityPayload);
  const contentPayload = {
    identityFingerprint,
    description: normalizeText(product.descriptionRaw),
    sizes: normalizeSizes(product.sizes),
    options: normalizeOptions(product.optionsRaw),
    price: product.priceCzk ?? null,
    priceText: normalizeText(product.priceText),
    tag: normalizeText(product.tagRaw ?? ""),
  };
  const imagePayload = {
    imageUrls: product.imageUrls.map((url) => normalizeText(url)),
    downloadedImageHashes: (product.downloadedImageHashes ?? []).map((hash) => normalizeText(hash)),
    downloadedImages: product.downloadedImages.map((img) => normalizeText(img)),
  };

  return {
    identityFingerprint,
    contentFingerprint: hashPayload(contentPayload),
    imageFingerprint: hashPayload(imagePayload),
    titleNormalized,
  };
}

export function evaluateDelta(product: SourceProductRecord, existing: CatalogIndexEntry | undefined): DeltaResult {
  const computed = deriveProductFingerprints(product);

  if (!existing) {
    return {
      sourceProductKey: product.sourceProductKey,
      sourceUrl: product.sourceUrl,
      ...computed,
      delta: "NEW",
      reasonCodes: ["not_in_index"],
    };
  }

  const reasonCodes: string[] = [];
  if (existing.sourceUrl !== product.sourceUrl) reasonCodes.push("source_url_changed");

  if (existing.identityFingerprint !== computed.identityFingerprint) {
    return {
      sourceProductKey: product.sourceProductKey,
      sourceUrl: product.sourceUrl,
      ...computed,
      delta: "CHANGED_IDENTITY",
      reasonCodes: [...reasonCodes, "identity_fingerprint_changed"],
    };
  }

  if (existing.contentFingerprint !== computed.contentFingerprint) {
    return {
      sourceProductKey: product.sourceProductKey,
      sourceUrl: product.sourceUrl,
      ...computed,
      delta: "CHANGED_CONTENT",
      reasonCodes: [...reasonCodes, "content_fingerprint_changed"],
    };
  }

  if (existing.imageFingerprint !== computed.imageFingerprint) {
    return {
      sourceProductKey: product.sourceProductKey,
      sourceUrl: product.sourceUrl,
      ...computed,
      delta: "CHANGED_IMAGES",
      reasonCodes: [...reasonCodes, "image_fingerprint_changed"],
    };
  }

  if (existing.brandNormalized !== "zle") {
    return {
      sourceProductKey: product.sourceProductKey,
      sourceUrl: product.sourceUrl,
      ...computed,
      delta: "AMBIGUOUS",
      reasonCodes: [...reasonCodes, "index_brand_not_zle"],
    };
  }

  return {
    sourceProductKey: product.sourceProductKey,
    sourceUrl: product.sourceUrl,
    ...computed,
    delta: "UNCHANGED",
    reasonCodes,
  };
}
