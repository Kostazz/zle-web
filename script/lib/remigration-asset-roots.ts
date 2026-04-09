import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REMIGRATION_ROOT = path.resolve("tmp", "remigration");
export const DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT = path.join(DEFAULT_REMIGRATION_ROOT, "live-targets");
export const DEFAULT_REMIGRATION_BACKUPS_ROOT = path.join(DEFAULT_REMIGRATION_ROOT, "backups");
export const DEFAULT_REMIGRATION_REPORTS_ROOT = path.join(DEFAULT_REMIGRATION_ROOT, "reports");
export const DEFAULT_REMIGRATION_RUNS_ROOT = path.join(DEFAULT_REMIGRATION_ROOT, "runs");
export const DEFAULT_SWITCH_LOCK_PATH = path.join(DEFAULT_REMIGRATION_ROOT, ".switch-lock");
export const DEFAULT_SWITCH_IN_PROGRESS_PATH = path.join(DEFAULT_REMIGRATION_ROOT, ".switch-in-progress");

export const DEFAULT_LIVE_PRODUCTS_ROOT = path.resolve("client", "public", "images", "products");
export const DEFAULT_FALLBACK_PRODUCTS_ROOT = path.resolve("public", "images", "products");
export const DEFAULT_ASSETS_VERSION_SIGNAL_PATH = path.resolve("client", "public", ".assets-version.json");

export const DEFAULT_PRODUCT_VERSIONS_ROOT = path.resolve("client", "public", "images", "product-versions");
export const DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH = path.resolve("client", "public", ".active-product-assets.json");

export const MANAGED_ASSET_FILE_RE = /^(?:cover|\d{2})\.(?:jpg|webp)$/i;

export function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertInsideAllowedRoot(targetPath: string, allowedRoot: string, label: string): string {
  const resolved = path.resolve(targetPath);
  if (!isPathInside(path.resolve(allowedRoot), resolved)) {
    throw new Error(`Refusing ${label} outside allowlisted root: ${targetPath}`);
  }
  return resolved;
}

export function normalizeIdSegment(rawValue: string, label: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error(`Missing ${label}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(trimmed)) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }
  return trimmed;
}

export async function assertNoSymlinkInPathChain(targetPath: string, stopAtRoot: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(stopAtRoot);
  if (!isPathInside(normalizedRoot, normalizedTarget)) throw new Error(`Path escape blocked: ${normalizedTarget}`);

  const chain: string[] = [];
  let current = normalizedTarget;
  while (true) {
    chain.push(current);
    if (current === normalizedRoot) break;
    const next = path.dirname(current);
    if (next === current) throw new Error(`Unsafe root boundary for path: ${normalizedTarget}`);
    current = next;
  }

  for (const candidate of chain) {
    if (!fs.existsSync(candidate)) continue;
    const stat = await fs.promises.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error(`Symlink path blocked: ${candidate}`);
  }
}

export async function ensureDir(targetDir: string, allowedRoot: string): Promise<string> {
  const normalized = assertInsideAllowedRoot(targetDir, allowedRoot, "directory");
  await fs.promises.mkdir(normalized, { recursive: true });
  await assertNoSymlinkInPathChain(normalized, allowedRoot);
  return normalized;
}

export async function countDirectoryEntries(targetDir: string): Promise<number> {
  const entries = await fs.promises.readdir(targetDir);
  return entries.length;
}

export async function listDirectoryEntriesSafe(targetDir: string): Promise<string[]> {
  if (!fs.existsSync(targetDir)) return [];
  return fs.promises.readdir(targetDir);
}

export function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
