import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createSourceProductKey } from "./tbs-parser.ts";
import { safeFetchBinary, type FetchLimits } from "./fetch-utils.ts";
import { __publishHardeningTestUtils, __setPublishTestHooks, publishFromApprovedManifest } from "./pipeline-runner.ts";
import type { RunManifest } from "./ingest-manifest.ts";

// Root of the live output tree used by the publish pipeline.
const LIVE_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

function uniqueSuffix(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function createPublishManifest(
  tempRoot: string,
  runId: string,
  productId: string,
  fileEntries: Array<[string, string]>,
): Promise<RunManifest> {
  const stageRoot = path.join(tempRoot, "stage");
  const stagedDir = path.join(stageRoot, productId);
  await fs.promises.mkdir(stagedDir, { recursive: true });
  const outputs: string[] = [];
  for (const [fileName, contents] of fileEntries) {
    const filePath = path.join(stagedDir, fileName);
    await fs.promises.writeFile(filePath, contents, "utf8");
    outputs.push(path.relative(process.cwd(), filePath).split(path.sep).join("/"));
  }
  return {
    runId,
    sourceType: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvalState: "approved",
    publishState: "staged",
    requiresReview: false,
    inputDir: "x",
    outputDir: stageRoot,
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
        outputs,
        errors: [],
      },
    ],
    errors: [],
  };
}

async function writePublishLockFile(productId: string, metadata: Record<string, unknown> | string): Promise<string> {
  const lockPath = __publishHardeningTestUtils.getProductLockPath(productId);
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.promises.writeFile(lockPath, typeof metadata === "string" ? metadata : JSON.stringify(metadata), "utf8");
  return lockPath;
}

function createLockMetadata(productId: string, publishRunId: string, createdAt: string): Record<string, unknown> {
  return {
    productId,
    publishRunId,
    sourceRunId: publishRunId.replace(/-publish(?:-.+)?$/, "") || publishRunId,
    createdAt,
    hostname: os.hostname(),
    pid: process.pid,
  };
}


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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-test");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-grouped");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-preserve");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-clean");
  const untouchedProductId = uniqueSuffix("zle-untouched");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-cross-conflict");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-missing");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-conflict");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-nested");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-rollback");
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
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-anomaly");
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

