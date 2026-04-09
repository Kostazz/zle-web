import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ASSETS_VERSION_SIGNAL_PATH,
  DEFAULT_FALLBACK_PRODUCTS_ROOT,
  DEFAULT_LIVE_PRODUCTS_ROOT,
  DEFAULT_REMIGRATION_REPORTS_ROOT,
  MANAGED_ASSET_FILE_RE,
  assertNoSymlinkInPathChain,
  ensureDir,
  listDirectoryEntriesSafe,
  utcStamp,
} from "./lib/remigration-asset-roots.ts";

type AssetsVersionSignal = {
  mode: "v2-root-switch";
  runId: string;
  cleanRoomRunId: string;
  switchedAt: string;
};

type VerifyReport = {
  action: "verify_product_assets_root";
  createdAt: string;
  liveRoot: string;
  fallbackRoot: string;
  fallbackEntryCount: number;
  allowNonEmptyFallback: boolean;
  assetsVersionSignalPath: string;
  assetsVersionSignal?: AssetsVersionSignal;
  status: "pass" | "fail";
  productDirCount: number;
  managedFilesCount: number;
  missingCoverProducts: string[];
  failureCode?:
    | "missing_live_root"
    | "no_product_dirs"
    | "missing_cover"
    | "fallback_non_empty"
    | "missing_assets_version_signal"
    | "malformed_assets_version_signal";
  errorMessage?: string;
};

function parseArgs(argv: string[]): { runLabel: string; allowNonEmptyFallback: boolean } {
  let runLabel = "live";
  let allowNonEmptyFallback = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--run-label") {
      runLabel = next ?? "live";
      index++;
      continue;
    }
    if (token === "--allow-non-empty-fallback") {
      allowNonEmptyFallback = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return { runLabel: runLabel.trim() || "live", allowNonEmptyFallback };
}

function renderSummaryMarkdown(report: VerifyReport): string {
  return [
    "# Product Assets Root Verify Summary",
    "",
    `- Created At: ${report.createdAt}`,
    `- Live Root: ${report.liveRoot}`,
    `- Fallback Root: ${report.fallbackRoot}`,
    `- Fallback entries: ${report.fallbackEntryCount}`,
    `- Allow non-empty fallback: ${report.allowNonEmptyFallback ? "yes" : "no"}`,
    `- Assets version signal: ${report.assetsVersionSignalPath}`,
    `- Status: ${report.status}`,
    `- Failure Code: ${report.failureCode ?? "none"}`,
    `- Product directories: ${report.productDirCount}`,
    `- Managed files: ${report.managedFilesCount}`,
    `- Missing cover count: ${report.missingCoverProducts.length}`,
    report.errorMessage ? `- Error: ${report.errorMessage}` : "- Error: none",
    report.assetsVersionSignal
      ? `- Signal run: ${report.assetsVersionSignal.runId} / clean-room: ${report.assetsVersionSignal.cleanRoomRunId}`
      : "- Signal run: n/a",
    "",
    "## Missing cover products",
    ...(report.missingCoverProducts.length > 0 ? report.missingCoverProducts.map((entry) => `- ${entry}`) : ["- none"]),
  ].join("\n") + "\n";
}

