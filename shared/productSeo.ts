export type ProductSeoData = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  sizes?: string[] | null;
  price?: number | null;
  image?: string | null;
  isActive?: boolean | null;
  stock?: number | null;
};

const DEFAULT_SITE_URL = "https://zleshop.cz";
const DEFAULT_OG_IMAGE = "/images/brand/hero.png";

function cleanText(value: string | null | undefined): string {
  return (value || "").trim();
}

function normalizeKey(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function hasWord(input: string, pattern: RegExp): boolean {
  return pattern.test(input);
}

function inferProductType(product: ProductSeoData): string | null {
  const category = normalizeKey(product.category);
  const name = normalizeKey(product.name);

  if (hasWord(category, /\b(snapback|cap|hat|cepic|čepic|kšiltovka)\b/)) return "Snapback čepice ZLE";
  if (hasWord(category, /\b(hoodie|mikina)\b/)) return "Mikina ZLE";
  if (hasWord(category, /\b(tee|tričko|triko|t shirt|tshirt)\b/)) return "Tričko ZLE";
  if (hasWord(category, /\b(beanie|kulich)\b/)) return "Beanie ZLE";
  if (hasWord(category, /\bcrewneck\b/)) return "Crewneck mikina ZLE";

  if (hasWord(name, /\b(snapback|kšiltovka)\b/) || (hasWord(name, /\b(5 panel|5panel)\b/) && hasWord(name, /\b(cepic|čepic|cap)\b/))) {
    return "Snapback čepice ZLE";
  }
  if (hasWord(name, /\b(hoodie|mikina)\b/)) return "Mikina ZLE";
  if (hasWord(name, /\b(tee|tričko|triko|t shirt|tshirt)\b/)) return "Tričko ZLE";
  if (hasWord(name, /\b(beanie|kulich)\b/)) return "Beanie ZLE";
  if (hasWord(name, /\bcrewneck\b/)) return "Crewneck mikina ZLE";

  return null;
}

function extractFeatureFragments(text: string): string[] {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return [];

  return compact
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8)
    .slice(0, 2)
    .map((part) => part.replace(/[,;:]$/, ""));
}

function formatSizes(sizes?: string[] | null): string {
  if (!Array.isArray(sizes) || sizes.length === 0) return "";

  const normalized = Array.from(new Set(sizes.map((size) => cleanText(size)).filter(Boolean))).slice(0, 4);
  if (normalized.length <= 1) return "";

  return `Velikosti ${normalized.join("-")}`;
}

function formatPrice(price?: number | null): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "";
  }

  return `${Math.round(price)} Kč`;
}

function formatSentence(parts: string[]): string {
  return parts.filter(Boolean).join(". ").replace(/\.+$/, "").concat(".");
}

function trimForSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength - 1);
  const safe = clipped.slice(0, Math.max(clipped.lastIndexOf(" "), 40)).trimEnd();
  return `${safe}…`;
}

export function buildProductSeoDescription(product: ProductSeoData): string {
  const title = inferProductType(product) || cleanText(product.name) || "Produkt ZLE";
  const featureParts = extractFeatureFragments(cleanText(product.description));
  const sizes = formatSizes(product.sizes);
  const price = formatPrice(product.price);

  const core = [title, ...featureParts.slice(0, 2), sizes, price].filter(Boolean);
  const built = formatSentence(core);
  return trimForSnippet(built, 158);
}

export function buildProductOgDescription(product: ProductSeoData): string {
  const title = inferProductType(product) || cleanText(product.name) || "Produkt ZLE";
  const feature = extractFeatureFragments(cleanText(product.description))[0];
  const price = formatPrice(product.price);
  const safeName = cleanText(product.name);
  const modelHint = safeName && normalizeKey(safeName) !== normalizeKey(title) ? `Model ${safeName}` : "";
  const sizes = formatSizes(product.sizes);

  const parts = [title, feature || modelHint || sizes, price].filter(Boolean);
  return trimForSnippet(formatSentence(parts), 132);
}

export function getProductCanonicalPath(productId: string): string {
  return `/p/${encodeURIComponent(cleanText(productId))}`;
}

export function toAbsoluteUrl(pathOrUrl: string, siteUrl?: string): string {
  const base = cleanText(siteUrl) || DEFAULT_SITE_URL;
  const normalizedBase = base.replace(/\/+$/, "") || DEFAULT_SITE_URL;

  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = cleanText(pathOrUrl) || DEFAULT_OG_IMAGE;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildProductJsonLd(product: ProductSeoData, input: { siteUrl?: string; imageUrl?: string }) {
  const canonicalPath = getProductCanonicalPath(product.id);
  const url = toAbsoluteUrl(canonicalPath, input.siteUrl);
  const description = buildProductSeoDescription(product);
  const image = toAbsoluteUrl(input.imageUrl || product.image || DEFAULT_OG_IMAGE, input.siteUrl);

  const offer: Record<string, string> = {
    "@type": "Offer",
    url,
    priceCurrency: "CZK",
    itemCondition: "https://schema.org/NewCondition",
  };

  if (typeof product.price === "number" && Number.isFinite(product.price) && product.price > 0) {
    offer.price = String(product.price);
  }

  if (typeof product.stock === "number") {
    offer.availability = product.stock > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";
  }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: cleanText(product.name) || "Produkt ZLE",
    sku: cleanText(product.id),
    image,
    description,
    brand: {
      "@type": "Brand",
      name: "ZLE",
    },
    url,
    offers: offer,
  };
}
