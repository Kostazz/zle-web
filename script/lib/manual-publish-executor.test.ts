import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runManualPublishExecutor } from "./manual-publish-executor.ts";
import type { PublishGateManifest } from "./publish-gate-types.ts";
import type { StagingExecutionReport } from "./staging-review-types.ts";

function uniqueRunId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function writeFixture(root: string, runId: string, productId = "prod-1"): Promise<{ gateRunId: string; liveRoot: string; reportDir: string; tempRoot: string; stagingRoot: string }> {
  const gateRunId = runId;
  const gateDir = path.join(root, "tmp", "publish-gates");
  const manifestDir = path.join(root, "tmp", "agent-manifests");
  const stagingRoot = path.join(root, "tmp", "agent-staging");
  const reportDir = path.join(process.cwd(), "tmp", "publish-reports");
  const liveRoot = path.join(root, "client", "public", "images", "products");
  const tempRoot = path.join(root, "tmp");
  const stagedDir = path.join(stagingRoot, runId, "existing", productId);
  await fs.promises.mkdir(stagedDir, { recursive: true });
  await fs.promises.mkdir(gateDir, { recursive: true });
  await fs.promises.mkdir(manifestDir, { recursive: true });
  await fs.promises.mkdir(reportDir, { recursive: true });
  await fs.promises.mkdir(liveRoot, { recursive: true });
  await fs.promises.writeFile(path.join(stagedDir, "cover.jpg"), "new-cover", "utf8");
  await fs.promises.writeFile(path.join(stagedDir, "cover.webp"), "new-cover-webp", "utf8");

  const staging: StagingExecutionReport = {
    runId,
    sourceRunId: runId,
    reviewRunId: runId,
    createdAt: new Date().toISOString(),
    summary: {
      totalApprovedItems: 1,
      selectedItems: 1,
      stagedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      validateOnly: false,
      producedOutputs: 2,
    },
    items: [{
      sourceProductKey: "source-1",
      resolutionType: "map_to_existing",
      approvedLocalProductId: productId,
      stagingTargetKey: `existing/${productId}`,
      plannedOutputs: [
        `tmp/agent-staging/${runId}/existing/${productId}/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/${productId}/cover.webp`,
      ],
      producedOutputs: [
        `tmp/agent-staging/${runId}/existing/${productId}/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/${productId}/cover.webp`,
      ],
      status: "staged",
      reasonCodes: [],
    }],
  };

  const gate: PublishGateManifest = {
    runId: gateRunId,
    sourceRunId: runId,
    reviewRunId: runId,
    stagingRunId: runId,
    createdAt: new Date().toISOString(),
    summary: {
      totalStagedItems: 1,
      eligibleItems: 1,
      blockedItems: 0,
      readyForPublish: 1,
      holdCount: 0,
      rejectReleaseCount: 0,
    },
    items: [{
      sourceProductKey: "source-1",
      sourceRunId: runId,
      reviewRunId: runId,
      stagingRunId: runId,
      resolutionType: "map_to_existing",
      approvedLocalProductId: productId,
      stagingTargetKey: `existing/${productId}`,
      plannedOutputs: [
        `tmp/agent-staging/${runId}/existing/${productId}/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/${productId}/cover.webp`,
      ],
      producedOutputs: [
        `tmp/agent-staging/${runId}/existing/${productId}/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/${productId}/cover.webp`,
      ],
      eligibilityStatus: "eligible",
      reasonCodes: [],
      releaseDecision: "ready_for_publish",
    }],
  };

  await fs.promises.writeFile(path.join(manifestDir, `${runId}.staging.json`), JSON.stringify(staging, null, 2), "utf8");
  await fs.promises.writeFile(path.join(gateDir, `${gateRunId}.publish-gate.json`), JSON.stringify(gate, null, 2), "utf8");
  return { gateRunId, liveRoot, reportDir, tempRoot, stagingRoot };
}

