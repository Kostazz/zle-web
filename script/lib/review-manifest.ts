import fs from "node:fs";
import path from "node:path";
import type { ReviewDecisionManifest } from "./curation-types.ts";

export async function writeReviewDecisionManifest(outputDir: string, manifest: ReviewDecisionManifest): Promise<string> {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const targetPath = path.join(outputDir, `${manifest.runId}.review-decisions.json`);
  await fs.promises.writeFile(targetPath, JSON.stringify(manifest, null, 2), "utf8");
  return targetPath;
}

export async function readReviewDecisionManifest(outputDir: string, runId: string): Promise<ReviewDecisionManifest | null> {
  const targetPath = path.join(outputDir, `${runId}.review-decisions.json`);
  if (!fs.existsSync(targetPath)) return null;

  const raw = await fs.promises.readFile(targetPath, "utf8");
  try {
    return JSON.parse(raw) as ReviewDecisionManifest;
  } catch (error) {
    throw new Error(`Invalid review decision manifest JSON: ${targetPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}
