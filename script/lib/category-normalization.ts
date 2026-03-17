import { normalizeText } from "./catalog-index.ts";

const SOURCE_TO_CANONICAL_CATEGORY: Record<string, "hoodie" | "tee" | "cap" | "beanie" | "crewneck"> = {
  mikina: "hoodie",
  triko: "tee",
  ksiltovka: "cap",
  kulich: "beanie",
  crewneck: "crewneck",
};

export function canonicalizeCategory(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw ?? "");
  if (!normalized) return null;
  return SOURCE_TO_CANONICAL_CATEGORY[normalized] ?? normalized;
}
