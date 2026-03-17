import fs from "node:fs";
import path from "node:path";
import { listRunManifests, readRunManifest, writeRunManifest, type ApprovalState, type RunManifest } from "../../script/lib/ingest-manifest.ts";

const MANIFEST_DIR = path.join(process.cwd(), "tmp", "agent-manifests");

function createError(code: string, message: string, status = 400) {
  return { ok: false as const, error: { code, message, status } };
}

export async function listCatalogIngestRuns() {
  const runs = await listRunManifests(MANIFEST_DIR);
  return { ok: true as const, runs };
}

export async function getCatalogIngestRun(runId: string) {
  if (!runId.trim()) {
    return createError("invalid_run_id", "runId is required");
  }

  const run = await readRunManifest(MANIFEST_DIR, runId);
  if (!run) {
    return createError("run_not_found", `Run ${runId} was not found`, 404);
  }

  return { ok: true as const, run };
}

export async function setCatalogRunApproval(runId: string, approvalState: ApprovalState) {
  const existing = await getCatalogIngestRun(runId);
  if (!existing.ok) {
    return existing;
  }

  const run: RunManifest = {
    ...existing.run,
    approvalState,
    updatedAt: new Date().toISOString(),
    assets: existing.run.assets.map((asset) => ({
      ...asset,
      approvalState,
      requiresReview: approvalState !== "approved",
    })),
  };

  await writeRunManifest(MANIFEST_DIR, run);
  return { ok: true as const, run };
}

export async function markCatalogRunPublishState(runId: string, publishState: RunManifest["publishState"], errors: string[] = []) {
  const existing = await getCatalogIngestRun(runId);
  if (!existing.ok) {
    return existing;
  }

  const run: RunManifest = {
    ...existing.run,
    publishState,
    updatedAt: new Date().toISOString(),
    errors,
    assets: existing.run.assets.map((asset) => ({
      ...asset,
      publishState,
      errors,
    })),
  };

  await writeRunManifest(MANIFEST_DIR, run);
  return { ok: true as const, run };
}

export function getRunOutputPath(run: RunManifest): string {
  const absolute = path.resolve(process.cwd(), run.outputDir);
  if (!fs.existsSync(absolute)) {
    throw new Error(`staging_output_missing:${run.outputDir}`);
  }
  return absolute;
}
