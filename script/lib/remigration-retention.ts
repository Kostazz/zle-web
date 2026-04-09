import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  DEFAULT_REMIGRATION_BACKUPS_ROOT,
  DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT,
  DEFAULT_REMIGRATION_RUNS_ROOT,
  ensureDir,
} from "./remigration-asset-roots.ts";

export type CleanupRemigrationArtifactsInput = {
  keepLastNCleanRoomRuns?: number;
  keepLastNBackups?: number;
  keepLastNRunStates?: number;
  keepLastNVersionRoots?: number;
  preserveRunIds?: string[];
  preserveBackupIds?: string[];
  preserveVersionIds?: string[];
  activeVersionId?: string | null;
  previousVersionId?: string | null;
  logger?: Pick<Console, "log" | "warn">;
};

export type CleanupRemigrationArtifactsResult = {
  removedCleanRoomRuns: string[];
  removedBackups: string[];
  removedRunStates: string[];
  removedVersionRoots: string[];
};

async function listEntriesByMtimeDesc(root: string): Promise<Array<{ name: string; fullPath: string; mtimeMs: number; isDirectory: boolean }>> {
  if (!fs.existsSync(root)) return [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const resolved = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    const stat = await fs.promises.stat(fullPath);
    return {
      name: entry.name,
      fullPath,
      mtimeMs: stat.mtimeMs,
      isDirectory: entry.isDirectory(),
    };
  }));
  return resolved.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

async function cleanupDirectoryEntries(
  root: string,
  keepLastN: number,
  preserveNames: Set<string>,
  logger: Pick<Console, "log" | "warn">,
): Promise<string[]> {
  const entries = await listEntriesByMtimeDesc(root);
  const removed: string[] = [];
  let kept = 0;
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (preserveNames.has(entry.name)) {
      logger.log(`retention keep preserved ${entry.fullPath}`);
      continue;
    }
    kept += 1;
    if (kept <= keepLastN) continue;
    await fs.promises.rm(entry.fullPath, { recursive: true, force: true });
    removed.push(entry.name);
    logger.log(`retention removed ${entry.fullPath}`);
  }
  return removed;
}

async function cleanupRunStateFiles(
  keepLastN: number,
  preserveRunIds: Set<string>,
  logger: Pick<Console, "log" | "warn">,
): Promise<string[]> {
  const entries = await listEntriesByMtimeDesc(DEFAULT_REMIGRATION_RUNS_ROOT);
  const removed: string[] = [];
  let kept = 0;
  for (const entry of entries) {
    if (!entry.name.endsWith(".state.json")) continue;
    const runId = entry.name.slice(0, -".state.json".length);
    if (preserveRunIds.has(runId)) {
      logger.log(`retention keep preserved ${entry.fullPath}`);
      continue;
    }
    kept += 1;
    if (kept <= keepLastN) continue;
    await fs.promises.rm(entry.fullPath, { force: true });
    removed.push(entry.name);
    logger.log(`retention removed ${entry.fullPath}`);
  }
  return removed;
}

export async function cleanupRemigrationArtifacts(input: CleanupRemigrationArtifactsInput = {}): Promise<CleanupRemigrationArtifactsResult> {
  const logger = input.logger ?? console;
  const keepLastNCleanRoomRuns = input.keepLastNCleanRoomRuns ?? 3;
  const keepLastNBackups = input.keepLastNBackups ?? 3;
  const keepLastNRunStates = input.keepLastNRunStates ?? 10;
  const keepLastNVersionRoots = input.keepLastNVersionRoots ?? 5;

  await ensureDir(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, path.resolve("tmp", "remigration"));
  await ensureDir(DEFAULT_REMIGRATION_BACKUPS_ROOT, path.resolve("tmp", "remigration"));
  await ensureDir(DEFAULT_REMIGRATION_RUNS_ROOT, path.resolve("tmp", "remigration"));
  await ensureDir(DEFAULT_PRODUCT_VERSIONS_ROOT, path.resolve("client", "public", "images"));

  const preserveRunIds = new Set(input.preserveRunIds ?? []);
  const preserveBackupIds = new Set(input.preserveBackupIds ?? []);
  const preserveVersionIds = new Set(input.preserveVersionIds ?? []);
  if (input.activeVersionId) preserveVersionIds.add(input.activeVersionId);
  if (input.previousVersionId) preserveVersionIds.add(input.previousVersionId);

  const removedCleanRoomRuns = await cleanupDirectoryEntries(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, keepLastNCleanRoomRuns, preserveRunIds, logger);
  const removedBackups = await cleanupDirectoryEntries(DEFAULT_REMIGRATION_BACKUPS_ROOT, keepLastNBackups, preserveBackupIds, logger);
  const removedRunStates = await cleanupRunStateFiles(keepLastNRunStates, preserveRunIds, logger);
  const removedVersionRoots = await cleanupDirectoryEntries(DEFAULT_PRODUCT_VERSIONS_ROOT, keepLastNVersionRoots, preserveVersionIds, logger);

  return { removedCleanRoomRuns, removedBackups, removedRunStates, removedVersionRoots };
}
