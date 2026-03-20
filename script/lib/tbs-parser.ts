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

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
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
  if (normalized === "zle" || normalized === "zle skateboarding" || normalized === "zle skateboards") return "zle";
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

function extractImageUrls(html: string, pageUrl: URL): string[] {
  const urls: string[] = [];
  const patterns = [
    /<img[^>]+(?:src|data-large_image|data-src)=["']([^"']+)["'][^>]*>/gi,
    /<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const candidate = match[1]?.trim();
      if (!candidate) continue;
      try {
        const resolved = new URL(candidate, pageUrl).toString();
        if (!urls.includes(resolved)) urls.push(resolved);
      } catch {
        continue;
      }
    }
  }

  return urls;
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

  const title =
    firstCapture(html, [
      /<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /"name":"([^"]+)"/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title>([\s\S]*?)<\/title>/i,
    ]) || "";

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

  const imageUrls = extractImageUrls(html, pageUrl);

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
      imageUrls,
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
