import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

export type AssetFingerprint = {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  ext: string;
};

export type AssetIndexRecord = {
  key: string;
  fingerprint: AssetFingerprint;
  sourceRelativePath: string;
  firstSeenAt: string;
  runId: string;
};

export type AssetIndex = {
  version: 1;
  records: AssetIndexRecord[];
};

export const ASSET_INDEX_PATH = path.join("tmp", "agent-manifests", "asset-index.json");

function fingerprintKey(fp: AssetFingerprint): string {
  return `${fp.sha256}:${fp.bytes}:${fp.width}x${fp.height}:${fp.ext}`;
}

export async function computeAssetFingerprint(filePath: string): Promise<AssetFingerprint> {
  const buffer = await fs.promises.readFile(filePath);
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
    width,
    height,
    ext: path.extname(filePath).toLowerCase().replace(/^\./, ""),
  };
}

export async function loadAssetIndex(indexPath = ASSET_INDEX_PATH): Promise<AssetIndex> {
  if (!fs.existsSync(indexPath)) {
    return { version: 1, records: [] };
  }

  try {
    const raw = await fs.promises.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as AssetIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error("invalid index shape");
    }
    return parsed;
  } catch (error) {
    const backupPath = `${indexPath}.corrupted-${Date.now()}`;
    await fs.promises.copyFile(indexPath, backupPath);
    return { version: 1, records: [] };
  }
}

export async function saveAssetIndex(index: AssetIndex, indexPath = ASSET_INDEX_PATH): Promise<void> {
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export function upsertAssetFingerprint(
  index: AssetIndex,
  fingerprint: AssetFingerprint,
  sourceRelativePath: string,
  runId: string,
): { duplicateCandidateOf: string | null } {
  const key = fingerprintKey(fingerprint);
  const existing = index.records.find((record) => record.key === key);

  if (existing) {
    return {
      duplicateCandidateOf: existing.sourceRelativePath,
    };
  }

  index.records.push({
    key,
    fingerprint,
    sourceRelativePath,
    firstSeenAt: new Date().toISOString(),
    runId,
  });

  return { duplicateCandidateOf: null };
}
