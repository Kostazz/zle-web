import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ASSETS_VERSION_SIGNAL_PATH,
  DEFAULT_LIVE_PRODUCTS_ROOT,
  DEFAULT_REMIGRATION_BACKUPS_ROOT,
  DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT,
  DEFAULT_REMIGRATION_REPORTS_ROOT,
  DEFAULT_SWITCH_IN_PROGRESS_PATH,
  DEFAULT_SWITCH_LOCK_PATH,
  assertInsideAllowedRoot,
  assertNoSymlinkInPathChain,
  countDirectoryEntries,
  ensureDir,
  normalizeIdSegment,
  utcStamp,
} from "./lib/remigration-asset-roots.ts";

type CliArgs = {
  runId: string;
  backupId?: string;
  pipelineRunId?: string;
};

type SwitchFailureCode =
  | "missing_source_root"
  | "empty_source_root"
  | "missing_live_root"
  | "backup_exists"
  | "lock_active"
  | "switch_failed"
  | "rollback_failed"
  | "post_switch_sanity_failed"
  | "invalid_input";

type SwitchReport = {
  action: "switch_product_assets_root";
  runId: string;
  pipelineRunId: string;
  backupId: string;
  sourceRoot: string;
  liveRoot: string;
  backupRoot: string;
  createdAt: string;
  status: "success" | "failed";
  failureCode?: SwitchFailureCode;
  errorMessage?: string;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  staleLockRecovered: boolean;
};

type SwitchLock = {
  runId: string;
  backupId: string;
  createdAt: string;
  pid: number;
  hostname: string;
};

const SWITCH_LOCK_STALE_MS = 30 * 60 * 1000;

export class ProductAssetsSwitchError extends Error {
  failureCode: SwitchFailureCode;
  report: SwitchReport;

  constructor(message: string, failureCode: SwitchFailureCode, report: SwitchReport) {
    super(message);
    this.name = "ProductAssetsSwitchError";
    this.failureCode = failureCode;
    this.report = report;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { runId: "" };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        index++;
        break;
      case "--backup-id":
        args.backupId = next ?? "";
        index++;
        break;
      case "--pipeline-run-id":
        args.pipelineRunId = next ?? "";
        index++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.runId.trim()) throw new Error("Missing --run-id");
  return args;
}

function renderSummaryMarkdown(report: SwitchReport): string {
  return [
    "# Product Assets Root Switch Summary",
    "",
    `- Run ID: ${report.runId}`,
    `- Pipeline Run ID: ${report.pipelineRunId}`,
    `- Backup ID: ${report.backupId}`,
    `- Created At: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Failure Code: ${report.failureCode ?? "none"}`,
    `- Stale lock recovered: ${report.staleLockRecovered ? "yes" : "no"}`,
    "",
    "## Paths",
    `- Source clean-room root: ${report.sourceRoot}`,
    `- Live root: ${report.liveRoot}`,
    `- Backup root: ${report.backupRoot}`,
    "",
    "## Rollback",
    `- Attempted: ${report.rollbackAttempted ? "yes" : "no"}`,
    `- Succeeded: ${report.rollbackSucceeded ? "yes" : "no"}`,
    report.errorMessage ? `- Error: ${report.errorMessage}` : "- Error: none",
  ].join("\n") + "\n";
}

async function writeReports(report: SwitchReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const reportsRoot = await ensureDir(DEFAULT_REMIGRATION_REPORTS_ROOT, DEFAULT_REMIGRATION_REPORTS_ROOT);
  const prefix = `${utcStamp()}-${report.runId}-switch`;
  const jsonPath = path.join(reportsRoot, `${prefix}.json`);
  const markdownPath = path.join(reportsRoot, `${prefix}.md`);
  await fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(markdownPath, renderSummaryMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function parseSwitchLock(raw: string): SwitchLock | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SwitchLock>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.runId !== "string" || !parsed.runId) return null;
    if (typeof parsed.backupId !== "string" || !parsed.backupId) return null;
    if (typeof parsed.createdAt !== "string" || !parsed.createdAt) return null;
    if (typeof parsed.pid !== "number") return null;
    if (typeof parsed.hostname !== "string" || !parsed.hostname) return null;
    return parsed as SwitchLock;
  } catch {
    return null;
  }
}

