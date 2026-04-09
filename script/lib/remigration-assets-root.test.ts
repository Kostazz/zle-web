import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runSwitchProductAssetsRoot } from "../switch-product-assets-root.ts";
import { runVerifyProductAssetsRoot } from "../verify-product-assets-root.ts";
import { cleanupRemigrationArtifacts } from "./remigration-retention.ts";
import { runRemigrationOrchestration } from "../remigrate-totalboardshop-clean-room.ts";
import { runPromoteCleanRoomToProductVersion } from "../promote-clean-room-to-product-version.ts";
import { runVerifyProductAssetsVersionRoot } from "../verify-product-assets-version-root.ts";
import { runActivateProductAssetsVersion } from "../activate-product-assets-version.ts";
import { runVerifyActiveProductAssets } from "../verify-active-product-assets.ts";
import { resolveProductAssetAbsolutePath, shouldBypassGenericImagesStatic } from "../../server/utils/productAssetsResolver.ts";

function uniqueId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function withRepoBackup<T>(fn: () => Promise<T>): Promise<T> {
  const repoRoot = process.cwd();
  const liveRoot = path.join(repoRoot, "client", "public", "images", "products");
  const remigrationRoot = path.join(repoRoot, "tmp", "remigration");
  const versionRoot = path.join(repoRoot, "client", "public", "images", "product-versions");
  const fallbackRoot = path.join(repoRoot, "public", "images", "products");
  const signalPath = path.join(repoRoot, "client", "public", ".assets-version.json");
  const activePath = path.join(repoRoot, "client", "public", ".active-product-assets.json");

  const backupRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "remigration-test-backup-"));
  const backup = (name: string) => path.join(backupRoot, name);

  if (fs.existsSync(liveRoot)) await fs.promises.rename(liveRoot, backup("products"));
  if (fs.existsSync(remigrationRoot)) await fs.promises.rename(remigrationRoot, backup("remigration"));
  if (fs.existsSync(versionRoot)) await fs.promises.rename(versionRoot, backup("versions"));
  if (fs.existsSync(fallbackRoot)) await fs.promises.rename(fallbackRoot, backup("fallback"));
  if (fs.existsSync(signalPath)) await fs.promises.rename(signalPath, backup("assets-version.json"));
  if (fs.existsSync(activePath)) await fs.promises.rename(activePath, backup("active-assets.json"));

  await fs.promises.mkdir(liveRoot, { recursive: true });
  await fs.promises.mkdir(versionRoot, { recursive: true });
  await fs.promises.mkdir(fallbackRoot, { recursive: true });

  try {
    return await fn();
  } finally {
    await fs.promises.rm(liveRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(remigrationRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(versionRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(fallbackRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(signalPath, { force: true }).catch(() => undefined);
    await fs.promises.rm(activePath, { force: true }).catch(() => undefined);

    const restore = async (name: string, target: string) => {
      const source = backup(name);
      if (!fs.existsSync(source)) return;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.rename(source, target);
    };

    await restore("products", liveRoot);
    await restore("remigration", remigrationRoot);
    await restore("versions", versionRoot);
    await restore("fallback", fallbackRoot);
    await restore("assets-version.json", signalPath);
    await restore("active-assets.json", activePath);

    await fs.promises.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("switch lock blocks concurrent switch", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("lock-active");
    const lockPath = path.join(process.cwd(), "tmp", "remigration", ".switch-lock");
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.promises.writeFile(lockPath, JSON.stringify({ runId: "other", backupId: "x", createdAt: new Date().toISOString(), pid: process.pid, hostname: os.hostname() }), "utf8");
    await assert.rejects(() => runSwitchProductAssetsRoot({ runId }), /Active switch lock present/);
  });
});

test("stale switch lock is recovered", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("lock-stale");
    const lockPath = path.join(process.cwd(), "tmp", "remigration", ".switch-lock");
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const sourceRoot = path.join(process.cwd(), "tmp", "remigration", "live-targets", runId, "products", "prod", "cover.jpg");
    await fs.promises.mkdir(path.dirname(sourceRoot), { recursive: true });
    await fs.promises.writeFile(sourceRoot, "new", "utf8");
    await fs.promises.mkdir(path.join(liveRoot, "old"), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "old", "cover.jpg"), "old", "utf8");
    await fs.promises.writeFile(lockPath, JSON.stringify({ runId: "old", backupId: "old", createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(), pid: 1, hostname: "x" }), "utf8");

    const result = await runSwitchProductAssetsRoot({ runId });
    assert.equal(result.report.status, "success");
    assert.equal(result.report.staleLockRecovered, true);
  });
});

