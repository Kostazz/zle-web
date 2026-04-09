import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { cleanupRemigrationArtifacts } from "./lib/remigration-retention.ts";
import { DEFAULT_REMIGRATION_RUNS_ROOT, ensureDir, normalizeIdSegment } from "./lib/remigration-asset-roots.ts";
import { runSwitchProductAssetsRoot } from "./switch-product-assets-root.ts";

type Step = "validate-publish" | "publish-clean-room" | "switch-live-root" | "post-switch-verify" | "full";

type CliArgs = {
  runId: string;
  cleanRoomRunId: string;
  backupId?: string;
  step: Step;
};

type RunState = {
  runId: string;
  cleanRoomRunId: string;
  backupId: string | null;
  mode: "v2-root-switch";
  steps: {
    validatePublish: "pending" | "done";
    publishCleanRoom: "pending" | "done";
    verifyCleanRoom: "pending" | "done";
    switchLiveRoot: "pending" | "done";
    verifyLiveRoot: "pending" | "done";
  };
  lastUpdatedAt: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    cleanRoomRunId: "",
    step: "full",
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        index++;
        break;
      case "--clean-room-run-id":
        args.cleanRoomRunId = next ?? "";
        index++;
        break;
      case "--backup-id":
        args.backupId = next ?? "";
        index++;
        break;
      case "--step":
        if (!next) throw new Error("Missing --step value");
        if (!["validate-publish", "publish-clean-room", "switch-live-root", "post-switch-verify", "full"].includes(next)) {
          throw new Error(`Unsupported --step value: ${next}`);
        }
        args.step = next as Step;
        index++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId.trim()) throw new Error("Missing --run-id");
  if (!args.cleanRoomRunId.trim()) throw new Error("Missing --clean-room-run-id");
  args.runId = normalizeIdSegment(args.runId, "run id");
  args.cleanRoomRunId = normalizeIdSegment(args.cleanRoomRunId, "clean-room run id");
  if (args.backupId?.trim()) args.backupId = normalizeIdSegment(args.backupId, "backup id");
  return args;
}

function statePathForRun(runId: string): string {
  return path.join(DEFAULT_REMIGRATION_RUNS_ROOT, `${runId}.state.json`);
}

function runLockPathForRun(runId: string): string {
  return path.join(DEFAULT_REMIGRATION_RUNS_ROOT, `${runId}.lock`);
}

