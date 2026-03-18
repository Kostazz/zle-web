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
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };
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
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };
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
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /simulated swap failure/);
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

    fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
      renameCount += 1;
      if (renameCount === 2) {
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
    const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8")) as { success: boolean; errors: string[] };
    assert.equal(report.success, false);
    assert.match(report.errors[0] ?? "", /anomalous state/);
    assert.equal(await fs.promises.readFile(path.join(liveDir, "cover.jpg"), "utf8"), "unexpected");
  } finally {
    fs.promises.rename = originalRename;
    await fs.promises.rm(path.join(LIVE_ROOT, productId), { recursive: true, force: true });
    await fs.promises.rm(path.join(LIVE_ROOT, `${productId}.backup-${publishRunId}`), { recursive: true, force: true });
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
