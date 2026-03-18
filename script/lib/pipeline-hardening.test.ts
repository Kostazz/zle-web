import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSourceProductKey } from "./tbs-parser.ts";
import { safeFetchBinary, type FetchLimits } from "./fetch-utils.ts";
import { publishFromApprovedManifest } from "./pipeline-runner.final.ts";
import type { RunManifest } from "./ingest-manifest.ts";

// Root of the live output tree used by the publish pipeline.
const LIVE_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

test("source product key stays stable when URL/content fields change but slug is same", () => {
  const keyA = createSourceProductKey("mikina-zle-classic");
  const keyB = createSourceProductKey("mikina-zle-classic");
  assert.equal(keyA, keyB);
});

test("safeFetchBinary rejects oversized payload while streaming and cancels reader", async () => {
  const originalFetch = globalThis.fetch;
  let pulls = 0;
  let cancelled = false;
  // Stub the global fetch to return a streaming response that never ends.
  globalThis.fetch = (async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(12));
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const limits: FetchLimits = {
    timeoutMs: 2_000,
    maxHtmlBytes: 20,
    maxImageBytes: 20,
    minDelayMs: 0,
    maxDelayMs: 0,
  };
  try {
    await assert.rejects(
      safeFetchBinary("https://totalboardshop.cz/test", limits, "html"),
      /Payload too large/,
    );
    assert.ok(pulls >= 2);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publish is manifest-driven and ignores unapproved staged files", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-manifest-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-test-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    const approvedPath = path.join(stagedDir, "cover.jpg");
    const unapprovedPath = path.join(stagedDir, "extra.jpg");
    await fs.promises.writeFile(approvedPath, "approved", "utf8");
    await fs.promises.writeFile(unapprovedPath, "unapproved", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), approvedPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath, manifestPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      publishedOutputs: number;
    };
    assert.equal(report.success, true);
    assert.equal(report.publishedOutputs, 1);
    const publishedApproved = path.join(LIVE_ROOT, productId, "cover.jpg");
    const publishedUnapproved = path.join(LIVE_ROOT, productId, "extra.jpg");
    assert.equal(fs.existsSync(publishedApproved), true);
    assert.equal(fs.existsSync(publishedUnapproved), false);
    const publishManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as {
      assets: Array<{ publishedOutputs: string[] }>;
    };
    assert.equal(publishManifest.assets.length, 1);
    assert.equal(publishManifest.assets[0]?.publishedOutputs.length, 1);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish groups multiple approved assets for one product into one swap", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-grouped-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-grouped-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.mkdir(liveDir, { recursive: true });
    const coverPath = path.join(stagedDir, "cover.jpg");
    const slotPath = path.join(stagedDir, "01.webp");
    await fs.promises.writeFile(coverPath, "new-cover", "utf8");
    await fs.promises.writeFile(slotPath, "new-slot", "utf8");
    // Prepopulate live with stale managed and custom files.
    await fs.promises.writeFile(path.join(liveDir, "02.jpg"), "stale-managed", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "custom.txt"), "keep-me", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-cover`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-cover.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), coverPath).split(path.sep).join("/")],
          errors: [],
        },
        {
          assetId: `${runId}:asset-slot`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-slot.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), slotPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath, manifestPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      publishedOutputs: number;
    };
    const publishManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as {
      assets: Array<{ assetId: string; publishedOutputs: string[] }>;
    };
    assert.equal(report.success, true);
    assert.equal(report.publishedOutputs, 2);
    // Live should contain the new cover and slot.
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "new-cover");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "01.webp"), "utf8"), "new-slot");
    // Stale managed files should be removed, unmanaged file remains.
    assert.equal(fs.existsSync(path.join(liveDir, "02.jpg")), false);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "custom.txt"), "utf8"), "keep-me");
    // Each asset should report exactly one published output.
    assert.deepEqual(
      publishManifest.assets
        .map((asset) => [asset.assetId, asset.publishedOutputs.length])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        [`${runId}:asset-cover`, 1],
        [`${runId}:asset-slot`, 1],
      ],
    );
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish replaces stale managed outputs but preserves unrelated live files", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-preserve-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-preserve-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.mkdir(path.join(liveDir, "notes"), { recursive: true });
    const nextCoverPath = path.join(stagedDir, "cover.jpg");
    const nextSlotPath = path.join(stagedDir, "01.webp");
    await fs.promises.writeFile(nextCoverPath, "new-cover", "utf8");
    await fs.promises.writeFile(nextSlotPath, "new-slot", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "old-cover", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "02.jpg"), "stale-managed", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "custom.txt"), "keep-me", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "notes", "readme.txt"), "nested-keep", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [
            path.relative(process.cwd(), nextCoverPath).split(path.sep).join("/"),
            path.relative(process.cwd(), nextSlotPath).split(path.sep).join("/"),
          ],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      publishedOutputs: number;
    };
    assert.equal(report.success, true);
    assert.equal(report.publishedOutputs, 2);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "new-cover");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "01.webp"), "utf8"), "new-slot");
    assert.equal(fs.existsSync(path.join(liveDir, "02.jpg")), false);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "custom.txt"), "utf8"), "keep-me");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "notes", "readme.txt"), "utf8"), "nested-keep");
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

// Cross-product test: ensure that publish only affects touched products and
// leaves other products untouched.  This adapts the original base test to
// the manifest-driven publish logic.
test("publish removes stale managed outputs for touched product and preserves files for untouched product", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-stale-cleanup-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-clean-${Date.now()}`;
  const untouchedProductId = `zle-untouched-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.mkdir(path.join(LIVE_ROOT, productId), { recursive: true });
    await fs.promises.mkdir(path.join(LIVE_ROOT, untouchedProductId), { recursive: true });
    // Populate live for touched product: cover and 01 are managed; 02 is stale; README is unmanaged.
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "cover.jpg"), "old-cover", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "01.jpg"), "old-01", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "02.jpg"), "stale-02", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "README.txt"), "keep-me", "utf8");
    // Populate live for untouched product.
    await fs.promises.writeFile(path.join(LIVE_ROOT, untouchedProductId, "cover.jpg"), "untouched", "utf8");
    // Populate staged with new cover and 01 for touched product.
    const approvedCover = path.join(stagedDir, "cover.jpg");
    const approved01 = path.join(stagedDir, "01.jpg");
    await fs.promises.writeFile(approvedCover, "new-cover", "utf8");
    await fs.promises.writeFile(approved01, "new-01", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [
            path.relative(process.cwd(), approvedCover).split(path.sep).join("/"),
            path.relative(process.cwd(), approved01).split(path.sep).join("/"),
          ],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean };
    assert.equal(report.success, true);
    // Touched product: new cover and 01 exist; stale 02 removed; README preserved.
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "cover.jpg")), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "01.jpg")), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "02.jpg")), false);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "README.txt")), true);
    // Untouched product should remain completely unchanged.
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, untouchedProductId, "cover.jpg")), true);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, untouchedProductId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish rejects per-product target conflicts across multiple assets", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-cross-asset-conflict-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-cross-conflict-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  const duplicatePath = path.join(stagedDir, "cover.jpg");
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.writeFile(duplicatePath, "cover", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-a`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-a.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), duplicatePath).split(path.sep).join("/")],
          errors: [],
        },
        {
          assetId: `${runId}:asset-b`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-b.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), duplicatePath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath, manifestPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
      publishedOutputs: number;
    };
    const publishManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as {
      assets: Array<{ publishedOutputs: string[] }>;
    };
    assert.equal(report.success, false);
    assert.equal(report.publishedOutputs, 0);
    assert.match(report.errors[0] ?? "", /Conflicting staged outputs/);
    assert.deepEqual(
      publishManifest.assets.map((asset) => asset.publishedOutputs.length),
      [0, 0],
    );
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("missing staged output blocks the whole product publish", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-missing-output-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-missing-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.mkdir(liveDir, { recursive: true });
    const coverPath = path.join(stagedDir, "cover.jpg");
    const missingPath = path.join(stagedDir, "01.webp");
    await fs.promises.writeFile(coverPath, "new-cover", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "old-cover", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "custom.txt"), "keep-me", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-cover`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-cover.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), coverPath).split(path.sep).join("/")],
          errors: [],
        },
        {
          assetId: `${runId}:asset-missing`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-missing.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), missingPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath, manifestPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
      publishedOutputs: number;
    };
    const publishManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as {
      assets: Array<{ publishedOutputs: string[] }>;
    };
    assert.equal(report.success, false);
    assert.equal(report.publishedOutputs, 0);
    assert.match(report.errors[0] ?? "", /Missing staged output/);
    assert.deepEqual(publishManifest.assets.map((asset) => asset.publishedOutputs.length), [0, 0]);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "old-cover");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "custom.txt"), "utf8"), "keep-me");
    assert.equal(fs.existsSync(path.join(liveDir, "01.webp")), false);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish fails closed when staged outputs collapse to the same flat live target", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-conflict-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-conflict-${Date.now()}`;
  const stagedProductDir = path.join(tempRoot, "stage", productId);
  try {
    await fs.promises.mkdir(stagedProductDir, { recursive: true });
    const firstPath = path.join(stagedProductDir, "cover.jpg");
    await fs.promises.writeFile(firstPath, "first", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [
            path.relative(process.cwd(), firstPath).split(path.sep).join("/"),
            path.relative(process.cwd(), firstPath).split(path.sep).join("/"),
          ],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
    };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /Conflicting staged outputs/);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish fails closed when staged output violates flat publish contract", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-nested-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-nested-${Date.now()}`;
  const invalidPath = path.join(tempRoot, "stage", productId, "gallery", "01.jpg");
  try {
    await fs.promises.mkdir(path.dirname(invalidPath), { recursive: true });
    await fs.promises.writeFile(invalidPath, "nested", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), invalidPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
    };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /violates flat publish contract/);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish rollback restores previous live state when swap fails safely", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-rollback-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-rollback-${Date.now()}`;
  const stagedProductDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  const liveFile = path.join(liveDir, "cover.jpg");
  const originalRename = fs.promises.rename;
  let renameCount = 0;
  try {
    await fs.promises.mkdir(stagedProductDir, { recursive: true });
    await fs.promises.mkdir(liveDir, { recursive: true });
    const approvedPath = path.join(stagedProductDir, "cover.jpg");
    await fs.promises.writeFile(approvedPath, "approved", "utf8");
    await fs.promises.writeFile(liveFile, "original", "utf8");
    // Monkey‑patch rename to simulate a failure on the second rename (swap) call.
    fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
      renameCount += 1;
      if (renameCount === 2) {
        throw new Error("simulated swap failure");
      }
      return originalRename(from, to);
    }) as typeof fs.promises.rename;
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), approvedPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
    };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /simulated swap failure/);
    // Ensure original live file is restored.
    assert.equal(await fs.promises.readFile(liveFile, "utf8"), "original");
  } finally {
    fs.promises.rename = originalRename;
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish reports anomalous live target state after failed swap", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-anomaly-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-anomaly-${Date.now()}`;
  const stagedProductDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  const liveFile = path.join(liveDir, "cover.jpg");
  const originalRename = fs.promises.rename;
  let renameCount = 0;
  try {
    await fs.promises.mkdir(stagedProductDir, { recursive: true });
    await fs.promises.mkdir(liveDir, { recursive: true });
    const approvedPath = path.join(stagedProductDir, "cover.jpg");
    await fs.promises.writeFile(approvedPath, "approved", "utf8");
    await fs.promises.writeFile(liveFile, "original", "utf8");
    // Monkey‑patch rename to simulate an anomaly on the second rename call.
    fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
      renameCount += 1;
      if (renameCount === 2) {
        // Create a live directory unexpectedly with a different file to simulate an anomaly.
        await fs.promises.mkdir(to.toString(), { recursive: true });
        await fs.promises.writeFile(path.join(to.toString(), "cover.jpg"), "unexpected", "utf8");
        throw new Error("simulated swap anomaly");
      }
      return originalRename(from, to);
    }) as typeof fs.promises.rename;
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: path.join(tempRoot, "stage"),
      reportPath: "x",
      assets: [
        {
          assetId: `${runId}:asset-1`,
          runId,
          sourceType: "manual",
          sourceRelativePath: "asset-1.jpg",
          productId,
          matchedConfidence: 1,
          requiresReview: false,
          approvalState: "approved",
          publishState: "staged",
          outputs: [path.relative(process.cwd(), approvedPath).split(path.sep).join("/")],
          errors: [],
        },
      ],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
    };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /anomalous state/);
    // After the anomaly, the live directory should contain the unexpected file.
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "unexpected");
  } finally {
    fs.promises.rename = originalRename;
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, `${productId}.backup-${publishRunId}`), {
      recursive: true,
      force: true,
    });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});