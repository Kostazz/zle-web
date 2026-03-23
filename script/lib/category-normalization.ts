import { normalizeText } from "./catalog-index.ts";

export const SUPPORTED_INTERNAL_CATEGORIES = ["hoodie", "tee", "cap", "beanie", "crewneck"] as const;

export type SupportedInternalCategory = (typeof SUPPORTED_INTERNAL_CATEGORIES)[number];

const EXPLICIT_CATEGORY_SYNONYMS: Readonly<Record<string, SupportedInternalCategory>> = {
  ksiltovka: "cap",
  ksiltovky: "cap",
  ksilt: "cap",
  cap: "cap",
  caps: "cap",
  snapback: "cap",
  snapbacky: "cap",
  trucker: "cap",
  truckerka: "cap",
  truckerky: "cap",
  truckercap: "cap",
  "trucker hat": "cap",
  "trucker hats": "cap",

  tricko: "tee",
  tricka: "tee",
  triko: "tee",
  trika: "tee",
  trycko: "tee",
  trycka: "tee",
  tee: "tee",
  tees: "tee",
  tshirt: "tee",
  tshirts: "tee",
  "t shirt": "tee",
  "t shirts": "tee",

  mikina: "hoodie",
  mikiny: "hoodie",
  mikyna: "hoodie",
  mikyny: "hoodie",
  hoodie: "hoodie",
  hoodies: "hoodie",

  crewneck: "crewneck",
  crew: "crewneck",
  sweatshirt: "crewneck",
  "mikina bez kapuce": "crewneck",

  beanie: "beanie",
  beanies: "beanie",
  kulich: "beanie",
  kulichy: "beanie",
  "zimni cepice": "beanie",
};

export function normalizeCategory(input: string): string {
  return normalizeText(input)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeCategory(raw: string | null | undefined): SupportedInternalCategory | string | null {
  const normalized = normalizeCategory(raw ?? "");
  if (!normalized) return null;
  return EXPLICIT_CATEGORY_SYNONYMS[normalized] ?? normalized;
}
