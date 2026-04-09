import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT,
  assertInsideAllowedRoot,
  countDirectoryEntries,
  ensureDir,
  normalizeIdSegment,
} from "./lib/remigration-asset-roots.ts";

type CliArgs = { runId: string; versionId: string };

function parseArgs(argv: string[]): CliArgs {
  let runId = "";
  let versionId = "";
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--run-id") {
      runId = next ?? "";
      index++;
      continue;
    }
    if (token === "--version-id") {
      versionId = next ?? "";
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!runId.trim()) throw new Error("Missing --run-id");
  if (!versionId.trim()) throw new Error("Missing --version-id");
  return {
    runId: normalizeIdSegment(runId, "run id"),
    versionId: normalizeIdSegment(versionId, "version id"),
  };
}

export async function runPromoteCleanRoomToProductVersion(runIdRaw: string, versionIdRaw: string): Promise<void> {
  const runId = normalizeIdSegment(runIdRaw, "run id");
  const versionId = normalizeIdSegment(versionIdRaw, "version id");

  const sourceRoot = assertInsideAllowedRoot(path.join(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, runId, "products"), DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, "clean-room root");
  const targetRoot = assertInsideAllowedRoot(path.join(DEFAULT_PRODUCT_VERSIONS_ROOT, versionId), DEFAULT_PRODUCT_VERSIONS_ROOT, "version root");

  await ensureDir(DEFAULT_PRODUCT_VERSIONS_ROOT, path.resolve("client", "public", "images"));
  if (!fs.existsSync(sourceRoot)) throw new Error(`Missing clean-room root: ${sourceRoot}`);
  if ((await countDirectoryEntries(sourceRoot)) < 1) throw new Error(`Clean-room root is empty: ${sourceRoot}`);

  if (fs.existsSync(targetRoot)) {
    const stat = await fs.promises.lstat(targetRoot);
    if (!stat.isDirectory()) throw new Error(`Version root path exists and is not directory: ${targetRoot}`);
    if ((await countDirectoryEntries(targetRoot)) > 0) {
      throw new Error(`Refusing promotion into existing non-empty version root: ${targetRoot}`);
    }
    throw new Error(`Refusing promotion into existing version root: ${targetRoot}`);
  }

  await fs.promises.rename(sourceRoot, targetRoot);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    await runPromoteCleanRoomToProductVersion(args.runId, args.versionId);
    console.log(`promoted run ${args.runId} -> version ${args.versionId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
