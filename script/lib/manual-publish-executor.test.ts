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

async function writeFixture(root: string, runId: string): Promise<{ gateRunId: string; liveRoot: string }> {
  const gateRunId = runId;
  const gateDir = path.join(root, "tmp", "publish-gates");
  const manifestDir = path.join(root, "tmp", "agent-manifests");
  const stagingRoot = path.join(root, "tmp", "agent-staging");
  const reportRoot = path.join(process.cwd(), "tmp", "publish-reports");
  const liveRoot = path.join(root, "client", "public", "images", "products");
  const stagedDir = path.join(stagingRoot, runId, "existing", "prod-1");
  await fs.promises.mkdir(stagedDir, { recursive: true });
  await fs.promises.mkdir(gateDir, { recursive: true });
  await fs.promises.mkdir(manifestDir, { recursive: true });
  await fs.promises.mkdir(reportRoot, { recursive: true });
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
      approvedLocalProductId: "prod-1",
      stagingTargetKey: "existing/prod-1",
      plannedOutputs: [
        `tmp/agent-staging/${runId}/existing/prod-1/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/prod-1/cover.webp`,
      ],
      producedOutputs: [
        `tmp/agent-staging/${runId}/existing/prod-1/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/prod-1/cover.webp`,
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
      approvedLocalProductId: "prod-1",
      stagingTargetKey: "existing/prod-1",
      plannedOutputs: [
        `tmp/agent-staging/${runId}/existing/prod-1/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/prod-1/cover.webp`,
      ],
      producedOutputs: [
        `tmp/agent-staging/${runId}/existing/prod-1/cover.jpg`,
        `tmp/agent-staging/${runId}/existing/prod-1/cover.webp`,
      ],
      eligibilityStatus: "eligible",
      reasonCodes: [],
      releaseDecision: "ready_for_publish",
    }],
  };

  await fs.promises.writeFile(path.join(manifestDir, `${runId}.staging.json`), JSON.stringify(staging, null, 2), "utf8");
  await fs.promises.writeFile(path.join(gateDir, `${gateRunId}.publish-gate.json`), JSON.stringify(gate, null, 2), "utf8");
  return { gateRunId, liveRoot };
}

test("manual publish validate-only writes report but no live assets", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manual-publish-validate-"));
  const runId = uniqueRunId("publish");
  try {
    const { gateRunId, liveRoot } = await writeFixture(root, runId);
    const result = await runManualPublishExecutor({
      runId,
      gateRunId,
      validateOnly: true,
      gateDir: path.join(root, "tmp", "publish-gates"),
      stagingManifestDir: path.join(root, "tmp", "agent-manifests"),
      stagingRoot: path.join(root, "tmp", "agent-staging"),
      reportDir: path.join(process.cwd(), "tmp", "publish-reports"),
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
    const { gateRunId, liveRoot } = await writeFixture(root, runId);
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
      reportDir: path.join(process.cwd(), "tmp", "publish-reports"),
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