async function acquireSwitchLock(lock: SwitchLock): Promise<{ release: () => Promise<void>; staleRecovered: boolean }> {
  await ensureDir(path.dirname(DEFAULT_SWITCH_LOCK_PATH), path.dirname(DEFAULT_SWITCH_LOCK_PATH));
  let staleRecovered = false;
  try {
    const handle = await fs.promises.open(DEFAULT_SWITCH_LOCK_PATH, "wx");
    await handle.writeFile(JSON.stringify(lock, null, 2), "utf8");
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;

    const existingRaw = await fs.promises.readFile(DEFAULT_SWITCH_LOCK_PATH, "utf8").catch(() => "");
    const existing = parseSwitchLock(existingRaw);
    if (!existing) {
      staleRecovered = true;
      console.warn("warning: malformed switch lock recovered");
      await fs.promises.writeFile(DEFAULT_SWITCH_LOCK_PATH, JSON.stringify(lock, null, 2), "utf8");
    } else {
      const ageMs = Date.now() - Date.parse(existing.createdAt);
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > SWITCH_LOCK_STALE_MS) {
        staleRecovered = true;
        console.warn(`warning: stale switch lock recovered (${ageMs}ms old)`);
        await fs.promises.writeFile(DEFAULT_SWITCH_LOCK_PATH, JSON.stringify(lock, null, 2), "utf8");
      } else {
        throw new Error(`Active switch lock present for run ${existing.runId} created at ${existing.createdAt}`);
      }
    }
  }

  return {
    staleRecovered,
    release: async () => {
      await fs.promises.rm(DEFAULT_SWITCH_LOCK_PATH, { force: true }).catch(() => undefined);
    },
  };
}