async function writeReports(runLabel: string, report: VerifyReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const reportsRoot = await ensureDir(DEFAULT_REMIGRATION_REPORTS_ROOT, DEFAULT_REMIGRATION_REPORTS_ROOT);
  const prefix = `${utcStamp()}-${runLabel}-verify`;
  const jsonPath = path.join(reportsRoot, `${prefix}.json`);
  const markdownPath = path.join(reportsRoot, `${prefix}.md`);
  await fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(markdownPath, renderSummaryMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function parseAssetsVersionSignal(raw: string): AssetsVersionSignal {
  const parsed = JSON.parse(raw) as Partial<AssetsVersionSignal>;
  if (!parsed || typeof parsed !== "object") throw new Error("signal is not JSON object");
  if (parsed.mode !== "v2-root-switch") throw new Error(`unsupported signal mode: ${String(parsed.mode)}`);
  if (typeof parsed.runId !== "string" || !parsed.runId) throw new Error("signal runId missing");
  if (typeof parsed.cleanRoomRunId !== "string" || !parsed.cleanRoomRunId) throw new Error("signal cleanRoomRunId missing");
  if (typeof parsed.switchedAt !== "string" || !parsed.switchedAt) throw new Error("signal switchedAt missing");
  const parsedAt = Date.parse(parsed.switchedAt);
  if (!Number.isFinite(parsedAt)) throw new Error("signal switchedAt invalid");
  return parsed as AssetsVersionSignal;
}

export async function runVerifyProductAssetsRoot(
  runLabel = "live",
  options: { allowNonEmptyFallback?: boolean } = {},
): Promise<{ report: VerifyReport; jsonPath: string; markdownPath: string }> {
  const liveRoot = DEFAULT_LIVE_PRODUCTS_ROOT;
  const fallbackRoot = DEFAULT_FALLBACK_PRODUCTS_ROOT;
  await assertNoSymlinkInPathChain(liveRoot, path.resolve("client"));
  await assertNoSymlinkInPathChain(fallbackRoot, path.resolve("public"));

  const report: VerifyReport = {
    action: "verify_product_assets_root",
    createdAt: new Date().toISOString(),
    liveRoot,
    fallbackRoot,
    fallbackEntryCount: 0,
    allowNonEmptyFallback: options.allowNonEmptyFallback === true,
    assetsVersionSignalPath: DEFAULT_ASSETS_VERSION_SIGNAL_PATH,
    status: "fail",
    productDirCount: 0,
    managedFilesCount: 0,
    missingCoverProducts: [],
  };

  if (!fs.existsSync(liveRoot)) {
    report.failureCode = "missing_live_root";
    report.errorMessage = `Missing live root: ${liveRoot}`;
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  report.fallbackEntryCount = (await listDirectoryEntriesSafe(fallbackRoot)).length;
  if (report.fallbackEntryCount > 0 && !report.allowNonEmptyFallback) {
    report.failureCode = "fallback_non_empty";
    report.errorMessage = "Fallback root is not empty – potential ghost assets";
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  if (!fs.existsSync(DEFAULT_ASSETS_VERSION_SIGNAL_PATH)) {
    report.failureCode = "missing_assets_version_signal";
    report.errorMessage = `Missing runtime signal file: ${DEFAULT_ASSETS_VERSION_SIGNAL_PATH}`;
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  try {
    report.assetsVersionSignal = parseAssetsVersionSignal(await fs.promises.readFile(DEFAULT_ASSETS_VERSION_SIGNAL_PATH, "utf8"));
  } catch (error) {
    report.failureCode = "malformed_assets_version_signal";
    report.errorMessage = `Malformed runtime signal file: ${error instanceof Error ? error.message : String(error)}`;
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  const productDirs = (await fs.promises.readdir(liveRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  report.productDirCount = productDirs.length;
  if (productDirs.length < 1) {
    report.failureCode = "no_product_dirs";
    report.errorMessage = "Live root has no product directories";
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  for (const productDirName of productDirs) {
    const productDir = path.join(liveRoot, productDirName);
    await assertNoSymlinkInPathChain(productDir, liveRoot);
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
    const artifacts = await writeReports(runLabel, report);
    throw new Error(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`);
  }

  report.status = "pass";
  const artifacts = await writeReports(runLabel, report);
  return { report, ...artifacts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runVerifyProductAssetsRoot(args.runLabel, { allowNonEmptyFallback: args.allowNonEmptyFallback });
    console.log(`status ${result.report.status}`);
    console.log(`products ${result.report.productDirCount}`);
    console.log(`managed_files ${result.report.managedFilesCount}`);
    console.log(`fallback_entries ${result.report.fallbackEntryCount}`);
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