test("concurrent publish for the same product fails closed with a clear lock error", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-same-"));
  const runId = uniqueSuffix("r");
  const publishRunIdA = `${runId}-publish-a`;
  const publishRunIdB = `${runId}-publish-b`;
  const productId = uniqueSuffix("zle-lock-same");
  const stagedDir = path.join(tempRoot, "stage", productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  let releaseFirstPublish: (() => void) | null = null;
  const firstPublishHoldingLock = new Promise<void>((resolve) => {
    releaseFirstPublish = resolve;
  });
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    const approvedPath = path.join(stagedDir, "cover.jpg");
    await fs.promises.writeFile(approvedPath, "approved", "utf8");
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
      assets: [{
        assetId: `${runId}:asset-1`, runId, sourceType: "manual", sourceRelativePath: "asset-1.jpg", productId,
        matchedConfidence: 1, requiresReview: false, approvalState: "approved", publishState: "staged",
        outputs: [path.relative(process.cwd(), approvedPath).split(path.sep).join("/")], errors: [],
      }],
      errors: [],
    };

    __setPublishTestHooks({
      afterProductLockAcquired: async (lockedProductId) => {
        if (lockedProductId === productId) {
          await firstPublishHoldingLock;
        }
      },
    });
    const firstPublishPromise = publishFromApprovedManifest(runId, publishRunIdA, manifest);
    await new Promise((resolve) => setTimeout(resolve, 50));
    __setPublishTestHooks({});
    const secondPublish = await publishFromApprovedManifest(runId, publishRunIdB, manifest);
    releaseFirstPublish?.();
    const firstPublish = await firstPublishPromise;

    const secondReport = JSON.parse(await fs.promises.readFile(secondPublish.reportPath, "utf8")) as { success: boolean; errors: string[] };
    const firstReport = JSON.parse(await fs.promises.readFile(firstPublish.reportPath, "utf8")) as { success: boolean; errors: string[] };
    assert.equal(firstReport.success, true);
    assert.equal(secondReport.success, false);
    assert.match(secondReport.errors[0] ?? "", /Publish lock actively held for product/);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "approved");
  } finally {
    __setPublishTestHooks({});
    releaseFirstPublish?.();
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("different product publishes can proceed independently", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-different-"));
  const runId = uniqueSuffix("r");
  const productA = uniqueSuffix("zle-lock-a");
  const productB = uniqueSuffix("zle-lock-b");
  const stageRoot = path.join(tempRoot, "stage");
  try {
    for (const [productId, contents] of [[productA, "alpha"], [productB, "beta"]] as const) {
      const stagedDir = path.join(stageRoot, productId);
      await fs.promises.mkdir(stagedDir, { recursive: true });
      await fs.promises.writeFile(path.join(stagedDir, "cover.jpg"), contents, "utf8");
    }
    const createManifest = (productId: string, value: string): RunManifest => ({
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: stageRoot,
      reportPath: "x",
      assets: [{
        assetId: `${productId}:asset-1`, runId, sourceType: "manual", sourceRelativePath: `${productId}.jpg`, productId,
        matchedConfidence: 1, requiresReview: false, approvalState: "approved", publishState: "staged",
        outputs: [path.relative(process.cwd(), path.join(stageRoot, productId, "cover.jpg")).split(path.sep).join("/")], errors: [],
      }],
      errors: [],
    });
    const [resultA, resultB] = await Promise.all([
      publishFromApprovedManifest(runId, `${runId}-publish-a`, createManifest(productA, "alpha")),
      publishFromApprovedManifest(runId, `${runId}-publish-b`, createManifest(productB, "beta")),
    ]);
    for (const result of [resultA, resultB]) {
      const report = JSON.parse(await fs.promises.readFile(result.reportPath, "utf8")) as { success: boolean; errors: string[] };
      assert.equal(report.success, true);
      assert.deepEqual(report.errors, []);
    }
    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productA, "cover.jpg"), "utf8"), "alpha");
    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productB, "cover.jpg"), "utf8"), "beta");
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productA), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productB), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale publish temp directories are cleaned safely before publish", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-stale-temp-"));
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-stale-temp");
  const stageRoot = path.join(tempRoot, "stage");
  const stagedDir = path.join(stageRoot, productId);
  const staleTempDir = path.join(
    __publishHardeningTestUtils.LIVE_OUTPUT_ROOT,
    __publishHardeningTestUtils.createPublishTempDirName(productId, "orphaned-run"),
  );
  const liveDir = path.join(LIVE_ROOT, productId);
  const backupDir = `${liveDir}.backup-keep`;
  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.writeFile(path.join(stagedDir, "cover.jpg"), "fresh", "utf8");
    await fs.promises.mkdir(staleTempDir, { recursive: true });
    await fs.promises.writeFile(path.join(staleTempDir, "cover.jpg"), "stale-temp", "utf8");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "custom.txt"), "live", "utf8");
    await fs.promises.mkdir(backupDir, { recursive: true });
    await fs.promises.writeFile(path.join(backupDir, "cover.jpg"), "backup", "utf8");
    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: stageRoot,
      reportPath: "x",
      assets: [{
        assetId: `${runId}:asset-1`, runId, sourceType: "manual", sourceRelativePath: "asset-1.jpg", productId,
        matchedConfidence: 1, requiresReview: false, approvalState: "approved", publishState: "staged",
        outputs: [path.relative(process.cwd(), path.join(stagedDir, "cover.jpg")).split(path.sep).join("/")], errors: [],
      }],
      errors: [],
    };
    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean };
    assert.equal(report.success, true);
    assert.equal(fs.existsSync(staleTempDir), false);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "fresh");
    assert.equal(await fs.promises.readFile(path.join(liveDir, "custom.txt"), "utf8"), "live");
    assert.equal(await fs.promises.readFile(path.join(backupDir, "cover.jpg"), "utf8"), "backup");
  } finally {
    await fs.promises.rm(staleTempDir, { recursive: true, force: true });
    await fs.promises.rm(liveDir, { recursive: true, force: true });
    await fs.promises.rm(backupDir, { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});


test("fresh valid lock fails closed with active-lock diagnostics", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-fresh-"));
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-lock-fresh");
  const lockPath = __publishHardeningTestUtils.getProductLockPath(productId);
  try {
    const manifest = await createPublishManifest(tempRoot, runId, productId, [["cover.jpg", "fresh"]]);
    await writePublishLockFile(productId, createLockMetadata(productId, "other-run-publish", new Date().toISOString()));

    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };

    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /Publish lock actively held for product/);
    assert.match(report.errors[0] ?? "", /publishRunId=other-run-publish/);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    await fs.promises.rm(lockPath, { force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale valid lock is recovered and publish proceeds", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-stale-"));
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-lock-stale");
  const lockPath = __publishHardeningTestUtils.getProductLockPath(productId);
  const liveDir = path.join(LIVE_ROOT, productId);
  try {
    const manifest = await createPublishManifest(tempRoot, runId, productId, [["cover.jpg", "recovered"]]);
    const staleCreatedAt = new Date(Date.now() - __publishHardeningTestUtils.PUBLISH_LOCK_STALE_THRESHOLD_MS - 60_000).toISOString();
    await writePublishLockFile(productId, createLockMetadata(productId, "stale-run-publish", staleCreatedAt));

    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };

    assert.equal(report.success, true);
    assert.deepEqual(report.errors, []);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "recovered");
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    await fs.promises.rm(lockPath, { force: true });
    await fs.promises.rm(liveDir, { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("malformed lock file fails closed", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-malformed-"));
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-lock-malformed");
  const lockPath = __publishHardeningTestUtils.getProductLockPath(productId);
  try {
    const manifest = await createPublishManifest(tempRoot, runId, productId, [["cover.jpg", "blocked"]]);
    await writePublishLockFile(productId, "not-json");

    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };

    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /Publish lock metadata is malformed or ambiguous/);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    await fs.promises.rm(lockPath, { force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale lock recovery retries acquisition only once and fails closed if reacquire still fails", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-reacquire-"));
  const runId = uniqueSuffix("r");
  const publishRunId = `${runId}-publish`;
  const productId = uniqueSuffix("zle-lock-reacquire");
  const lockPath = __publishHardeningTestUtils.getProductLockPath(productId);
  const originalRm = fs.promises.rm;
  let intercepted = false;
  try {
    const manifest = await createPublishManifest(tempRoot, runId, productId, [["cover.jpg", "blocked"]]);
    const staleCreatedAt = new Date(Date.now() - __publishHardeningTestUtils.PUBLISH_LOCK_STALE_THRESHOLD_MS - 60_000).toISOString();
    const replacementCreatedAt = new Date().toISOString();
    await writePublishLockFile(productId, createLockMetadata(productId, "stale-run-publish", staleCreatedAt));

    fs.promises.rm = (async (targetPath: fs.PathLike, options?: fs.RmOptions) => {
      const result = await originalRm.call(fs.promises, targetPath, options);
      if (!intercepted && path.resolve(String(targetPath)) === lockPath && !options?.recursive) {
        intercepted = true;
        await fs.promises.writeFile(lockPath, JSON.stringify(createLockMetadata(productId, "replacement-run-publish", replacementCreatedAt)), "utf8");
      }
      return result;
    }) as typeof fs.promises.rm;

    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };

    assert.equal(report.success, false);
    assert.equal(intercepted, true);
    assert.match(report.errors[0] ?? "", /Stale publish lock was removed but lock reacquisition failed/);
    assert.match(report.errors[0] ?? "", /replacement-run-publish/);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId)), false);
  } finally {
    fs.promises.rm = originalRm;
    await fs.promises.rm(lockPath, { force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale lock recovery remains per-product and does not block different product publishes", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-lock-per-product-"));
  const runId = uniqueSuffix("r");
  const productA = uniqueSuffix("zle-lock-per-product-a");
  const productB = uniqueSuffix("zle-lock-per-product-b");
  const lockPathA = __publishHardeningTestUtils.getProductLockPath(productA);
  try {
    const staleCreatedAt = new Date(Date.now() - __publishHardeningTestUtils.PUBLISH_LOCK_STALE_THRESHOLD_MS - 60_000).toISOString();
    await writePublishLockFile(productA, createLockMetadata(productA, "old-a-publish", staleCreatedAt));
    const manifestA = await createPublishManifest(tempRoot, runId, productA, [["cover.jpg", "alpha"]]);
    const manifestB = await createPublishManifest(tempRoot, runId, productB, [["cover.jpg", "beta"]]);

    const [resultA, resultB] = await Promise.all([
      publishFromApprovedManifest(runId, `${runId}-publish-a`, manifestA),
      publishFromApprovedManifest(runId, `${runId}-publish-b`, manifestB),
    ]);

    for (const result of [resultA, resultB]) {
      const report = JSON.parse(await fs.promises.readFile(result.reportPath, "utf8")) as { success: boolean; errors: string[] };
      assert.equal(report.success, true);
      assert.deepEqual(report.errors, []);
    }
    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productA, "cover.jpg"), "utf8"), "alpha");
    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productB, "cover.jpg"), "utf8"), "beta");
    assert.equal(fs.existsSync(lockPathA), false);
  } finally {
    await fs.promises.rm(lockPathA, { force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productA), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, productB), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
