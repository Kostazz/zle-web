import fs from "node:fs";
import path from "node:path";
import { products } from "../../client/src/data/products.ts";
import type { CatalogIndex, CatalogIndexEntry, LocalCatalogProduct } from "./reconciliation-types.ts";

export const DEFAULT_CATALOG_INDEX_PATH = path.join("tmp", "catalog-index", "zle-source-index.json");

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

export function loadLocalCatalog(): LocalCatalogProduct[] {
  return products.map((product) => {
    const nameNormalized = normalizeText(product.name);
    const categoryNormalized = normalizeText(product.category ?? "");
    const imageHints = (product.images ?? [])
      .map((img) => normalizeText(img.split("/").at(-1) ?? img))
      .filter(Boolean);

    return {
      id: product.id,
      name: product.name,
      nameNormalized,
      category: product.category ?? null,
      categoryNormalized: categoryNormalized || null,
      sizes: [...(product.sizes ?? [])],
      imageHints,
      tokens: Array.from(new Set([...tokenize(product.name), ...tokenize(product.category ?? "")])),
    };
  });
}

export async function readCatalogIndex(indexPath = DEFAULT_CATALOG_INDEX_PATH): Promise<CatalogIndex> {
  if (!fs.existsSync(indexPath)) {
    return { version: 1, updatedAt: new Date(0).toISOString(), entries: [] };
  }

  const raw = await fs.promises.readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw) as CatalogIndex;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid catalog index format: ${indexPath}`);
  }

  const keys = new Set<string>();
  for (const entry of parsed.entries) {
    if (keys.has(entry.sourceProductKey)) {
      throw new Error(`Catalog index collision detected for sourceProductKey=${entry.sourceProductKey}`);
    }
    keys.add(entry.sourceProductKey);
  }

  parsed.entries.sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey));
  return parsed;
}

export async function writeCatalogIndex(index: CatalogIndex, indexPath = DEFAULT_CATALOG_INDEX_PATH): Promise<void> {
  const dedupe = new Set<string>();
  for (const entry of index.entries) {
    if (dedupe.has(entry.sourceProductKey)) {
      throw new Error(`Refusing to write catalog index with duplicate key: ${entry.sourceProductKey}`);
    }
    dedupe.add(entry.sourceProductKey);
  }

  const normalized: CatalogIndex = {
    version: 1,
    updatedAt: index.updatedAt,
    entries: [...index.entries].sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey)),
  };

  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(normalized, null, 2), "utf8");
}

export function upsertCatalogEntries(existing: CatalogIndex, updates: CatalogIndexEntry[]): CatalogIndex {
  const map = new Map(existing.entries.map((entry) => [entry.sourceProductKey, entry]));
  for (const update of updates) {
    map.set(update.sourceProductKey, update);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: Array.from(map.values()).sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey)),
  };
}
