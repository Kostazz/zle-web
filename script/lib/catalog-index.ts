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

  const dir = path.dirname(indexPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.zle-source-index.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.promises.rename(tempPath, indexPath);
}

type CatalogIndexLockMeta = {
  pid: number;
  createdAtMs: number;
};

const LOCK_STALE_MS = 5 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

async function readLockMeta(lockPath: string): Promise<CatalogIndexLockMeta> {
  const raw = await fs.promises.readFile(lockPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid catalog lock metadata: ${lockPath}`);
  }

  const pid = Number((parsed as { pid?: unknown }).pid);
  const createdAtMs = Number((parsed as { createdAtMs?: unknown }).createdAtMs);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    throw new Error(`Invalid catalog lock metadata fields: ${lockPath}`);
  }

  return { pid, createdAtMs };
}

async function tryRecoverStaleLock(lockPath: string): Promise<void> {
  if (!fs.existsSync(lockPath)) return;

  const meta = await readLockMeta(lockPath);
  const ageMs = Date.now() - meta.createdAtMs;
  const alive = isProcessAlive(meta.pid);
  if (alive) return;
  if (ageMs < LOCK_STALE_MS) {
    throw new Error(`Catalog index lock held by dead process but not stale yet: ${lockPath}`);
  }

  await fs.promises.unlink(lockPath);
}

async function acquireFileLock(lockPath: string, retries = 40, delayMs = 100): Promise<number> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      const lockMeta: CatalogIndexLockMeta = { pid: process.pid, createdAtMs: Date.now() };
      fs.writeFileSync(fd, `${JSON.stringify(lockMeta)}
`, "utf8");
      return fd;
    } catch {
      await tryRecoverStaleLock(lockPath);
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Catalog index lock contention: ${lockPath}`);
}

async function releaseFileLock(lockPath: string, fd: number): Promise<void> {
  fs.closeSync(fd);
  if (fs.existsSync(lockPath)) {
    await fs.promises.unlink(lockPath);
  }
}

export async function mergeCatalogEntriesWithLock(updates: CatalogIndexEntry[], indexPath = DEFAULT_CATALOG_INDEX_PATH): Promise<CatalogIndex> {
  const lockPath = `${indexPath}.lock`;
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  const fd = await acquireFileLock(lockPath);
  try {
    const current = await readCatalogIndex(indexPath);
    const merged = upsertCatalogEntries(current, updates);
    await writeCatalogIndex(merged, indexPath);
    return merged;
  } finally {
    await releaseFileLock(lockPath, fd);
  }
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
