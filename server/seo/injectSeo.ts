import { attachOfferPolicySchema } from "./schema";

const canonicalRegex = /<link\b(?=[^>]*\brel\s*=\s*(?:["']?canonical["']?))[^>]*>/i;
const ogUrlRegex = /<meta\b(?=[^>]*\bproperty\s*=\s*(?:["']?og:url["']?))[^>]*>/i;
const headCloseRegex = /<\/head>/i;
const jsonLdRegex = /<script\b(?=[^>]*\btype\s*=\s*(?:["']application\/ld\+json["']))[^>]*>([\s\S]*?)<\/script>/gi;

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

function augmentJsonLdScripts(html: string): string {
  return html.replace(jsonLdRegex, (fullMatch, jsonContent) => {
    try {
      const parsed = JSON.parse(jsonContent);
      const augmented = attachOfferPolicySchema(parsed);
      return fullMatch.replace(jsonContent, JSON.stringify(augmented));
    } catch {
      return fullMatch;
    }
  });
}

export function injectSeo(html: string, canonicalUrl: string): string {
  const safeUrl = escapeHtmlAttr(sanitizeCanonicalUrl(canonicalUrl));
  const canonicalTag = `<link rel="canonical" href="${safeUrl}">`;
  const ogUrlTag = `<meta property="og:url" content="${safeUrl}">`;

  let output = augmentJsonLdScripts(html);
  let hasCanonical = false;
  let hasOgUrl = false;

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
