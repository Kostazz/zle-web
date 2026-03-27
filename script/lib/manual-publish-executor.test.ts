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

type FixtureProduct = {
  sourceProductKey: string;
  productId: string;
  coverJpg?: string;
  coverWebp?: string;
};

async function writeFixture(root: string, runId: string, products: FixtureProduct[] = [{ sourceProductKey: "source-1", productId: "prod-1" }]): Promise<{ gateRunId: string; liveRoot: string; reportDir: string; tempRoot: string; stagingRoot: string }> {
  const gateRunId = runId;
  const gateDir = path.join(root, "tmp", "publish-gates");
  const manifestDir = path.join(root, "tmp", "agent-manifests");
  const stagingRoot = path.join(root, "tmp", "agent-staging");
  const reportDir = path.join(process.cwd(), "tmp", "publish-reports");
  const liveRoot = path.join(root, "client", "public", "images", "products");
  const tempRoot = path.join(root, "tmp");
  await fs.promises.mkdir(gateDir, { recursive: true });
  await fs.promises.mkdir(manifestDir, { recursive: true });
  await fs.promises.mkdir(reportDir, { recursive: true });
  await fs.promises.mkdir(liveRoot, { recursive: true });

  const stagingItems: StagingExecutionReport["items"] = [];
  const gateItems: PublishGateManifest["items"] = [];

  for (const product of products) {
    const stagedDir = path.join(stagingRoot, runId, "products", product.productId);
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.writeFile(path.join(stagedDir, "cover.jpg"), product.coverJpg ?? `new-cover-${product.productId}`, "utf8");
    await fs.promises.writeFile(path.join(stagedDir, "cover.webp"), product.coverWebp ?? `new-cover-webp-${product.productId}`, "utf8");
    const plannedOutputs = [
      `tmp/agent-staging/${runId}/products/${product.productId}/cover.jpg`,
      `tmp/agent-staging/${runId}/products/${product.productId}/cover.webp`,
    ];
    stagingItems.push({
      sourceProductKey: product.sourceProductKey,
      resolutionType: "map_to_existing",
      approvedLocalProductId: product.productId,
      stagingTargetKey: `existing/${product.productId}`,
      plannedOutputs,
      producedOutputs: plannedOutputs,
      status: "staged",
      reasonCodes: [],
    });
    gateItems.push({
      sourceProductKey: product.sourceProductKey,
      sourceRunId: runId,
      reviewRunId: runId,
      stagingRunId: runId,
      resolutionType: "map_to_existing",
      approvedLocalProductId: product.productId,
      stagingTargetKey: `existing/${product.productId}`,
      plannedOutputs,
      producedOutputs: plannedOutputs,
      eligibilityStatus: "eligible",
      reasonCodes: [],
      releaseDecision: "ready_for_publish",
    });
  }

  const staging: StagingExecutionReport = {
    runId,
    sourceRunId: runId,
    reviewRunId: runId,
    createdAt: new Date().toISOString(),
    summary: {
      totalApprovedItems: products.length,
      selectedItems: products.length,
      stagedItems: products.length,
      failedItems: 0,
      skippedItems: 0,
      validateOnly: false,
      producedOutputs: products.length * 2,
    },
    items: stagingItems,
  };

  const gate: PublishGateManifest = {
    runId: gateRunId,
    sourceRunId: runId,
    reviewRunId: runId,
    stagingRunId: runId,
    createdAt: new Date().toISOString(),
    summary: {
      totalStagedItems: products.length,
      eligibleItems: products.length,
      blockedItems: 0,
      readyForPublish: products.length,
      holdCount: 0,
      rejectReleaseCount: 0,
    },
    items: gateItems,
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
    assert.equal(await fs.promises.readFile(path.join(existingLiveDir, "cover.jpg"), "utf8"), "new-cover-prod-1");
    assert.equal(await fs.promises.readFile(path.join(existingLiveDir, "cover.webp"), "utf8"), "new-cover-webp-prod-1");
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

test("manual publish excludes staged outputs that do not belong to target product", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-foreign-image-filter-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId);
    const stagingManifestPath = path.join(root, "tmp", "agent-manifests", `${runId}.staging.json`);
    const gateManifestPath = path.join(root, "tmp", "publish-gates", `${gateRunId}.publish-gate.json`);
    const staging = JSON.parse(await fs.promises.readFile(stagingManifestPath, "utf8")) as StagingExecutionReport;
    const gate = JSON.parse(await fs.promises.readFile(gateManifestPath, "utf8")) as PublishGateManifest;

    const foreignOutput = `tmp/agent-staging/${runId}/products/prod-2/01.jpg`;
    const foreignOutputWebp = `tmp/agent-staging/${runId}/products/prod-2/01.webp`;
    await fs.promises.mkdir(path.join(root, "tmp", "agent-staging", runId, "products", "prod-2"), { recursive: true });
    await fs.promises.writeFile(path.join(root, foreignOutput), "foreign-jpg", "utf8");
    await fs.promises.writeFile(path.join(root, foreignOutputWebp), "foreign-webp", "utf8");

    staging.items[0]?.plannedOutputs.push(foreignOutput, foreignOutputWebp);
    staging.items[0]?.producedOutputs.push(foreignOutput, foreignOutputWebp);
    gate.items[0]?.plannedOutputs.push(foreignOutput, foreignOutputWebp);
    gate.items[0]?.producedOutputs.push(foreignOutput, foreignOutputWebp);

    await fs.promises.writeFile(stagingManifestPath, JSON.stringify(staging, null, 2), "utf8");
    await fs.promises.writeFile(gateManifestPath, JSON.stringify(gate, null, 2), "utf8");

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
    const publishedItem = result.report.items.find((item) => item.sourceProductKey === "source-1");
    assert.ok(publishedItem);
    assert.ok(publishedItem.reasonCodes.includes("warning:excluded_foreign_staged_outputs"));
    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "01.jpg")), false);
    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "01.webp")), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});



