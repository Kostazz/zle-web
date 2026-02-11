import { attachOfferPolicySchema, buildMerchantReturnPolicy, buildOfferShippingDetails } from "./schema";

const canonicalRegex = /<link\b(?=[^>]*\brel\s*=\s*(?:["']?canonical["']?))[^>]*>/i;
const ogUrlRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:url["']?))[^>]*>/i;
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

export function injectSeo(html: string, canonicalUrl: string): string {
  const safeUrl = escapeHtmlAttr(sanitizeCanonicalUrl(canonicalUrl));
  const canonicalTag = `<link rel="canonical" href="${safeUrl}">`;
  const ogUrlTag = `<meta property="og:url" content="${safeUrl}">`;

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

  if (ogUrlRegex.test(output)) {
    output = output.replace(ogUrlRegex, ogUrlTag);
    hasOgUrl = true;
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

  return output;
}
