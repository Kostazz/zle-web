import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH,
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  assertInsideAllowedRoot,
  ensureDir,
  normalizeIdSegment,
} from "./lib/remigration-asset-roots.ts";
import { runVerifyProductAssetsVersionRoot } from "./verify-product-assets-version-root.ts";

type CliArgs = { versionId: string; sourceRunId: string };

function parseArgs(argv: string[]): CliArgs {
  let versionId = "";
  let sourceRunId = "";
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--version-id") {
      versionId = next ?? "";
      index++;
      continue;
    }
    if (token === "--source-run-id") {
      sourceRunId = next ?? "";
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!versionId.trim()) throw new Error("Missing --version-id");
  if (!sourceRunId.trim()) throw new Error("Missing --source-run-id");
  return {
    versionId: normalizeIdSegment(versionId, "version id"),
    sourceRunId: normalizeIdSegment(sourceRunId, "source run id"),
  };
}

export async function runActivateProductAssetsVersion(versionIdRaw: string, sourceRunIdRaw: string): Promise<void> {
  const versionId = normalizeIdSegment(versionIdRaw, "version id");
  const sourceRunId = normalizeIdSegment(sourceRunIdRaw, "source run id");
  const versionRoot = assertInsideAllowedRoot(path.join(DEFAULT_PRODUCT_VERSIONS_ROOT, versionId), DEFAULT_PRODUCT_VERSIONS_ROOT, "version root");
  if (!fs.existsSync(versionRoot)) throw new Error(`Missing version root: ${versionRoot}`);
  await runVerifyProductAssetsVersionRoot(versionId);

  const pointer = {
    mode: "v3-versioned-assets",
    versionId,
    sourceRunId,
    activatedAt: new Date().toISOString(),
  } as const;

  await ensureDir(path.dirname(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH), path.resolve("client", "public"));
  await fs.promises.writeFile(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    await runActivateProductAssetsVersion(args.versionId, args.sourceRunId);
    console.log(`activated ${args.versionId}`);
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