async function withPatchedFsPromises<T>(patches: Partial<typeof fs.promises>, fn: () => Promise<T>): Promise<T> {
  const originals = new Map<keyof typeof fs.promises, unknown>();
  for (const [key, value] of Object.entries(patches) as Array<[keyof typeof fs.promises, unknown]>) {
    originals.set(key, fs.promises[key]);
    Object.defineProperty(fs.promises, key, { value, configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of originals.entries()) {
      Object.defineProperty(fs.promises, key, { value, configurable: true, writable: true });
    }
  }
}

test("manual publish validate-only writes report but no live assets", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-validate-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      validateOnly: true,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    });

    assert.equal(result.report.summary.readyForPublish, 1);
    assert.equal(result.report.summary.skipped, 1);
    assert.equal(result.report.summary.published, 0);
    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "cover.jpg")), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("manual publish swaps staged outputs into the live root", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-live-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const existingLiveDir = path.join(liveRoot, "prod-1");
    await fs.promises.mkdir(existingLiveDir, { recursive: true });
    await fs.promises.writeFile(path.join(existingLiveDir, "01.jpg"), "stale", "utf8");
    await fs.promises.writeFile(path.join(existingLiveDir, "notes.txt"), "keep", "utf8");

    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    });

    assert.equal(result.report.summary.published, 1);
    assert.equal(await fs.promises.readFile(path.join(existingLiveDir, "cover.jpg"), "utf8"), "new-cover");
    assert.equal(await fs.promises.readFile(path.join(existingLiveDir, "cover.webp"), "utf8"), "new-cover-webp");
    assert.equal(fs.existsSync(path.join(existingLiveDir, "01.jpg")), false);
    assert.equal(await fs.promises.readFile(path.join(existingLiveDir, "notes.txt"), "utf8"), "keep");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("stale manual publish lock is safely recovered and cleaned up", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-stale-lock-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const lockPath = path.join(liveRoot, ".manual-publish-lock-prod-1.lock");
    await fs.promises.mkdir(liveRoot, { recursive: true });
    await fs.promises.writeFile(lockPath, JSON.stringify({
      liveTargetKey: "prod-1",
      runId: "stale-run",
      gateRunId: "stale-gate",
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
    }), "utf8");

    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    });

    assert.equal(result.report.summary.published, 1);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("active lock blocks publish fail-closed", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-active-lock-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const lockPath = path.join(liveRoot, ".manual-publish-lock-prod-1.lock");
    await fs.promises.mkdir(liveRoot, { recursive: true });
    await fs.promises.writeFile(lockPath, JSON.stringify({
      liveTargetKey: "prod-1",
      runId: "active-run",
      gateRunId: "active-gate",
      createdAt: new Date().toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
    }), "utf8");

    await assert.rejects(() => runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    }), /Publish lock actively held/);

    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "cover.jpg")), false);
    assert.equal(fs.existsSync(path.join(reportDir, `${runId}.publish.json`)), false);
    assert.equal(fs.existsSync(lockPath), true);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("orphan .manual-publish-temp-* directories are cleaned up safely", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-orphan-temp-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const orphanDir = path.join(liveRoot, ".manual-publish-temp-orphan");
    await fs.promises.mkdir(orphanDir, { recursive: true });
    await fs.promises.writeFile(path.join(orphanDir, "cover.jpg"), "stale-temp", "utf8");

    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    });

    assert.equal(result.report.summary.published, 1);
    assert.equal(fs.existsSync(orphanDir), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("cleanup failure stops publish fail-closed", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-cleanup-fail-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const orphanDir = path.join(liveRoot, ".manual-publish-temp-orphan");
    await fs.promises.mkdir(orphanDir, { recursive: true });

    const originalRm = fs.promises.rm.bind(fs.promises);
    await assert.rejects(() => withPatchedFsPromises({
      rm: (async (targetPath: fs.PathLike, options?: fs.RmOptions) => {
        if (String(targetPath) === orphanDir) throw new Error("simulated cleanup failure");
        return originalRm(targetPath, options);
      }) as typeof fs.promises.rm,
    }, async () => runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    })), /Manual publish failed closed/);

    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "cover.jpg")), false);
    const report = JSON.parse(await fs.promises.readFile(path.join(reportDir, `${runId}.publish.json`), "utf8")) as { items: Array<{ errorMessage?: string }> };
    assert.match(report.items[0]?.errorMessage ?? "", /simulated cleanup failure/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("a failed publish does not leave partial live state", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-partial-state-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const liveDir = path.join(liveRoot, "prod-1");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "old-cover", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "cover.webp"), "old-webp", "utf8");

    const originalRename = fs.promises.rename.bind(fs.promises);
    let renameCalls = 0;
    await assert.rejects(() => withPatchedFsPromises({
      rename: (async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error("simulated swap failure");
        return originalRename(oldPath, newPath);
      }) as typeof fs.promises.rename,
    }, async () => runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    })), /Manual publish failed closed/);

    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "old-cover");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.webp"), "utf8"), "old-webp");
    assert.equal(fs.existsSync(`${liveDir}.backup-${runId}`), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("validate-only does not delete or overwrite live managed outputs", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-validate-live-intact-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const liveDir = path.join(liveRoot, "prod-1");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "live-cover", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "cover.webp"), "live-webp", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "01.jpg"), "live-slot", "utf8");

    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      validateOnly: true,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    });

    assert.equal(result.report.summary.skipped, 1);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "live-cover");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.webp"), "utf8"), "live-webp");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "01.jpg"), "utf8"), "live-slot");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