async function writeInProgressMarker(lock: SwitchLock): Promise<void> {
  await fs.promises.writeFile(DEFAULT_SWITCH_IN_PROGRESS_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function removeInProgressMarker(): Promise<void> {
  await fs.promises.rm(DEFAULT_SWITCH_IN_PROGRESS_PATH, { force: true }).catch(() => undefined);
}

async function assertSwitchReadiness(sourceRoot: string, liveRoot: string, backupRoot: string): Promise<void> {
  await ensureDir(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT);
  await ensureDir(DEFAULT_REMIGRATION_BACKUPS_ROOT, DEFAULT_REMIGRATION_BACKUPS_ROOT);

  await assertNoSymlinkInPathChain(sourceRoot, DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT);
  await assertNoSymlinkInPathChain(liveRoot, path.resolve("client"));
  await assertNoSymlinkInPathChain(backupRoot, DEFAULT_REMIGRATION_BACKUPS_ROOT);

  if (!fs.existsSync(sourceRoot)) throw new Error(`Missing clean-room source root: ${sourceRoot}`);
  if ((await countDirectoryEntries(sourceRoot)) < 1) throw new Error(`Clean-room source root is empty: ${sourceRoot}`);
  if (!fs.existsSync(liveRoot)) throw new Error(`Missing live root: ${liveRoot}`);
  if (fs.existsSync(backupRoot)) throw new Error(`Backup target already exists: ${backupRoot}`);
}

async function writeAssetsVersionSignal(pipelineRunId: string, cleanRoomRunId: string): Promise<void> {
  const signal = {
    mode: "v2-root-switch",
    runId: pipelineRunId,
    cleanRoomRunId,
    switchedAt: new Date().toISOString(),
  };
  await ensureDir(path.dirname(DEFAULT_ASSETS_VERSION_SIGNAL_PATH), path.resolve("client", "public"));
  await fs.promises.writeFile(DEFAULT_ASSETS_VERSION_SIGNAL_PATH, `${JSON.stringify(signal, null, 2)}\n`, "utf8");
}

export async function runSwitchProductAssetsRoot(input: CliArgs): Promise<{ report: SwitchReport; jsonPath?: string; markdownPath?: string }> {
  const runId = normalizeIdSegment(input.runId, "run id");
  const pipelineRunId = normalizeIdSegment(input.pipelineRunId?.trim() || runId, "pipeline run id");
  const backupId = normalizeIdSegment(input.backupId?.trim() || `${runId}-${utcStamp()}`, "backup id");
  const sourceRoot = assertInsideAllowedRoot(path.join(DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, runId, "products"), DEFAULT_REMIGRATION_LIVE_TARGETS_ROOT, "source root");
  const liveRoot = DEFAULT_LIVE_PRODUCTS_ROOT;
  const backupRoot = assertInsideAllowedRoot(path.join(DEFAULT_REMIGRATION_BACKUPS_ROOT, backupId), DEFAULT_REMIGRATION_BACKUPS_ROOT, "backup root");

  const report: SwitchReport = {
    action: "switch_product_assets_root",
    runId,
    pipelineRunId,
    backupId,
    sourceRoot,
    liveRoot,
    backupRoot,
    createdAt: new Date().toISOString(),
    status: "failed",
    rollbackAttempted: false,
    rollbackSucceeded: false,
    staleLockRecovered: false,
  };

  const lockData: SwitchLock = {
    runId,
    backupId,
    createdAt: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
  };

  const lock = await acquireSwitchLock(lockData).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    report.failureCode = "lock_active";
    report.errorMessage = message;
    throw new ProductAssetsSwitchError(message, "lock_active", report);
  });
  report.staleLockRecovered = lock.staleRecovered;

  try {
    try {
      await assertSwitchReadiness(sourceRoot, liveRoot, backupRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Missing clean-room source root")) report.failureCode = "missing_source_root";
      else if (message.includes("source root is empty")) report.failureCode = "empty_source_root";
      else if (message.includes("Missing live root")) report.failureCode = "missing_live_root";
      else if (message.includes("Backup target already exists")) report.failureCode = "backup_exists";
      else report.failureCode = "switch_failed";
      report.errorMessage = message;
      const artifacts = await writeReports(report);
      throw new ProductAssetsSwitchError(`${message}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`, report.failureCode, report);
    }

    await writeInProgressMarker(lockData);

    let movedLiveToBackup = false;
    let switchedLiveToNewRoot = false;
    let commitPointReached = false;
    try {
      await fs.promises.rename(liveRoot, backupRoot);
      movedLiveToBackup = true;
      await fs.promises.rename(sourceRoot, liveRoot);
      switchedLiveToNewRoot = true;

      const liveProductDirs = (await fs.promises.readdir(liveRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      if (liveProductDirs.length < 1) {
        report.failureCode = "post_switch_sanity_failed";
        throw new Error("Post-switch sanity failed: live root contains no product directories");
      }

      await writeAssetsVersionSignal(pipelineRunId, runId);
      commitPointReached = true;

      report.status = "success";
      report.failureCode = undefined;
      report.errorMessage = undefined;
      try {
        const artifacts = await writeReports(report);
        return { report, ...artifacts };
      } catch (reportWriteError) {
        console.error(`warning: switch commit succeeded but report write failed (${reportWriteError instanceof Error ? reportWriteError.message : String(reportWriteError)})`);
        return { report };
      }
    } catch (error) {
      if (commitPointReached) {
        report.status = "success";
        report.failureCode = undefined;
        report.errorMessage = undefined;
        return { report };
      }

      report.failureCode = report.failureCode ?? "switch_failed";
      report.errorMessage = error instanceof Error ? error.message : String(error);
      if (movedLiveToBackup && !commitPointReached) {
        report.rollbackAttempted = true;
        try {
          if (switchedLiveToNewRoot && fs.existsSync(liveRoot)) {
            await fs.promises.rm(liveRoot, { recursive: true, force: true });
          }
          if (fs.existsSync(backupRoot)) {
            await fs.promises.rename(backupRoot, liveRoot);
            report.rollbackSucceeded = true;
          }
        } catch (rollbackError) {
          report.rollbackSucceeded = false;
          report.failureCode = "rollback_failed";
          report.errorMessage = `Switch failed (${report.errorMessage}); rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`;
        }
      }
      try {
        const artifacts = await writeReports(report);
        throw new ProductAssetsSwitchError(`${report.errorMessage}\nreport ${artifacts.jsonPath}\nsummary ${artifacts.markdownPath}`, report.failureCode, report);
      } catch (reportWriteError) {
        throw new ProductAssetsSwitchError(
          `${report.errorMessage}\nwarning: failed to write switch failure report (${reportWriteError instanceof Error ? reportWriteError.message : String(reportWriteError)})`,
          report.failureCode,
          report,
        );
      }
    }
  } finally {
    await removeInProgressMarker();
    await lock.release();
  }
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const report: SwitchReport = {
      action: "switch_product_assets_root",
      runId: "invalid",
      pipelineRunId: "invalid",
      backupId: "invalid",
      sourceRoot: "n/a",
      liveRoot: DEFAULT_LIVE_PRODUCTS_ROOT,
      backupRoot: "n/a",
      createdAt: new Date().toISOString(),
      status: "failed",
      failureCode: "invalid_input",
      errorMessage: error instanceof Error ? error.message : String(error),
      rollbackAttempted: false,
      rollbackSucceeded: false,
      staleLockRecovered: false,
    };
    const artifacts = await writeReports(report);
    console.error(report.errorMessage);
    console.error(`report ${artifacts.jsonPath}`);
    console.error(`summary ${artifacts.markdownPath}`);
    process.exit(1);
    return;
  }

  try {
    const result = await runSwitchProductAssetsRoot(args);
    console.log(`status ${result.report.status}`);
    console.log(`run ${result.report.runId}`);
    console.log(`backup ${result.report.backupId}`);
    if (result.jsonPath) console.log(`report ${result.jsonPath}`);
    if (result.markdownPath) console.log(`summary ${result.markdownPath}`);
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