function createInitialState(args: CliArgs): RunState {
  return {
    runId: args.runId,
    cleanRoomRunId: args.cleanRoomRunId,
    backupId: args.backupId ?? null,
    mode: "v2-root-switch",
    steps: {
      validatePublish: "pending",
      publishCleanRoom: "pending",
      verifyCleanRoom: "pending",
      switchLiveRoot: "pending",
      verifyLiveRoot: "pending",
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function readState(args: CliArgs): Promise<RunState> {
  await ensureDir(DEFAULT_REMIGRATION_RUNS_ROOT, path.resolve("tmp", "remigration"));
  const targetPath = statePathForRun(args.runId);
  if (!fs.existsSync(targetPath)) return createInitialState(args);
  const raw = JSON.parse(await fs.promises.readFile(targetPath, "utf8")) as RunState;
  if (raw.runId !== args.runId || raw.cleanRoomRunId !== args.cleanRoomRunId) {
    throw new Error(`Run state mismatch for ${args.runId}; refusing resume`);
  }
  return raw;
}

async function writeState(state: RunState): Promise<void> {
  state.lastUpdatedAt = new Date().toISOString();
  await fs.promises.writeFile(statePathForRun(state.runId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function runCommand(label: string, args: string[]): void {
  console.log(`step ${label}`);
  console.log(`cmd ${args.join(" ")}`);
  const result = spawnSync(args[0] ?? "", args.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Step failed: ${label} (exit ${result.status ?? "unknown"})`);
  }
}

async function executeStep(
  state: RunState,
  key: keyof RunState["steps"],
  label: string,
  commandFactory: () => string[],
  commandRunner: (label: string, args: string[]) => void,
): Promise<void> {
  if (state.steps[key] === "done") {
    console.log(`step ${label} SKIP (already done)`);
    return;
  }
  commandRunner(label, commandFactory());
  state.steps[key] = "done";
  await writeState(state);
}

async function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = runLockPathForRun(runId);
  const handle = await fs.promises.open(lockPath, "wx").catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new Error(`Concurrent run blocked for ${runId}`);
    }
    throw error;
  });
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function runRemigrationOrchestration(
  args: CliArgs,
  dependencies?: {
    commandRunner?: (label: string, args: string[]) => void;
    switchRunner?: typeof runSwitchProductAssetsRoot;
    retentionRunner?: typeof cleanupRemigrationArtifacts;
  },
): Promise<void> {
  const commandRunner = dependencies?.commandRunner ?? runCommand;
  const switchRunner = dependencies?.switchRunner ?? runSwitchProductAssetsRoot;
  const retentionRunner = dependencies?.retentionRunner ?? cleanupRemigrationArtifacts;
  const state = await readState(args);
  const hasPartial = Object.values(state.steps).some((value) => value === "done")
    && Object.values(state.steps).some((value) => value !== "done");
  if (hasPartial) {
    console.log("Detected partial run – resuming from last incomplete step");
  }

  await executeStep(state, "validatePublish", "validate-publish", () => ["npx", "tsx", "script/publish-totalboardshop-reviewed.ts", "--run-id", args.runId, "--validate-only"], commandRunner);
  await executeStep(state, "publishCleanRoom", "publish-clean-room", () => ["npx", "tsx", "script/publish-totalboardshop-reviewed.ts", "--run-id", args.runId, "--clean-room-run-id", args.cleanRoomRunId], commandRunner);
  await executeStep(state, "verifyCleanRoom", "verify-clean-room", () => ["npx", "tsx", "script/verify-clean-room-product-assets-root.ts", "--run-id", args.cleanRoomRunId], commandRunner);
  if (state.steps.switchLiveRoot === "done") {
    console.log("step switch-live-root SKIP (already done)");
  } else {
    const switched = await switchRunner({
      runId: args.cleanRoomRunId,
      backupId: args.backupId,
      pipelineRunId: args.runId,
    });
    state.steps.switchLiveRoot = "done";
    state.backupId = switched.report.backupId;
    await writeState(state);
  }
  await executeStep(state, "verifyLiveRoot", "post-switch-verify", () => ["npx", "tsx", "script/verify-product-assets-root.ts", "--run-label", args.runId], commandRunner);

  await retentionRunner({
    preserveRunIds: [args.runId, args.cleanRoomRunId],
    preserveBackupIds: state.backupId ? [state.backupId] : [],
    logger: console,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await withRunLock(args.runId, async () => {
    if (args.step !== "full") {
      // explicit step mode bypasses resume state transitions by design
      if (args.step === "validate-publish") {
      runCommand("validate-publish", ["npx", "tsx", "script/publish-totalboardshop-reviewed.ts", "--run-id", args.runId, "--validate-only"]);
        return;
      }
      if (args.step === "publish-clean-room") {
        runCommand("publish-clean-room", ["npx", "tsx", "script/publish-totalboardshop-reviewed.ts", "--run-id", args.runId, "--clean-room-run-id", args.cleanRoomRunId]);
        runCommand("verify-clean-room", ["npx", "tsx", "script/verify-clean-room-product-assets-root.ts", "--run-id", args.cleanRoomRunId]);
        return;
      }
      if (args.step === "switch-live-root") {
        const cmd = ["npx", "tsx", "script/switch-product-assets-root.ts", "--run-id", args.cleanRoomRunId, "--pipeline-run-id", args.runId];
        if (args.backupId) cmd.push("--backup-id", args.backupId);
        runCommand("switch-live-root", cmd);
        return;
      }
      runCommand("post-switch-verify", ["npx", "tsx", "script/verify-product-assets-root.ts", "--run-label", args.runId]);
      return;
    }

    await runRemigrationOrchestration(args);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
