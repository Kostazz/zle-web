export const DEFAULT_TITLE = "ZLE — Live Raw, Ride Hard";
export const DEFAULT_DESCRIPTION =
  "ZLE — underground skate/street crew. Live raw, ride hard. No filters, no bullshit.";

export const DEFAULT_OG_IMAGE = "/images/brand/hero.png";

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
    title: "Reklamace & vrácení | ZLE",
    description: "Postup reklamace a vrácení zboží u objednávek ZLE.",
    breadcrumb: [
      { label: "Home", path: "/" },
      { label: "Právní", path: "/legal" },
      { label: "Reklamace & vrácení", path: "/legal/returns" },
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