test("in-progress marker created and cleaned", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("in-progress");
    const markerPath = path.join(process.cwd(), "tmp", "remigration", ".switch-in-progress");
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const sourceRoot = path.join(process.cwd(), "tmp", "remigration", "live-targets", runId, "products", "prod", "cover.jpg");
    await fs.promises.mkdir(path.dirname(sourceRoot), { recursive: true });
    await fs.promises.writeFile(sourceRoot, "new", "utf8");
    await fs.promises.mkdir(path.join(liveRoot, "old"), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "old", "cover.jpg"), "old", "utf8");

    await runSwitchProductAssetsRoot({ runId });
    assert.equal(fs.existsSync(markerPath), false);
  });
});

test("switch failure during assets-version signal write rolls back live root", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("signal-fail");
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const sourceRoot = path.join(process.cwd(), "tmp", "remigration", "live-targets", runId, "products", "prod-next", "cover.jpg");
    await fs.promises.mkdir(path.dirname(sourceRoot), { recursive: true });
    await fs.promises.writeFile(sourceRoot, "next", "utf8");
    await fs.promises.mkdir(path.join(liveRoot, "prod-old"), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "prod-old", "cover.jpg"), "old", "utf8");

    const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
    Object.defineProperty(fs.promises, "writeFile", {
      configurable: true,
      writable: true,
      value: (async (targetPath: fs.PathLike, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (String(targetPath).endsWith(path.join("client", "public", ".assets-version.json"))) {
          throw new Error("simulated signal write failure");
        }
        return originalWriteFile(targetPath, data, options);
      }) as typeof fs.promises.writeFile,
    });

    try {
      await assert.rejects(() => runSwitchProductAssetsRoot({ runId }), /simulated signal write failure/);
    } finally {
      Object.defineProperty(fs.promises, "writeFile", { configurable: true, writable: true, value: originalWriteFile });
    }

    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-old", "cover.jpg"), "utf8"), "old");
    assert.equal(fs.existsSync(path.join(liveRoot, "prod-next")), false);
  });
});

test("report write failure after commit point does not mark switch as failed", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("report-fail");
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const sourceRoot = path.join(process.cwd(), "tmp", "remigration", "live-targets", runId, "products", "prod-next", "cover.jpg");
    await fs.promises.mkdir(path.dirname(sourceRoot), { recursive: true });
    await fs.promises.writeFile(sourceRoot, "next", "utf8");
    await fs.promises.mkdir(path.join(liveRoot, "prod-old"), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "prod-old", "cover.jpg"), "old", "utf8");

    const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
    Object.defineProperty(fs.promises, "writeFile", {
      configurable: true,
      writable: true,
      value: (async (targetPath: fs.PathLike, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (String(targetPath).includes(path.join("tmp", "remigration", "reports"))) {
          throw new Error("simulated report write failure");
        }
        return originalWriteFile(targetPath, data, options);
      }) as typeof fs.promises.writeFile,
    });

    let result: Awaited<ReturnType<typeof runSwitchProductAssetsRoot>>;
    try {
      result = await runSwitchProductAssetsRoot({ runId });
    } finally {
      Object.defineProperty(fs.promises, "writeFile", { configurable: true, writable: true, value: originalWriteFile });
    }

    assert.equal(result.report.status, "success");
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-next", "cover.jpg"), "utf8"), "next");
    assert.equal(fs.existsSync(path.join(liveRoot, "prod-old")), false);
  });
});

test("fallback root non-empty fails verify by default", async () => {
  await withRepoBackup(async () => {
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const fallbackRoot = path.join(process.cwd(), "public", "images", "products");
    await fs.promises.mkdir(path.join(liveRoot, "prod",), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "prod", "cover.jpg"), "ok", "utf8");
    await fs.promises.writeFile(path.join(process.cwd(), "client", "public", ".assets-version.json"), JSON.stringify({ mode: "v2-root-switch", runId: "a", cleanRoomRunId: "b", switchedAt: new Date().toISOString() }), "utf8");
    await fs.promises.mkdir(path.join(fallbackRoot, "ghost"), { recursive: true });
    await assert.rejects(() => runVerifyProductAssetsRoot("fallback-fail"), /Fallback root is not empty/);
  });
});

