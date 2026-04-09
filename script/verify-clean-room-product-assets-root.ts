import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT,
  DEFAULT_REMIGRATION_REPORTS_ROOT,
  MANAGED_ASSET_FILE_RE,
  assertInsideAllowedRoot,
  assertNoSymlinkInPathChain,
  ensureDir,
  normalizeIdSegment,
  utcStamp,
} from "./lib/remigration-asset-roots.ts";

type VerifyCleanRoomReport = {
  action: "verify_clean_room_product_assets_root";
  createdAt: string;
  runId: string;
  cleanRoomRoot: string;
  status: "pass" | "fail";
  productDirCount: number;
  managedFilesCount: number;
  missingCoverProducts: string[];
  failureCode?: "missing_root" | "no_product_dirs" | "missing_cover";
  errorMessage?: string;
};

function parseArgs(argv: string[]): { runId: string } {
  let runId = "";
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--run-id") {
      runId = next ?? "";
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!runId.trim()) throw new Error("Missing --run-id");
  return { runId: normalizeIdSegment(runId, "run id") };
}

function renderSummaryMarkdown(report: VerifyCleanRoomReport): string {
  return [
    "# Clean-room Product Assets Verify Summary",
    "",
    `- Created At: ${report.createdAt}`,
    `- Run ID: ${report.runId}`,
    `- Root: ${report.cleanRoomRoot}`,
    `- Status: ${report.status}`,
    `- Failure Code: ${report.failureCode ?? "none"}`,
    `- Product directories: ${report.productDirCount}`,
    `- Managed files: ${report.managedFilesCount}`,
    `- Missing cover count: ${report.missingCoverProducts.length}`,
    report.errorMessage ? `- Error: ${report.errorMessage}` : "- Error: none",
  ].join("\n") + "\n";
}

async function writeReports(report: VerifyCleanRoomReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const reportsRoot = await ensureDir(DEFAULT_REMIGRATION_REPORTS_ROOT, DEFAULT_REMIGRATION_REPORTS_ROOT);
  const prefix = `${utcStamp()}-${report.runId}-verify-clean-room`;
  const jsonPath = path.join(reportsRoot, `${prefix}.json`);
  const markdownPath = path.join(reportsRoot, `${prefix}.md`);
  await fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(markdownPath, renderSummaryMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

export async function runVerifyCleanRoomProductAssetsRoot(runIdRaw: string): Promise<{ report: VerifyCleanRoomReport; jsonPath: string; markdownPath: string }> {
  const runId = normalizeIdSegment(runIdRaw, "run id");
  const cleanRoomRoot = assertInsideAllowedRoot(path.join(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, runId, "products"), DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, "clean-room root");
  await assertNoSymlinkInPathChain(cleanRoomRoot, DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT);

  const report: VerifyCleanRoomReport = {
    action: "verify_clean_room_product_assets_root",
    createdAt: new Date().toISOString(),
    runId,
    cleanRoomRoot,
    status: "fail",
    productDirCount: 0,
    managedFilesCount: 0,
    missingCoverProducts: [],
  };

  if (!fs.existsSync(cleanRoomRoot)) {
    report.failureCode = "missing_root";
    report.errorMessage = `Missing clean-room root: ${cleanRoomRoot}`;
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  const productDirs = (await fs.promises.readdir(cleanRoomRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  report.productDirCount = productDirs.length;
  if (productDirs.length < 1) {
    report.failureCode = "no_product_dirs";
    report.errorMessage = "Clean-room root has no product directories";
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  for (const productDirName of productDirs) {
    const productDir = path.join(cleanRoomRoot, productDirName);
    await assertNoSymlinkInPathChain(productDir, cleanRoomRoot);
    const files = (await fs.promises.readdir(productDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    report.managedFilesCount += files.filter((fileName) => MANAGED_ASSET_FILE_RE.test(fileName)).length;
    if (!files.includes("cover.jpg") && !files.includes("cover.webp")) {
      report.missingCoverProducts.push(productDirName);
    }
  }

  if (report.missingCoverProducts.length > 0) {
    report.failureCode = "missing_cover";
    report.errorMessage = `Missing required cover image for ${report.missingCoverProducts.length} product(s)`;
    const artifacts = await writeReports(report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  report.status = "pass";
  const artifacts = await writeReports(report);
  return { report, ...artifacts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runVerifyCleanRoomProductAssetsRoot(args.runId);
    console.log(`status ${result.report.status}`);
    console.log(`products ${result.report.productDirCount}`);
    console.log(`managed_files ${result.report.managedFilesCount}`);
    console.log(`report ${result.jsonPath}`);
    console.log(`summary ${result.markdownPath}`);
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
