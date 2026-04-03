import { buildProductSeoDescription } from "@shared/productSeo";
export const DEFAULT_TITLE = "ZLE — Live Raw, Ride Hard";
export const DEFAULT_DESCRIPTION =
  "ZLE — underground skate/street crew. Live raw, ride hard. No filters, no bullshit.";

export const DEFAULT_OG_IMAGE = "/images/brand/hero.png";
const PRODUCT_PATH_PATTERN = /^\/p\/([^/]+)$/;

type BreadcrumbItem = {
  label: string;
  path: string;
};

export type RouteMeta = {
  match: RegExp;
  title: string;
  description: string;
  noindex?: boolean;
  ogImage?: string;
  breadcrumb?: BreadcrumbItem[];
};

type ProductSeoSource = {
  id: string;
  name: string;
  description?: string | null;
  image?: string | null;
  category?: string | null;
  sizes?: string[];
  price?: number;
};

export const ROUTE_META: RouteMeta[] = [
  {
    match: /^\/$/,
    title: "ZLE — Live Raw, Ride Hard",
    description:
      "Oficiální web ZLE crew. Streetwear, spoty, stories a merch přímo z underground scény.",
    breadcrumb: [{ label: "Home", path: "/" }],
  },
  {
    match: /^\/shop$/,
    title: "Shop | ZLE",
    description:
      "Kup originální ZLE merch. Trička, hoodies a limitované dropy navržené pro street a skate komunitu.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Shop", path: "/shop" },
    ],
  },
  {
    match: /^\/story$/,
    title: "Story | ZLE",
    description:
      "Jak vznikl ZLE. Naše filozofie, crew mindset a cesta od lokálních spotů po vlastní značku.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Story", path: "/story" },
    ],
  },
  {
    match: /^\/crew$/,
    title: "Crew | ZLE",
    description:
      "Poznej ZLE crew, videa a momenty ze scény. Real life, raw energy, žádný fake.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Crew", path: "/crew" },
    ],
  },
  {
    match: /^\/contact$/,
    title: "Kontakt | ZLE",
    description: "Kontaktuj ZLE kvůli spolupráci, médiím nebo dotazům k objednávkám.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Kontakt", path: "/contact" },
    ],
  },
  {
    match: /^\/legal$/,
    title: "Právní informace | ZLE",
    description: "Právní dokumenty ZLE: obchodní podmínky, GDPR, cookies a kontaktní informace.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
    ],
  },
  {
    match: /^\/legal\/terms$/,
    title: "Obchodní podmínky | ZLE",
    description: "Obchodní podmínky ZLE e-shopu a pravidla nákupu.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Obchodní podmínky", path: "/legal/terms" },
    ],
  },
  {
    match: /^\/legal\/privacy$/,
    title: "Soukromí | ZLE",
    description: "Informace o zpracování osobních údajů a ochraně soukromí.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Soukromí", path: "/legal/privacy" },
    ],
  },
  {
    match: /^\/legal\/cookies$/,
    title: "Cookies | ZLE",
    description: "Zásady používání cookies na webu ZLE.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Cookies", path: "/legal/cookies" },
    ],
  },
  {
    match: /^\/legal\/returns$/,
    title: "Reklamační řád | ZLE",
    description: "Postup reklamace zboží u objednávek ZLE.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Reklamační řád", path: "/legal/returns" },
    ],
  },
  {
    match: /^\/legal\/withdrawal$/,
    title: "Odstoupení od smlouvy | ZLE",
    description: "Informace o odstoupení od smlouvy, vrácení zboží do 14 dnů a vzorový formulář.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Odstoupení od smlouvy", path: "/legal/withdrawal" },
    ],
  },
  {
    match: /^\/legal\/contact$/,
    title: "Kontakt | Právní | ZLE",
    description: "Právní a provozní kontaktní údaje značky ZLE.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Kontakt", path: "/legal/contact" },
    ],
  },
  {
    match: /^\/(admin|ops|account|checkout|success|cancel)(\/|$)/,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    noindex: true,
  },
];

export function getRouteMeta(pathname: string): RouteMeta | undefined {
  return ROUTE_META.find((entry) => entry.match.test(pathname));
}

export function getProductIdFromPath(pathname: string): string | null {
  const match = pathname.match(PRODUCT_PATH_PATTERN);
  return match?.[1] ?? null;
}

export function getRouteMetaWithProduct(
  pathname: string,
  products: ProductSeoSource[] | undefined,
): RouteMeta | undefined {
  const staticRouteMeta = getRouteMeta(pathname);
  if (staticRouteMeta) {
    return staticRouteMeta;
  }

  const productId = getProductIdFromPath(pathname);
  if (!productId) {
    return undefined;
  }

  const product = products?.find((item) => item.id === productId);
  if (!product) {
    return {
      match: PRODUCT_PATH_PATTERN,
      title: "Produkt | ZLE",
      description: "Produkt nebyl nalezen. Prohlédni si aktuální merch v našem shopu.",
      noindex: true,
      ogImage: DEFAULT_OG_IMAGE,
      breadcrumb: [
        { label: "Home", path: "/" },
        { label: "Shop", path: "/shop" },
      ],
    };
  }

  return {
    match: PRODUCT_PATH_PATTERN,
    title: `${product.name} | ZLE Shop`,
    description: buildProductSeoDescription(product),
    ogImage: product.image || DEFAULT_OG_IMAGE,
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Shop", path: "/shop" },
      { label: product.name, path: `/p/${product.id}` },
    ],
  };
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  const pathOnly = pathname.split("#")[0].split("?")[0] || "/";
  return pathOnly.replace(/\/+$/, "") || "/";
}

export function getCanonicalPath(pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
  const productId = getProductIdFromPath(normalizedPath);

  if (productId) {
    return `/p/${productId}`;
  }

  return normalizedPath;
}