test("fallback root non-empty can be bypassed explicitly", async () => {
  await withRepoBackup(async () => {
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    const fallbackRoot = path.join(process.cwd(), "public", "images", "products");
    await fs.promises.mkdir(path.join(liveRoot, "prod",), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "prod", "cover.jpg"), "ok", "utf8");
    await fs.promises.writeFile(path.join(process.cwd(), "client", "public", ".assets-version.json"), JSON.stringify({ mode: "v2-root-switch", runId: "a", cleanRoomRunId: "b", switchedAt: new Date().toISOString() }), "utf8");
    await fs.promises.mkdir(path.join(fallbackRoot, "ghost"), { recursive: true });
    const result = await runVerifyProductAssetsRoot("fallback-allow", { allowNonEmptyFallback: true });
    assert.equal(result.report.status, "pass");
  });
});

test("orchestrator resumes from partial state", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("resume");
    const cleanRoomRunId = uniqueId("clean");
    const statePath = path.join(process.cwd(), "tmp", "remigration", "runs", `${runId}.state.json`);
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
    await fs.promises.writeFile(statePath, JSON.stringify({
      runId,
      cleanRoomRunId,
      backupId: null,
      mode: "v2-root-switch",
      steps: { validatePublish: "done", publishCleanRoom: "done", verifyCleanRoom: "pending", switchLiveRoot: "pending", verifyLiveRoot: "pending" },
      lastUpdatedAt: new Date().toISOString(),
    }), "utf8");

    const executed: string[] = [];
    await runRemigrationOrchestration(
      { runId, cleanRoomRunId, step: "full" },
      {
        commandRunner: (label) => {
          executed.push(label);
        },
        switchRunner: async () => {
          executed.push("switch-live-root");
          return { report: { backupId: "auto-backup-id" } } as Awaited<ReturnType<typeof runSwitchProductAssetsRoot>>;
        },
        retentionRunner: async () => ({ removedBackups: [], removedCleanRoomRuns: [], removedRunStates: [], removedVersionRoots: [] }),
      },
    );

    assert.deepEqual(executed, ["verify-clean-room", "switch-live-root", "post-switch-verify"]);
  });
});

test("orchestrator stores auto-generated backupId into state", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("auto-backup");
    const cleanRoomRunId = uniqueId("auto-clean");
    const statePath = path.join(process.cwd(), "tmp", "remigration", "runs", `${runId}.state.json`);

    await runRemigrationOrchestration(
      { runId, cleanRoomRunId, step: "full" },
      {
        commandRunner: () => undefined,
        switchRunner: async () => ({ report: { backupId: "generated-backup-123" } } as Awaited<ReturnType<typeof runSwitchProductAssetsRoot>>),
        retentionRunner: async () => ({ removedBackups: [], removedCleanRoomRuns: [], removedRunStates: [], removedVersionRoots: [] }),
      },
    );

    const state = JSON.parse(await fs.promises.readFile(statePath, "utf8")) as { backupId: string };
    assert.equal(state.backupId, "generated-backup-123");
  });
});

