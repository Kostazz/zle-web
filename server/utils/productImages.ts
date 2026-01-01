import type { Product } from "@shared/schema";

const STATIC_PREFIX = "/images/products/";
const LEGACY_PREFIX = "/api/images"; // bez trailing slash záměrně

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function stripQueryAndHash(url: string): string {
  // bezpečně odstraní ? a # část
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  const cut = q === -1 ? h : h === -1 ? q : Math.min(q, h);
  return cut === -1 ? url : url.slice(0, cut);
}

function normalizeSlashes(url: string): string {
  // Windows backslash -> URL slash
  return url.replace(/\\/g, "/");
}

function addJpgIfMissing(name: string): string {
  // pokud už má nějakou příponu, nesahej na to
  if (/\.[a-zA-Z0-9]{2,5}$/.test(name)) return name;
  return `${name}.jpg`;
}

function toLegacySlug(url: string): string | null {
  // akceptuj /api/images i /api/images/
  const base = url.startsWith(LEGACY_PREFIX + "/") ? (LEGACY_PREFIX + "/") : url === LEGACY_PREFIX ? LEGACY_PREFIX : null;
  if (!base) return null;

  const slug = url === LEGACY_PREFIX ? "" : url.slice((LEGACY_PREFIX + "/").length);
  const cleaned = slug.replace(/^\/+/, "").trim();
  return cleaned.length ? cleaned : null;
}

export function normalizeProductImageUrl(url?: unknown): string | undefined {
  if (!isNonEmptyString(url)) return undefined;

  let u = url.trim();
  u = normalizeSlashes(u);
  u = stripQueryAndHash(u);

  // absolutní URL necháme
  if (/^https?:\/\//i.test(u)) return u;

  // už je správně
  if (u.startsWith(STATIC_PREFIX)) return u;

  // legacy /api/images/<slug>
  const slug = toLegacySlug(u);
  if (slug) {
    return `${STATIC_PREFIX}${addJpgIfMissing(slug)}`;
  }

  // ostatní relative cesty necháme beze změny
  return u;
}

export function normalizeProductImages<T extends Partial<Product>>(product: T): T {
  const p: any = product as any;

  // image: jen pokud je string a umíme přemapovat
  const normalizedImage = normalizeProductImageUrl(p.image);
  const image = normalizedImage ?? p.image;

  // images: mapuj jen pole; uvnitř mapuj jen stringy
  const imagesRaw = p.images;
  const images =
    Array.isArray(imagesRaw)
      ? imagesRaw.map((item: unknown) => {
          if (!isNonEmptyString(item)) return item as any;
          return normalizeProductImageUrl(item) ?? item;
        })
      : imagesRaw;

  return {
    ...p,
    image,
    images,
  };
}
