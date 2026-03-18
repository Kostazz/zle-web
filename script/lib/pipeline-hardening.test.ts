import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSourceProductKey } from "./tbs-parser.ts";
import { safeFetchBinary, type FetchLimits } from "./fetch-utils.ts";
import { publishFromApprovedManifest } from "./pipeline-runner.ts";
import type { RunManifest } from "./ingest-manifest.ts";

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

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  const limits: FetchLimits = {
    timeoutMs: 2000,
    maxHtmlBytes: 20,
    maxImageBytes: 20,
    minDelayMs: 0,
    maxDelayMs: 0,
  };

  try {
    await assert.rejects(safeFetchBinary("https://totalboardshop.cz/test", limits, "html"), /Payload too large/);
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
      outputDir: "x",
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
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; publishedOutputs: number };
    assert.equal(report.success, true);
    assert.equal(report.publishedOutputs, 1);

    const publishedApproved = path.join(LIVE_ROOT, productId, "cover.jpg");
    const publishedUnapproved = path.join(LIVE_ROOT, productId, "extra.jpg");
    assert.equal(fs.existsSync(publishedApproved), true);
    assert.equal(fs.existsSync(publishedUnapproved), false);

    const publishManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as { assets: Array<{ publishedOutputs: string[] }> };
    assert.equal(publishManifest.assets.length, 1);
    assert.equal(publishManifest.assets[0]?.publishedOutputs.length, 1);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish removes stale managed outputs but preserves unrelated files in touched product", async () => {
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

    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "cover.jpg"), "old-cover", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "01.jpg"), "old-01", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "02.jpg"), "stale-02", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "README.txt"), "keep-me", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, untouchedProductId, "cover.jpg"), "untouched", "utf8");

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
      outputDir: "x",
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

    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "cover.jpg")), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "01.jpg")), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "02.jpg")), false);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, productId, "README.txt")), true);
    assert.equal(fs.existsSync(path.join(LIVE_ROOT, untouchedProductId, "cover.jpg")), true);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, untouchedProductId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("publish failure does not expose partial mixed live state", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "publish-atomic-"));
  const runId = `r-${Date.now()}`;
  const publishRunId = `${runId}-publish`;
  const productId = `zle-atomic-${Date.now()}`;
  const stagedDir = path.join(tempRoot, "stage", productId);

  try {
    await fs.promises.mkdir(stagedDir, { recursive: true });
    await fs.promises.mkdir(path.join(LIVE_ROOT, productId), { recursive: true });
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "cover.jpg"), "live-cover", "utf8");
    await fs.promises.writeFile(path.join(LIVE_ROOT, productId, "01.jpg"), "live-01", "utf8");

    const stagedCover = path.join(stagedDir, "cover.jpg");
    const staged01 = path.join(stagedDir, "01.jpg");
    await fs.promises.writeFile(stagedCover, "next-cover", "utf8");
    // intentionally missing staged01 to force failure before swap

    const manifest: RunManifest = {
      runId,
      sourceType: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalState: "approved",
      publishState: "staged",
      requiresReview: false,
      inputDir: "x",
      outputDir: "x",
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
            path.relative(process.cwd(), stagedCover).split(path.sep).join("/"),
            path.relative(process.cwd(), staged01).split(path.sep).join("/"),
          ],
          errors: [],
        },
      ],
      errors: [],
    };

    const { reportPath } = await publishFromApprovedManifest(runId, publishRunId, manifest);
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };
    assert.equal(report.success, false);
    assert.ok(report.errors.some((entry) => entry.includes("Missing staged output")));

    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productId, "cover.jpg"), "utf8"), "live-cover");
    assert.equal(await fs.promises.readFile(path.join(LIVE_ROOT, productId, "01.jpg"), "utf8"), "live-01");
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