test("retention preserves current backup and pipeline state file when preserve ids are passed", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("pipeline-preserve");
    const cleanRoomRunId = uniqueId("clean-preserve");
    const backupId = uniqueId("backup-preserve");
    const runsRoot = path.join(process.cwd(), "tmp", "remigration", "runs");
    const backupsRoot = path.join(process.cwd(), "tmp", "remigration", "backups");
    const liveTargetsRoot = path.join(process.cwd(), "tmp", "remigration", "live-targets");
    await fs.promises.mkdir(runsRoot, { recursive: true });
    await fs.promises.mkdir(backupsRoot, { recursive: true });
    await fs.promises.mkdir(liveTargetsRoot, { recursive: true });
    await fs.promises.writeFile(path.join(runsRoot, `${runId}.state.json`), "{}", "utf8");
    await fs.promises.writeFile(path.join(runsRoot, "other.state.json"), "{}", "utf8");
    await fs.promises.mkdir(path.join(backupsRoot, backupId), { recursive: true });
    await fs.promises.mkdir(path.join(backupsRoot, "old-backup"), { recursive: true });
    await fs.promises.mkdir(path.join(liveTargetsRoot, cleanRoomRunId), { recursive: true });
    await fs.promises.mkdir(path.join(liveTargetsRoot, "old-clean"), { recursive: true });

    await cleanupRemigrationArtifacts({
      keepLastNCleanRoomRuns: 0,
      keepLastNBackups: 0,
      keepLastNRunStates: 0,
      preserveRunIds: [runId, cleanRoomRunId],
      preserveBackupIds: [backupId],
      logger: { log() {}, warn() {} },
    });

    assert.equal(fs.existsSync(path.join(runsRoot, `${runId}.state.json`)), true);
    assert.equal(fs.existsSync(path.join(backupsRoot, backupId)), true);
  });
});

test("retention removes old clean-room runs and backups but preserves pinned ids", async () => {
  await withRepoBackup(async () => {
    const remigrationRoot = path.join(process.cwd(), "tmp", "remigration");
    const liveTargets = path.join(remigrationRoot, "live-targets");
    const backups = path.join(remigrationRoot, "backups");
    const runs = path.join(remigrationRoot, "runs");
    await fs.promises.mkdir(liveTargets, { recursive: true });
    await fs.promises.mkdir(backups, { recursive: true });
    await fs.promises.mkdir(runs, { recursive: true });

    const makeDir = async (root: string, name: string, index: number) => {
      const dir = path.join(root, name);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.utimes(dir, new Date(Date.now() - index * 1000), new Date(Date.now() - index * 1000));
    };

    await makeDir(liveTargets, "a", 5);
    await makeDir(liveTargets, "b", 4);
    await makeDir(liveTargets, "c", 3);
    await makeDir(liveTargets, "d", 2);
    await makeDir(backups, "k1", 5);
    await makeDir(backups, "k2", 4);
    await makeDir(backups, "k3", 3);
    await makeDir(backups, "k4", 2);
    await fs.promises.writeFile(path.join(runs, "run-1.state.json"), "{}", "utf8");
    await fs.promises.writeFile(path.join(runs, "run-2.state.json"), "{}", "utf8");

    const result = await cleanupRemigrationArtifacts({ keepLastNCleanRoomRuns: 2, keepLastNBackups: 2, keepLastNRunStates: 1, preserveRunIds: ["a"], preserveBackupIds: ["k1"] });
    assert.ok(result.removedCleanRoomRuns.includes("b") || result.removedCleanRoomRuns.includes("c"));
    assert.ok(result.removedBackups.includes("k2") || result.removedBackups.includes("k3"));
  });
});

test("verify live fails when assets version signal missing or malformed", async () => {
  await withRepoBackup(async () => {
    const liveRoot = path.join(process.cwd(), "client", "public", "images", "products");
    await fs.promises.mkdir(path.join(liveRoot, "prod"), { recursive: true });
    await fs.promises.writeFile(path.join(liveRoot, "prod", "cover.jpg"), "ok", "utf8");

    await assert.rejects(() => runVerifyProductAssetsRoot("missing-signal"), /Missing runtime signal file/);

    await fs.promises.writeFile(path.join(process.cwd(), "client", "public", ".assets-version.json"), "{ bad", "utf8");
    await assert.rejects(() => runVerifyProductAssetsRoot("malformed-signal"), /Malformed runtime signal file/);
  });
});

test("version promotion fails into existing non-empty version root", async () => {
  await withRepoBackup(async () => {
    const runId = uniqueId("promote-run");
    const versionId = uniqueId("version");
    const source = path.join(process.cwd(), "tmp", "remigration", "live-targets", runId, "products", "prod", "cover.jpg");
    const target = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod", "cover.jpg");
    await fs.promises.mkdir(path.dirname(source), { recursive: true });
    await fs.promises.writeFile(source, "new", "utf8");
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, "old", "utf8");

    await assert.rejects(() => runPromoteCleanRoomToProductVersion(runId, versionId), /existing non-empty version root/);
  });
});

