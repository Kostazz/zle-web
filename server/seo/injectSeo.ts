import { attachOfferPolicySchema, buildMerchantReturnPolicy, buildOfferShippingDetails } from "./schema";

const canonicalRegex = /<link\b(?=[^>]*\brel\s*=\s*(?:["']?canonical["']?))[^>]*>/i;
const ogUrlRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:url["']?))[^>]*>/i;
const robotsRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?robots["']?))[^>]*>/i;
const titleRegex = /<title\b[^>]*>[\s\S]*?<\/title>/i;
const descriptionRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?description["']?))[^>]*>/i;
const ogTitleRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:title["']?))[^>]*>/i;
const ogDescriptionRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:description["']?))[^>]*>/i;
const ogImageRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:image["']?))[^>]*>/i;
const twitterCardRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?twitter:card["']?))[^>]*>/i;
const twitterTitleRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?twitter:title["']?))[^>]*>/i;
const twitterDescriptionRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?twitter:description["']?))[^>]*>/i;
const twitterImageRegex = /<meta\b(?=[^>]*\bname\s*=\s*(?:["']?twitter:image["']?))[^>]*>/i;
const headCloseRegex = /<\/head>/i;
const headOpenRegex = /<head[^>]*>/i;
const htmlOpenRegex = /<html[^>]*>/i;
const jsonLdRegex = /<script\b(?=[^>]*\btype\s*=\s*(?:["']application\/ld\+json["']))[^>]*>([\s\S]*?)<\/script>/gi;
const SCHEMA_ID_BASE = "https://zleshop.cz";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeCanonicalUrl(canonicalUrl: string): string {
  const value = (canonicalUrl || "").trim();
  if (!value) return "https://zleshop.cz/";

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "https://zleshop.cz/";
  }
}

function sanitizeAbsoluteUrl(url: string): string {
  const value = (url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    if (/localhost|127\.0\.0\.1|::1/i.test(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeTypes(typeValue: unknown): string[] {
  if (typeof typeValue === "string") return [typeValue];
  if (Array.isArray(typeValue)) return typeValue.filter((item): item is string => typeof item === "string");
  return [];
}

function containsOfferType(input: unknown): boolean {
  if (Array.isArray(input)) {
    return input.some((item) => containsOfferType(item));
  }

  if (!input || typeof input !== "object") {
    return false;
  }

  const node = input as Record<string, unknown>;
  const types = normalizeTypes(node["@type"]);
  if (types.includes("Offer") || types.includes("AggregateOffer")) {
    return true;
  }

  if (containsOfferType(node["@graph"])) {
    return true;
  }

  return Object.values(node).some((value) => containsOfferType(value));
}

function buildPolicyGraphJsonLd(): string {
  const returnPolicy = {
    ...buildMerchantReturnPolicy(),
    "@id": `${SCHEMA_ID_BASE}/#return-policy`,
  };

  const [glsShipping, pickupShipping] = buildOfferShippingDetails();
  const shippingGls = {
    ...glsShipping,
    "@id": `${SCHEMA_ID_BASE}/#shipping-gls`,
  };
  const shippingPickup = {
    ...pickupShipping,
    "@id": `${SCHEMA_ID_BASE}/#shipping-pickup`,
  };

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [returnPolicy, shippingGls, shippingPickup],
  });
}

function insertJsonLdScript(html: string, jsonLdPayload: string): string {
  const scriptTag = `<script type="application/ld+json">${jsonLdPayload}</script>`;

  if (headCloseRegex.test(html)) {
    return html.replace(headCloseRegex, `  ${scriptTag}\n</head>`);
  }

  if (headOpenRegex.test(html)) {
    return html.replace(headOpenRegex, (match) => `${match}\n  ${scriptTag}`);
  }

  if (htmlOpenRegex.test(html)) {
    return html.replace(htmlOpenRegex, (match) => `${match}\n<head>\n  ${scriptTag}\n</head>`);
  }

  return `${scriptTag}\n${html}`;
}

function augmentJsonLdScripts(html: string): { output: string; hasOfferJsonLd: boolean } {
  let hasOfferJsonLd = false;

  const output = html.replace(jsonLdRegex, (fullMatch, jsonContent) => {
    try {
      const parsed = JSON.parse(jsonContent);
      if (containsOfferType(parsed)) {
        hasOfferJsonLd = true;
      }
      const augmented = attachOfferPolicySchema(parsed);
      return fullMatch.replace(jsonContent, JSON.stringify(augmented));
    } catch {
      return fullMatch;
    }
  });

  return { output, hasOfferJsonLd };
}

export type SeoMeta = {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  ogUrl?: string;
};

function upsertTag(output: string, regex: RegExp, tag: string): { output: string; exists: boolean } {
  if (regex.test(output)) {
    return { output: output.replace(regex, tag), exists: true };
  }
  return { output, exists: false };
}

export function injectSeo(html: string, canonicalUrl: string, seoMeta?: SeoMeta): string {
  const safeUrl = escapeHtmlAttr(sanitizeCanonicalUrl(canonicalUrl));
  const canonicalTag = `<link rel="canonical" href="${safeUrl}">`;
  const safeOgUrl = escapeHtmlAttr(sanitizeAbsoluteUrl(seoMeta?.ogUrl || canonicalUrl) || sanitizeCanonicalUrl(canonicalUrl));
  const ogUrlTag = `<meta property="og:url" content="${safeOgUrl}">`;

  const augmented = augmentJsonLdScripts(html);
  let output = augmented.output;
  let hasCanonical = false;
  let hasOgUrl = false;

  if (!augmented.hasOfferJsonLd) {
    output = insertJsonLdScript(output, buildPolicyGraphJsonLd());
  }

  if (canonicalRegex.test(output)) {
    output = output.replace(canonicalRegex, canonicalTag);
    hasCanonical = true;
  }

  ({ output, exists: hasOgUrl } = upsertTag(output, ogUrlRegex, ogUrlTag));

  const title = seoMeta?.title?.trim();
  const description = seoMeta?.description?.trim();
  const ogTitle = seoMeta?.ogTitle?.trim();
  const ogDescription = seoMeta?.ogDescription?.trim();
  const ogImage = sanitizeAbsoluteUrl(seoMeta?.ogImage || "");
  const twitterCard = seoMeta?.twitterCard?.trim();
  const twitterTitle = seoMeta?.twitterTitle?.trim();
  const twitterDescription = seoMeta?.twitterDescription?.trim();
  const twitterImage = sanitizeAbsoluteUrl(seoMeta?.twitterImage || "");

  const dynamicTags = [
    title ? { regex: titleRegex, tag: `<title>${escapeHtmlAttr(title)}</title>` } : null,
    description ? { regex: descriptionRegex, tag: `<meta name="description" content="${escapeHtmlAttr(description)}">` } : null,
    ogTitle ? { regex: ogTitleRegex, tag: `<meta property="og:title" content="${escapeHtmlAttr(ogTitle)}">` } : null,
    ogDescription ? { regex: ogDescriptionRegex, tag: `<meta property="og:description" content="${escapeHtmlAttr(ogDescription)}">` } : null,
    ogImage ? { regex: ogImageRegex, tag: `<meta property="og:image" content="${escapeHtmlAttr(ogImage)}">` } : null,
    twitterCard ? { regex: twitterCardRegex, tag: `<meta name="twitter:card" content="${escapeHtmlAttr(twitterCard)}">` } : null,
    twitterTitle ? { regex: twitterTitleRegex, tag: `<meta name="twitter:title" content="${escapeHtmlAttr(twitterTitle)}">` } : null,
    twitterDescription ? { regex: twitterDescriptionRegex, tag: `<meta name="twitter:description" content="${escapeHtmlAttr(twitterDescription)}">` } : null,
    twitterImage ? { regex: twitterImageRegex, tag: `<meta name="twitter:image" content="${escapeHtmlAttr(twitterImage)}">` } : null,
  ].filter((item): item is { regex: RegExp; tag: string } => Boolean(item));

  const missingDynamicTags: string[] = [];
  for (const { regex, tag } of dynamicTags) {
    const result = upsertTag(output, regex, tag);
    output = result.output;
    if (!result.exists) {
      missingDynamicTags.push(tag);
    }
  }

  if (!hasCanonical || !hasOgUrl) {
    const missingTags = [!hasCanonical ? canonicalTag : null, !hasOgUrl ? ogUrlTag : null]
      .filter(Boolean)
      .join("\n  ");

    if (headCloseRegex.test(output)) {
      output = output.replace(headCloseRegex, `  ${missingTags}\n</head>`);
    } else {
      output += `\n${missingTags}`;
    }
  }

  if (missingDynamicTags.length > 0) {
    const missingTags = missingDynamicTags.join("\n  ");
    if (headCloseRegex.test(output)) {
      output = output.replace(headCloseRegex, `  ${missingTags}\n</head>`);
    } else {
      output += `\n${missingTags}`;
    }
  }

  return output;
}

export function injectSeoWithOptions(
  html: string,
  canonicalUrl: string,
  options?: {
    robots?: string;
  },
): string {
  let output = injectSeo(html, canonicalUrl);
  const robots = options?.robots?.trim();

  if (!robots) {
    return output;
  }

  const robotsTag = `<meta name="robots" content="${escapeHtmlAttr(robots)}">`;

  if (robotsRegex.test(output)) {
    output = output.replace(robotsRegex, robotsTag);
    return output;
  }

  if (headCloseRegex.test(output)) {
    return output.replace(headCloseRegex, `  ${robotsTag}\n</head>`);
  }

  return `${output}\n${robotsTag}`;
}
