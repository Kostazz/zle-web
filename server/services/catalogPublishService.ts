import fs from "node:fs";
import path from "node:path";
import { getCatalogIngestRun, markCatalogRunPublishState } from "./catalogIngestService.ts";

const FINAL_ASSET_DIR = path.join(process.cwd(), "client", "public", "images", "products");

function error(code: string, message: string, status = 400) {
  return { ok: false as const, error: { code, message, status } };
}

export async function publishCatalogRun(runId: string) {
  const fetched = await getCatalogIngestRun(runId);
  if (!fetched.ok) {
    return fetched;
  }

  const run = fetched.run;
  if (run.approvalState !== "approved") {
    return error("approval_required", "Run must be approved before publish", 409);
  }

  if (!run.outputDir) {
    return error("invalid_manifest", "Missing outputDir in run manifest");
  }

  const sourceDir = path.resolve(process.cwd(), run.outputDir);
  if (!fs.existsSync(sourceDir)) {
    await markCatalogRunPublishState(runId, "failed", ["staging_output_missing"]);
    return error("staging_output_missing", `Staging directory not found: ${run.outputDir}`, 404);
  }

  await fs.promises.mkdir(FINAL_ASSET_DIR, { recursive: true });
  await fs.promises.cp(sourceDir, FINAL_ASSET_DIR, { recursive: true, force: true });

  await markCatalogRunPublishState(runId, "published");
  return { ok: true as const, runId, publishState: "published" as const };
}
