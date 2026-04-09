import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  DEFAULT_REMIGRATION_REPORTS_ROOT,
  MANAGED_ASSET_FILE_RE,
  assertInsideAllowedRoot,
  assertNoSymlinkInPathChain,
  ensureDir,
  normalizeIdSegment,
  utcStamp,
} from "./lib/remigration-asset-roots.ts";

type VerifyVersionReport = {
  action: "verify_product_assets_version_root";
  versionId: string;
  createdAt: string;
  versionRoot: string;
  status: "pass" | "fail";
  productDirCount: number;
  managedFilesCount: number;
  missingCoverProducts: string[];
  failureCode?: "missing_root" | "no_product_dirs" | "missing_cover";
  errorMessage?: string;
};

function parseArgs(argv: string[]): { versionId: string } {
  let versionId = "";
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--version-id") {
      versionId = next ?? "";
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!versionId.trim()) throw new Error("Missing --version-id");
  return { versionId: normalizeIdSegment(versionId, "version id") };
}

async function writeReports(report: VerifyVersionReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const reportsRoot = await ensureDir(DEFAULT_REMIGRATION_REPORTS_ROOT, DEFAULT_REMIGRATION_REPORTS_ROOT);
  const prefix = `${utcStamp()}-${report.versionId}-verify-version`;
  const jsonPath = path.join(reportsRoot, `${prefix}.json`);
  const markdownPath = path.join(reportsRoot, `${prefix}.md`);
  await fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(markdownPath, `# Verify Version Root\n\n- Version: ${report.versionId}\n- Status: ${report.status}\n- Failure: ${report.failureCode ?? "none"}\n`, "utf8");
  return { jsonPath, markdownPath };
}

export async function runVerifyProductAssetsVersionRoot(versionIdRaw: string): Promise<{ report: VerifyVersionReport; jsonPath: string; markdownPath: string }> {
  const versionId = normalizeIdSegment(versionIdRaw, "version id");
  const versionRoot = assertInsideAllowedRoot(path.join(DEFAULT_PRODUCT_VERSIONS_ROOT, versionId), DEFAULT_PRODUCT_VERSIONS_ROOT, "version root");
  await assertNoSymlinkInPathChain(versionRoot, DEFAULT_PRODUCT_VERSIONS_ROOT);

  const report: VerifyVersionReport = {
    action: "verify_product_assets_version_root",
    versionId,
    createdAt: new Date().toISOString(),
    versionRoot,
    status: "fail",
    productDirCount: 0,
    managedFilesCount: 0,
    missingCoverProducts: [],
  };

  if (!fs.existsSync(versionRoot)) {
    report.failureCode = "missing_root";
    report.errorMessage = `Missing version root: ${versionRoot}`;
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}`);
  }

  const productDirs = (await fs.promises.readdir(versionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  report.productDirCount = productDirs.length;
  if (productDirs.length < 1) {
    report.failureCode = "no_product_dirs";
    report.errorMessage = "Version root has no product directories";
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}`);
  }

  for (const productDirName of productDirs) {
    const files = (await fs.promises.readdir(path.join(versionRoot, productDirName), { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    report.managedFilesCount += files.filter((entry) => MANAGED_ASSET_FILE_RE.test(entry)).length;
    if (!files.includes("cover.jpg") && !files.includes("cover.webp")) report.missingCoverProducts.push(productDirName);
  }

  if (report.missingCoverProducts.length > 0) {
    report.failureCode = "missing_cover";
    report.errorMessage = `Missing covers for ${report.missingCoverProducts.length} products`;
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}`);
  }

  report.status = "pass";
  const artifacts = await writeReports(report);
  return { report, ...artifacts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runVerifyProductAssetsVersionRoot(args.versionId);
    console.log(`status ${result.report.status}`);
    console.log(`report ${result.jsonPath}`);
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
