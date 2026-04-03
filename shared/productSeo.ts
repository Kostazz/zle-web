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

function categoryLabel(category?: string | null): string {
  const value = cleanText(category);
  if (!value) return "";

  return value
    .replace(/[\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatSizes(sizes?: string[] | null): string {
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return "";
  }

  const normalized = Array.from(new Set(sizes.map((size) => cleanText(size)).filter(Boolean))).slice(0, 3);
  if (normalized.length === 0) return "";

  return normalized.length === 1 ? `velikost ${normalized[0]}` : `velikosti ${normalized.join(", ")}`;
}

function formatPrice(price?: number | null): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "";
  }

  return `${Math.round(price)} Kč`;
}

export function buildProductSeoDescription(product: ProductSeoData): string {
  const name = cleanText(product.name) || "Produkt";
  const category = categoryLabel(product.category);
  const base = category ? `${name} (${category})` : name;

  const attributes = [formatPrice(product.price), formatSizes(product.sizes)].filter(Boolean).slice(0, 2);

  if (attributes.length > 0) {
    return `${base} od ZLE. ${attributes.join(", ")}.`;
  }

  const sourceDescription = cleanText(product.description);
  if (sourceDescription) {
    const compact = sourceDescription.replace(/\s+/g, " ").trim();
    const snippet = compact.length > 110 ? `${compact.slice(0, 107).trimEnd()}...` : compact;
    return `${name} od ZLE. ${snippet}`;
  }

  return `${name} od ZLE. Produkt z aktuální nabídky ZLE shopu.`;
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
