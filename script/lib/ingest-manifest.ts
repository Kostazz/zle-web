import fs from "node:fs";
import path from "node:path";

export type IngestSourceType = "local" | "drive" | "manual";
export type ApprovalState = "pending" | "approved" | "rejected";
export type PublishState = "staged" | "published" | "failed";

export type ProductDraftPayload = {
  productId: string | null;
  title?: string;
  description?: string;
  category?: string;
  sizes?: string[];
  priceCzk?: number;
  sourceUrl?: string;
  notes?: string;
};

export type AssetManifest = {
  assetId: string;
  runId: string;
  sourceType: IngestSourceType;
  sourceRelativePath: string;
  productId: string | null;
  matchedConfidence: number;
  requiresReview: boolean;
  approvalState: ApprovalState;
  publishState: PublishState;
  outputs: string[];
  errors: string[];
  detectedMetadata?: Record<string, string | number | boolean | null | undefined>;
  duplicateCandidateOf?: string;
  productDraft?: ProductDraftPayload;
};

export type RunManifest = {
  runId: string;
  sourceType: IngestSourceType;
  createdAt: string;
  updatedAt: string;
  approvalState: ApprovalState;
  publishState: PublishState;
  requiresReview: boolean;
  inputDir: string;
  outputDir: string;
  reportPath: string;
  assets: AssetManifest[];
  errors: string[];
};

export function createRunId(prefix = "run"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

export async function writeRunManifest(manifestDir: string, manifest: RunManifest): Promise<string> {
  await fs.promises.mkdir(manifestDir, { recursive: true });
  const targetPath = path.join(manifestDir, `${manifest.runId}.run.json`);
  await fs.promises.writeFile(targetPath, JSON.stringify(manifest, null, 2), "utf8");
  return targetPath;
}

export async function readRunManifest(manifestDir: string, runId: string): Promise<RunManifest | null> {
  const targetPath = path.join(manifestDir, `${runId}.run.json`);
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  const raw = await fs.promises.readFile(targetPath, "utf8");
  return JSON.parse(raw) as RunManifest;
}

export async function listRunManifests(manifestDir: string): Promise<RunManifest[]> {
  if (!fs.existsSync(manifestDir)) {
    return [];
  }

  const files = (await fs.promises.readdir(manifestDir))
    .filter((name) => name.endsWith(".run.json"))
    .sort((a, b) => b.localeCompare(a));

  const manifests: RunManifest[] = [];
  for (const fileName of files) {
    const raw = await fs.promises.readFile(path.join(manifestDir, fileName), "utf8");
    manifests.push(JSON.parse(raw) as RunManifest);
  }

  return manifests;
}