test("manual publish processes multi-item batches without cross-item temp-dir interference", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-multi-batch-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId, [
      { sourceProductKey: "source-1", productId: "prod-1", coverJpg: "cover-1-jpg", coverWebp: "cover-1-webp" },
      { sourceProductKey: "source-2", productId: "prod-2", coverJpg: "cover-2-jpg", coverWebp: "cover-2-webp" },
    ]);

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

    assert.equal(result.report.summary.published, 2);
    assert.equal(result.report.summary.failed, 0);
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-1", "cover.jpg"), "utf8"), "cover-1-jpg");
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-1", "cover.webp"), "utf8"), "cover-1-webp");
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-2", "cover.jpg"), "utf8"), "cover-2-jpg");
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-2", "cover.webp"), "utf8"), "cover-2-webp");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("per-run orphan temp cleanup happens before batch execution and cannot break another product publish", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-batch-cleanup-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot, reportDir } = await writeFixture(root, runId, [
      { sourceProductKey: "source-1", productId: "prod-1", coverJpg: "safe-1-jpg", coverWebp: "safe-1-webp" },
      { sourceProductKey: "source-2", productId: "prod-2", coverJpg: "safe-2-jpg", coverWebp: "safe-2-webp" },
    ]);
    const orphanDir = path.join(liveRoot, ".manual-publish-temp-orphan");
    await fs.promises.mkdir(orphanDir, { recursive: true });
    await fs.promises.writeFile(path.join(orphanDir, "cover.jpg"), "stale-temp", "utf8");

    const rmTargets: string[] = [];
    const originalRm = fs.promises.rm.bind(fs.promises);
    const result = await withPatchedFsPromises({
      rm: (async (targetPath: fs.PathLike, options?: fs.RmOptions) => {
        rmTargets.push(String(targetPath));
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
    }));

    assert.equal(result.report.summary.published, 2);
    assert.equal(fs.existsSync(orphanDir), false);
    assert.equal(rmTargets.filter((target) => target === orphanDir).length, 1);
    assert.equal(await fs.promises.readFile(path.join(liveRoot, "prod-2", "cover.jpg"), "utf8"), "safe-2-jpg");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("manual publish still fails closed when a staged output is missing", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-missing-output-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, reportDir, stagingRoot, liveRoot } = await writeFixture(root, runId);
    await fs.promises.rm(path.join(stagingRoot, runId, "products", "prod-1", "cover.webp"), { force: true });

    await assert.rejects(() => runManualPublishExecutor({
      runId,
      gateRunId,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot,
      reportDir,
      liveRoot,
      tempRoot: path.join(root, "tmp"),
    }), /Missing staged output blocks publish/);

    assert.equal(fs.existsSync(path.join(liveRoot, "prod-1", "cover.jpg")), false);
    assert.equal(fs.existsSync(path.join(reportDir, `${runId}.publish.json`)), false);
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