test("version root verify fails on missing cover", async () => {
  await withRepoBackup(async () => {
    const versionId = uniqueId("version");
    const dir = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "01.jpg"), "gallery", "utf8");
    await assert.rejects(() => runVerifyProductAssetsVersionRoot(versionId), /Missing covers/);
  });
});

test("active pointer verify fails on missing version root", async () => {
  await withRepoBackup(async () => {
    await fs.promises.writeFile(path.join(process.cwd(), "client", "public", ".active-product-assets.json"), JSON.stringify({ mode: "v3-versioned-assets", versionId: "missing", sourceRunId: "run", activatedAt: new Date().toISOString() }), "utf8");
    await assert.rejects(() => runVerifyActiveProductAssets(), /Missing version root/);
  });
});

test("activate fails on version root without cover", async () => {
  await withRepoBackup(async () => {
    const versionId = uniqueId("activate-no-cover");
    const versionDir = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod");
    await fs.promises.mkdir(versionDir, { recursive: true });
    await fs.promises.writeFile(path.join(versionDir, "01.jpg"), "gallery", "utf8");
    await assert.rejects(() => runActivateProductAssetsVersion(versionId, "source-1"), /Missing covers/);
  });
});

test("activate version updates pointer", async () => {
  await withRepoBackup(async () => {
    const versionId = uniqueId("version");
    const versionDir = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod");
    await fs.promises.mkdir(versionDir, { recursive: true });
    await fs.promises.writeFile(path.join(versionDir, "cover.jpg"), "ok", "utf8");

    await runActivateProductAssetsVersion(versionId, "source-1");
    const pointer = JSON.parse(await fs.promises.readFile(path.join(process.cwd(), "client", "public", ".active-product-assets.json"), "utf8")) as { versionId: string };
    assert.equal(pointer.versionId, versionId);
  });
});

test("verify-active fails when active version root misses cover", async () => {
  await withRepoBackup(async () => {
    const versionId = uniqueId("active-missing-cover");
    const versionDir = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod");
    await fs.promises.mkdir(versionDir, { recursive: true });
    await fs.promises.writeFile(path.join(versionDir, "01.jpg"), "gallery", "utf8");
    await fs.promises.writeFile(
      path.join(process.cwd(), "client", "public", ".active-product-assets.json"),
      JSON.stringify({ mode: "v3-versioned-assets", versionId, sourceRunId: "source-1", activatedAt: new Date().toISOString() }),
      "utf8",
    );
    await assert.rejects(() => runVerifyActiveProductAssets(), /Version integrity check failed/);
  });
});

test("server resolver in v3 mode resolves active version asset and misses return null", async () => {
  await withRepoBackup(async () => {
    const versionId = uniqueId("version");
    const assetPath = path.join(process.cwd(), "client", "public", "images", "product-versions", versionId, "prod", "cover.jpg");
    await fs.promises.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.promises.writeFile(assetPath, "ok", "utf8");
    await runActivateProductAssetsVersion(versionId, "source-1");

    const found = await resolveProductAssetAbsolutePath("prod", "cover.jpg", "v3-versioned-assets");
    const missing = await resolveProductAssetAbsolutePath("prod", "01.jpg", "v3-versioned-assets");
    assert.ok(found?.endsWith(path.join(versionId, "prod", "cover.jpg")));
    assert.equal(missing, null);
  });
});

test("v2 resolver mode remains functional", async () => {
  await withRepoBackup(async () => {
    const assetPath = path.join(process.cwd(), "client", "public", "images", "products", "prod", "cover.jpg");
    await fs.promises.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.promises.writeFile(assetPath, "ok", "utf8");
    const resolved = await resolveProductAssetAbsolutePath("prod", "cover.jpg", "v2-root-switch");
    assert.equal(resolved, assetPath);
  });
});

test("server v3 guard bypasses generic /images static for /images/products paths", () => {
  assert.equal(shouldBypassGenericImagesStatic("/products/prod/cover.jpg", "v3-versioned-assets"), true);
  assert.equal(shouldBypassGenericImagesStatic("/logos/site-logo.png", "v3-versioned-assets"), false);
  assert.equal(shouldBypassGenericImagesStatic("/products/prod/cover.jpg", "v2-root-switch"), false);
});
