import { normalizeText } from "./catalog-index.ts";

export const SUPPORTED_INTERNAL_CATEGORIES = ["hoodie", "tee", "cap", "accessories", "beanie", "crewneck"] as const;

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

  accessories: "accessories",
  accessory: "accessories",
  doplnek: "accessories",
  doplnky: "accessories",
  "ostatni doplnek": "accessories",
  "ostatni doplnky": "accessories",

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

export function normalizeCategoryText(input: string): string {
  return normalizeText(input)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeCategory(raw: string | null | undefined): SupportedInternalCategory | string | null {
  const normalized = normalizeCategoryText(raw ?? "");
  if (!normalized) return null;
  return EXPLICIT_CATEGORY_SYNONYMS[normalized] ?? normalized;
}

export function isSupportedCategory(value: unknown): value is SupportedInternalCategory {
  return SUPPORTED_INTERNAL_CATEGORIES.includes(value as SupportedInternalCategory);
}

export function normalizeCategory(input: {
  categoryRaw: string | null | undefined;
  productType: string | null | undefined;
  title: string | null | undefined;
}): SupportedInternalCategory {
  const mappedCategoryRaw = canonicalizeCategory(input.categoryRaw);
  if (isSupportedCategory(mappedCategoryRaw)) return mappedCategoryRaw;

  const mappedProductType = canonicalizeCategory(input.productType);
  if (isSupportedCategory(mappedProductType)) return mappedProductType;

  const normalizedTitle = normalizeCategoryText(input.title ?? "");
  if (/\b(mikina bez kapuce|crewneck|sweatshirt)\b/.test(normalizedTitle)) return "crewneck";
  if (/\b(zimni cepice|beanie|kulich)\b/.test(normalizedTitle)) return "beanie";
  if (/\b(accessories|accessory|doplnek|doplnky|klicenka|ledvinka|bag|gear|tool)\b/.test(normalizedTitle)) return "accessories";
  if (/\b(hoodie|mikina)\b/.test(normalizedTitle)) return "hoodie";
  if (/\b(tee|tricko|triko|t shirt|tshirt)\b/.test(normalizedTitle)) return "tee";
  if (/\b(cap|cepice|ksiltovka|snapback|trucker|sitovka)\b/.test(normalizedTitle)) return "cap";

  return "tee";
}
