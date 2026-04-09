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

function formatPriceForTitle(price?: number | null): string {
  const formatted = formatPrice(price);
  return formatted || "cena neuvedena";
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

function buildFailClosedDescription(product: ProductSeoData): string {
  const safeName = cleanText(product.name) || "Produkt ZLE";
  const price = formatPrice(product.price);
  return price ? `${safeName}. ${price}.` : `${safeName}.`;
}

export function buildProductMetaTitle(product: ProductSeoData): string {
  const safeName = cleanText(product.name) || "Produkt ZLE";
  return `${safeName} — ${formatPriceForTitle(product.price)}`;
}

export function buildProductMetaDescription(product: ProductSeoData, maxLength = 158): string {
  const safeName = cleanText(product.name) || "Produkt ZLE";
  const price = formatPrice(product.price);
  const category = cleanText(product.category);
  const feature = extractFeatureFragments(cleanText(product.description))[0] || "";

  const parts = [safeName];

  if (feature) parts.push(feature);
  if (category) parts.push(category);
  if (price) parts.push(price);

  if (!feature && !category) {
    return trimForSnippet(buildFailClosedDescription(product), maxLength);
  }

  return trimForSnippet(formatSentence(parts), maxLength);
}

export function buildProductSeoDescription(product: ProductSeoData): string {
  return buildProductMetaDescription(product, 158);
}

export function buildProductOgDescription(product: ProductSeoData): string {
  return buildProductMetaDescription(product, 132);
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
  const description = buildProductMetaDescription(product, 220);
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
    if (product.isActive === true) {
      offer.availability = product.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
    } else {
      offer.availability = "https://schema.org/OutOfStock";
    }
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
