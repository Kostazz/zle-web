import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH,
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  assertInsideAllowedRoot,
  ensureDir,
  normalizeIdSegment,
  DEFAULT_REMIGRATION_REPORTS_ROOT,
  utcStamp,
} from "./lib/remigration-asset-roots.ts";
import { runVerifyProductAssetsVersionRoot } from "./verify-product-assets-version-root.ts";

type ActivePointer = {
  mode: "v3-versioned-assets";
  versionId: string;
  sourceRunId: string;
  activatedAt: string;
};

type VerifyActiveReport = {
  action: "verify_active_product_assets";
  createdAt: string;
  pointerPath: string;
  status: "pass" | "fail";
  pointer?: ActivePointer;
  failureCode?: "missing_pointer" | "malformed_pointer" | "missing_version_root" | "empty_version_root" | "version_integrity_failed";
  errorMessage?: string;
};

function parsePointer(raw: string): ActivePointer {
  const parsed = JSON.parse(raw) as Partial<ActivePointer>;
  if (!parsed || typeof parsed !== "object") throw new Error("pointer is not object");
  if (parsed.mode !== "v3-versioned-assets") throw new Error(`unsupported pointer mode: ${String(parsed.mode)}`);
  if (typeof parsed.versionId !== "string" || !parsed.versionId) throw new Error("versionId missing");
  if (typeof parsed.sourceRunId !== "string" || !parsed.sourceRunId) throw new Error("sourceRunId missing");
  if (typeof parsed.activatedAt !== "string" || !parsed.activatedAt) throw new Error("activatedAt missing");
  normalizeIdSegment(parsed.versionId, "version id");
  return parsed as ActivePointer;
}

async function writeReport(report: VerifyActiveReport): Promise<string> {
  const reportsRoot = await ensureDir(DEFAULT_REMIGRATION_REPORTS_ROOT, DEFAULT_REMIGRATION_REPORTS_ROOT);
  const targetPath = path.join(reportsRoot, `${utcStamp()}-verify-active-assets.json`);
  await fs.promises.writeFile(targetPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return targetPath;
}

export async function runVerifyActiveProductAssets(): Promise<{ report: VerifyActiveReport; reportPath: string }> {
  const report: VerifyActiveReport = {
    action: "verify_active_product_assets",
    createdAt: new Date().toISOString(),
    pointerPath: DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH,
    status: "fail",
  };

  if (!fs.existsSync(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH)) {
    report.failureCode = "missing_pointer";
    report.errorMessage = `Missing pointer file: ${DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH}`;
    const reportPath = await writeReport(report);
    throw new Error(`${report.errorMessage}\nreport ${reportPath}`);
  }

  try {
    report.pointer = parsePointer(await fs.promises.readFile(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH, "utf8"));
  } catch (error) {
    report.failureCode = "malformed_pointer";
    report.errorMessage = `Malformed pointer file: ${error instanceof Error ? error.message : String(error)}`;
    const reportPath = await writeReport(report);
    throw new Error(`${report.errorMessage}\nreport ${reportPath}`);
  }

  const versionRoot = assertInsideAllowedRoot(path.join(DEFAULT_PRODUCT_VERSIONS_ROOT, report.pointer.versionId), DEFAULT_PRODUCT_VERSIONS_ROOT, "version root");
  if (!fs.existsSync(versionRoot)) {
    report.failureCode = "missing_version_root";
    report.errorMessage = `Missing version root: ${versionRoot}`;
    const reportPath = await writeReport(report);
    throw new Error(`${report.errorMessage}\nreport ${reportPath}`);
  }

  const entries = await fs.promises.readdir(versionRoot);
  if (entries.length < 1) {
    report.failureCode = "empty_version_root";
    report.errorMessage = `Version root is empty: ${versionRoot}`;
    const reportPath = await writeReport(report);
    throw new Error(`${report.errorMessage}\nreport ${reportPath}`);
  }

  try {
    await runVerifyProductAssetsVersionRoot(report.pointer.versionId);
  } catch (error) {
    report.failureCode = "version_integrity_failed";
    report.errorMessage = `Version integrity check failed: ${error instanceof Error ? error.message : String(error)}`;
    const reportPath = await writeReport(report);
    throw new Error(`${report.errorMessage}\nreport ${reportPath}`);
  }

  report.status = "pass";
  const reportPath = await writeReport(report);
  return { report, reportPath };
}

async function main(): Promise<void> {
  try {
    const result = await runVerifyActiveProductAssets();
    console.log(`status ${result.report.status}`);
    console.log(`report ${result.reportPath}`);
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
