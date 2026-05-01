import crypto from "node:crypto";

export type ParsedProductPage = {
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
  optionsPresent: boolean;
  sizes: string[];
  descriptionRaw: string;
  additionalInfoRaw: string;
  imageUrls: string[];
  imageExtractionFailure: ParseFailure | null;
  structured: {
    productType: string | null;
    audience: string | null;
    lineNormalized: string | null;
    designNormalized: string | null;
    colorTokens: string[];
  };
};

export type ParseFailure = {
  code: string;
  reason: string;
};

const WEDOS_PROTECTION_MARKERS = [
  "proof of work - wedos protection",
  "keeping you safe",
  "wedos protection",
  "challenge-widget",
  "captcha-widget",
  "pow challenge",
  "verification",
];

const SIZE_TOKEN_RE = /\b(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL)\b/gi;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function firstCapture(input: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match?.[1]) {
      return stripTags(match[1]).trim();
    }
  }
  return null;
}

function normalizeBrand(raw: string): "zle" | null {
  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "zle" || normalized === "zle skateboarding" || normalized === "zle skateboards" || normalized === "zle lifestyle culture brand") return "zle";
  return null;
}

function parsePriceCzk(priceText: string): number | null {
  const match = priceText.replace(/\s+/g, " ").match(/([0-9][0-9\s.,]*)\s*kč/i);
  if (!match) return null;
  const normalized = match[1].replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

const PRODUCT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
const PRODUCT_IMAGE_EXCLUDED_PATH_MARKERS = [
  "/wp-content/themes/",
  "/images/facebook",
  "/images/instagram",
  "/facebook.svg",
  "/instagram.svg",
] as const;
const PRODUCT_IMAGE_PREFERRED_PATH_MARKER = "/wp-content/uploads/";
const INTERNAL_GALLERY_URL_SANITY_CAP = 16;

function isAllowedProductImageUrl(imageUrl: URL): boolean {
  const pathname = imageUrl.pathname.toLowerCase();
  if (pathname.endsWith(".svg")) return false;
  if (PRODUCT_IMAGE_EXCLUDED_PATH_MARKERS.some((marker) => pathname.includes(marker))) return false;
  if (!PRODUCT_IMAGE_EXTENSIONS.some((extension) => pathname.endsWith(extension))) return false;
  return pathname.includes(PRODUCT_IMAGE_PREFERRED_PATH_MARKER);
}

const PRIMARY_GALLERY_CLASS_MARKERS = ["woocommerce-product-gallery", "woocommerce-product-gallery__wrapper"] as const;
const SECONDARY_GALLERY_CLASS_MARKERS = ["product-gallery", "product-images", "images-wrapper"] as const;
const NARROW_PRODUCT_ROOT_CLASS_MARKERS = ["single-product", "type-product", "product-detail", "product-type-simple"] as const;

function parseClassNamesFromTag(openingTag: string): string[] {
  const classMatch = openingTag.match(/\bclass=["']([^"']+)["']/i)?.[1];
  if (!classMatch) return [];
  return classMatch
    .split(/\s+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function extractBalancedTagBlock(html: string, tagStartIndex: number): string | null {
  const openingSlice = html.slice(tagStartIndex);
  const openingMatch = /^<([a-z0-9-]+)\b[^>]*>/i.exec(openingSlice);
  if (!openingMatch) return null;

  const openingTag = openingMatch[0];
  const tagName = openingMatch[1];
  const openingTagEnd = tagStartIndex + openingTag.length;

  if (/\/>$/.test(openingTag)) {
    return openingTag;
  }

  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openingTagEnd;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    const isClosing = tag.startsWith("</");
    const isSelfClosing = /\/>$/.test(tag);
    if (isClosing) {
      depth -= 1;
    } else if (!isSelfClosing) {
      depth += 1;
    }
    if (depth === 0) {
      return html.slice(tagStartIndex, tagPattern.lastIndex);
    }
  }

  return null;
}

function collectGalleryBlocks(html: string, classMarkers: readonly string[], requireProductSignal: boolean): string[] {
  const blocks: string[] = [];
  const seen = new Set<string>();

  for (const openingTagMatch of Array.from(html.matchAll(/<([a-z0-9-]+)\b[^>]*>/gi))) {
    const openingTag = openingTagMatch[0];
    const classNames = parseClassNamesFromTag(openingTag);
    if (classNames.length < 1) continue;

    const hasMarker = classMarkers.some((marker) => classNames.some((className) => className.includes(marker)));
    if (!hasMarker) continue;

    const startIndex = openingTagMatch.index;
    if (startIndex === undefined) continue;
    const block = extractBalancedTagBlock(html, startIndex);
    if (!block) continue;
    if (requireProductSignal) {
      const hasProductSignalInClassNames = classNames.some((className) => className.includes("product") || className.includes("woocommerce"));
      const hasProductSignalInBlock = /product_title|entry-title|značka:|kategorie:/i.test(block);
      if (!hasProductSignalInClassNames && !hasProductSignalInBlock) continue;
    }
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  return blocks;
}

function collectNarrowProductRootBlocks(html: string): string[] {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const allowedTags = new Set(["main", "article", "section", "div"]);

  for (const openingTagMatch of Array.from(html.matchAll(/<([a-z0-9-]+)\b[^>]*>/gi))) {
    const openingTag = openingTagMatch[0];
    const tagName = openingTagMatch[1]?.toLowerCase();
    if (!tagName || !allowedTags.has(tagName)) continue;
    const classNames = parseClassNamesFromTag(openingTag);
    if (classNames.length < 1) continue;

    const hasNarrowRootMarker = NARROW_PRODUCT_ROOT_CLASS_MARKERS.some((marker) =>
      classNames.some((className) => className.includes(marker)),
    );
    if (!hasNarrowRootMarker) continue;

    const startIndex = openingTagMatch.index;
    if (startIndex === undefined) continue;
    const block = extractBalancedTagBlock(html, startIndex);
    if (!block) continue;
    const hasProductTitleSignal = /product_title|entry-title/i.test(block);
    if (!hasProductTitleSignal) continue;
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  return blocks;
}

function extractAttributeValue(tag: string, attributeName: string): string | null {
  const match = new RegExp(`\\b${attributeName}=["']([^"']+)["']`, "i").exec(tag);
  return match?.[1]?.trim() || null;
}

function isGalleryThumbnailVariant(imageUrl: URL): boolean {
  const pathname = imageUrl.pathname.toLowerCase();
  if (pathname.includes("-300x300")) return true;
  const resizedMatch = pathname.match(/-(\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+$)/i);
  if (!resizedMatch) return false;
  const width = Number.parseInt(resizedMatch[1], 10);
  const height = Number.parseInt(resizedMatch[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width <= 400 && height <= 400;
}

function extractImageUrls(html: string, pageUrl: URL): { imageUrls: string[]; failure?: ParseFailure } {
  function evaluateBlockTier(blocks: string[]): { bestScore: number; bestPreferredUrls: string[]; bestReturnedUrls: string[] } {
    let bestScore = 0;
    let bestPreferredUrls: string[] = [];
    let bestReturnedUrls: string[] = [];

    for (const block of blocks) {
      const primaryUrls: string[] = [];
      const secondaryUrls: string[] = [];
      const fallbackImgUrls: string[] = [];
      for (const imgTagMatch of Array.from(block.matchAll(/<img\b[^>]*>/gi))) {
        const imgTag = imgTagMatch[0];
        let hasValidPrimaryForImg = false;
        const largeImageCandidate = extractAttributeValue(imgTag, "data-large_image");
        if (largeImageCandidate) {
          try {
            const resolvedUrl = new URL(largeImageCandidate, pageUrl);
            if (isAllowedProductImageUrl(resolvedUrl) && !isGalleryThumbnailVariant(resolvedUrl)) {
              const resolved = resolvedUrl.toString();
              if (!primaryUrls.includes(resolved)) primaryUrls.push(resolved);
              hasValidPrimaryForImg = true;
            }
          } catch {
            // Keep evaluating data-src/src fallback for this same <img> tag.
          }
        }

        if (!hasValidPrimaryForImg) {
          const dataSrcCandidate = extractAttributeValue(imgTag, "data-src");
          const srcCandidate = /\ssrc=["']([^"']+)["']/i.exec(imgTag)?.[1]?.trim() || null;
          const fallbackCandidates = [dataSrcCandidate, srcCandidate];
          for (const fallbackCandidate of fallbackCandidates) {
            if (!fallbackCandidate) continue;
            try {
              const resolvedUrl = new URL(fallbackCandidate, pageUrl);
              if (!isAllowedProductImageUrl(resolvedUrl)) continue;
              if (isGalleryThumbnailVariant(resolvedUrl)) continue;
              const resolved = resolvedUrl.toString();
              if (!fallbackImgUrls.includes(resolved)) fallbackImgUrls.push(resolved);
              break;
            } catch {
              continue;
            }
          }
        }
      }

      for (const anchorMatch of Array.from(block.matchAll(/<a\b[^>]*>/gi))) {
        const candidate = extractAttributeValue(anchorMatch[0], "href");
        if (!candidate) continue;
        try {
          const resolvedUrl = new URL(candidate, pageUrl);
          if (!isAllowedProductImageUrl(resolvedUrl)) continue;
          if (isGalleryThumbnailVariant(resolvedUrl)) continue;
          const resolved = resolvedUrl.toString();
          if (!secondaryUrls.includes(resolved)) secondaryUrls.push(resolved);
        } catch {
          continue;
        }
      }

      const usesPrimary = primaryUrls.length > 0;
      const usesSecondary = !usesPrimary && secondaryUrls.length > 0;
      const usesFallback = !usesPrimary && !usesSecondary && fallbackImgUrls.length > 0;

      const preferredUrls = usesPrimary
        ? primaryUrls.slice(0, INTERNAL_GALLERY_URL_SANITY_CAP)
        : usesSecondary
          ? secondaryUrls.slice(0, INTERNAL_GALLERY_URL_SANITY_CAP)
          : usesFallback
            ? fallbackImgUrls.slice(0, INTERNAL_GALLERY_URL_SANITY_CAP)
            : [];

      const orderedReturnedCandidates = [...primaryUrls, ...secondaryUrls, ...fallbackImgUrls];
      const returnedUrls: string[] = [];
      for (const imageUrl of orderedReturnedCandidates) {
        if (returnedUrls.includes(imageUrl)) continue;
        returnedUrls.push(imageUrl);
        if (returnedUrls.length >= INTERNAL_GALLERY_URL_SANITY_CAP) break;
      }

      const score = usesPrimary ? 3 : usesSecondary ? 2 : usesFallback ? 1 : 0;
      if (score > bestScore || (score === bestScore && preferredUrls.length > bestPreferredUrls.length)) {
        bestScore = score;
        bestPreferredUrls = preferredUrls;
        bestReturnedUrls = returnedUrls;
      }
    }

    return { bestScore, bestPreferredUrls, bestReturnedUrls };
  }

  const primaryBlocks = collectGalleryBlocks(html, PRIMARY_GALLERY_CLASS_MARKERS, false);
  const primaryTier = evaluateBlockTier(primaryBlocks);
  if (primaryTier.bestScore > 0) {
    return { imageUrls: primaryTier.bestReturnedUrls };
  }

  const secondaryBlocks = collectGalleryBlocks(html, SECONDARY_GALLERY_CLASS_MARKERS, true);
  const secondaryTier = evaluateBlockTier(secondaryBlocks);
  if (secondaryTier.bestScore > 0) {
    return { imageUrls: secondaryTier.bestReturnedUrls };
  }

  const narrowFallbackBlocks = collectNarrowProductRootBlocks(html);
  const narrowTier = evaluateBlockTier(narrowFallbackBlocks);
  if (narrowTier.bestScore > 0) {
    return { imageUrls: narrowTier.bestReturnedUrls };
  }

  const hasAnyCandidateBlocks = primaryBlocks.length > 0 || secondaryBlocks.length > 0 || narrowFallbackBlocks.length > 0;
  if (!hasAnyCandidateBlocks) {
    return {
      imageUrls: [],
      failure: {
        code: "missing_product_gallery",
        reason: "Missing trusted product gallery container",
      },
    };
  }

  return {
    imageUrls: [],
    failure: {
      code: "missing_valid_gallery_images",
      reason: "Trusted product gallery found, but no valid gallery images after filtering",
    },
  };
}

function extractOptions(html: string): { options: string[]; present: boolean } {
  const selectBlocks = Array.from(html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/gi), (m) => m[1]);
  const options: string[] = [];
  for (const block of selectBlocks) {
    for (const optionMatch of Array.from(block.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi))) {
      const value = stripTags(optionMatch[1]).trim();
      if (!value || /^zvolte/i.test(value)) continue;
      if (!options.includes(value)) options.push(value);
    }
  }
  return { options, present: selectBlocks.length > 0 };
}

function extractSectionByHeading(html: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatch = new RegExp(`<[^>]*>\\s*${escaped}\\s*<\\/[^>]+>`, "i").exec(html);
  if (!headingMatch || headingMatch.index === undefined) return "";
  const after = html.slice(headingMatch.index + headingMatch[0].length);
  const cut = after.search(/<[^>]*>\s*(Popis|Další informace|Recenze|Mohlo by se Vám líbit)/i);
  const section = cut >= 0 ? after.slice(0, cut) : after;
  return stripTags(section);
}

function deriveStructured(title: string): ParsedProductPage["structured"] {
  const lowered = title.toLowerCase();
  const productType = lowered.includes("mikina") ? "mikina" : lowered.includes("triko") ? "triko" : null;
  const audience = lowered.includes("pánská") ? "pánská" : lowered.includes("dámská") ? "dámská" : null;
  const lineNormalized = lowered.includes("skateboards") ? "skateboards" : null;
  const designMatch = lowered.match(/[–-]\s*([^()]+?)(?:\(|$)/);
  const designNormalized = designMatch?.[1]?.trim().toLowerCase() || null;
  const colorBlock = title.match(/\(([^)]+)\)/)?.[1] ?? "";
  const colorTokens = colorBlock
    .split(/[\/,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  return { productType, audience, lineNormalized, designNormalized, colorTokens };
}

export function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function createSourceProductKey(sourceSlug: string): string {
  const stableSlug = sanitizeSlug(sourceSlug);
  if (!stableSlug) {
    throw new Error("Missing stable source slug for sourceProductKey");
  }
  const hash = crypto.createHash("sha256").update(stableSlug).digest("hex").slice(0, 10);
  return `${stableSlug}--${hash}`;
}

export function isProtectionPageHtml(html: string): boolean {
  const lowered = html.toLowerCase();
  const strongSignals = [
    lowered.includes("proof of work - wedos protection"),
    lowered.includes("<h1") && lowered.includes("keeping you safe"),
    lowered.includes("wedos protection"),
  ].filter(Boolean).length;

  const markerHits = WEDOS_PROTECTION_MARKERS.filter((marker) => lowered.includes(marker)).length;
  return strongSignals >= 2 || (strongSignals >= 1 && markerHits >= 3);
}

export function parseTbsProductPage(sourceUrl: string, html: string): { product?: ParsedProductPage; failure?: ParseFailure } {
  const pageUrl = new URL(sourceUrl);
  const sourceSlug = pageUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";

  if (isProtectionPageHtml(html)) {
    return {
      failure: {
        code: "blocked_by_protection",
        reason: "Protection or challenge page detected instead of product HTML",
      },
    };
  }

  const rawTitle =
    firstCapture(html, [
      /<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /"name":"([^"]+)"/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title>([\s\S]*?)<\/title>/i,
    ]) || "";

  const title = decodeHtmlEntities(rawTitle)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();

  if (!title) {
    return { failure: { code: "missing_title", reason: "Main product title missing" } };
  }

  const brandRaw =
    firstCapture(html, [
      /Značka:\s*<[^>]+>\s*([^<]+)\s*<\/[^>]+>/i,
      /<span[^>]*>\s*Značka:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      /Značka:\s*([^<\n]+)/i,
    ]) || "";

  const brandNormalized = normalizeBrand(brandRaw);
  if (!brandNormalized) {
    return { failure: { code: "brand_not_trusted", reason: `Untrusted or missing brand metadata: ${brandRaw || "<empty>"}` } };
  }

  const categoryRaw =
    firstCapture(html, [
      /Kategorie:\s*<[^>]+>\s*([^<]+)\s*<\/[^>]+>/i,
      /<span[^>]*>\s*Kategorie:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      /Kategorie:\s*([^<\n]+)/i,
    ]) || "";

  const tagRaw = firstCapture(html, [/Štítek:\s*<[^>]+>\s*([^<]+)\s*<\/[^>]+>/i, /Štítek:\s*([^<\n]+)/i]);

  const priceText =
    firstCapture(html, [
      /<p[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
      /<span[^>]*class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    ]) || "";

  const { options, present: optionsPresent } = extractOptions(html);
  const descriptionRaw = extractSectionByHeading(html, "Popis");
  const additionalInfoRaw = extractSectionByHeading(html, "Další informace");

  const sizesSet = new Set<string>();
  for (const token of `${descriptionRaw} ${additionalInfoRaw}`.match(SIZE_TOKEN_RE) ?? []) {
    sizesSet.add(token.toUpperCase());
  }

  const imageExtraction = extractImageUrls(html, pageUrl);

  return {
    product: {
      sourceUrl,
      sourceSlug,
      title,
      brandRaw,
      brandNormalized,
      categoryRaw,
      tagRaw: tagRaw ?? null,
      priceText,
      priceCzk: parsePriceCzk(priceText),
      optionsRaw: options,
      optionsPresent,
      sizes: Array.from(sizesSet),
      descriptionRaw,
      additionalInfoRaw,
      imageUrls: imageExtraction.imageUrls,
      imageExtractionFailure: imageExtraction.failure ?? null,
      structured: deriveStructured(title),
    },
  };
}

export function extractBrandListingProductLinks(seedUrl: string, html: string): string[] {
  const base = new URL(seedUrl);
  const links: string[] = [];
  for (const match of Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi))) {
    const href = match[1];
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (!/\/obchod\//.test(url.pathname)) continue;
      if (!links.includes(url.toString())) links.push(url.toString());
    } catch {
      continue;
    }
  }
  return links;
}

export function createFingerprint(input: unknown): string {
  const payload = typeof input === "string" ? input : JSON.stringify(input);
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}
