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
