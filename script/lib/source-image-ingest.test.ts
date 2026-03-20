import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { runTotalboardshopSourceIngest } from "../ingest-totalboardshop-source.ts";
import { runApprovedStagingExecutor } from "./staging-review-executor.ts";
import { createSourceProductKey } from "./tbs-parser.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./source-dataset.ts";

function uniqueRunId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function createImageBuffer(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 12, height: 12, channels: 3, background: color },
  }).jpeg().toBuffer();
}

async function writeSourceFixture(runId: string, products: SourceProductRecord[]): Promise<void> {
  const runDir = path.join(process.cwd(), "tmp", "source-datasets", runId);
  const dataset: SourceDatasetManifest = {
    runId,
    source: "totalboardshop",
    sourceRoot: "https://totalboardshop.cz/",
    createdAt: new Date().toISOString(),
    mode: "manual-trusted-snapshot",
    scope: { brand: "ZLE", matchMode: "exact" },
    productCount: products.length,
    imageCount: products.reduce((sum, product) => sum + product.imageUrls.length, 0),
    productsPath: "products.json",
    crawlLogPath: "crawl-log.json",
    auditPath: "audit.json",
    imagesPath: "images",
  };
  await fs.promises.mkdir(runDir, { recursive: true });
  await fs.promises.writeFile(path.join(runDir, "dataset.json"), JSON.stringify(dataset, null, 2), "utf8");
  await fs.promises.writeFile(path.join(runDir, "products.json"), JSON.stringify(products, null, 2), "utf8");
  await fs.promises.writeFile(path.join(runDir, "crawl-log.json"), JSON.stringify({ seedUrls: [], visitedPages: [], skippedUrls: [], skippedProducts: [], skippedProductSummary: {}, downloadErrors: [], limits: { maxPages: 1, maxProducts: 1, maxImagesPerProduct: 8, maxImageBytes: 8000000 } }, null, 2), "utf8");
  await fs.promises.writeFile(path.join(runDir, "audit.json"), JSON.stringify({ runId }, null, 2), "utf8");
}

function createProduct(runId: string, imageUrls: string[]): SourceProductRecord {
  const sourceSlug = `mikina-zle-${runId}`;
  return {
    sourceProductKey: createSourceProductKey(sourceSlug),
    sourceUrl: `https://totalboardshop.cz/produkt/${sourceSlug}`,
    sourceSlug,
    title: `ZLE ${runId}`,
    brandRaw: "ZLE",
    brandNormalized: "zle",
    categoryRaw: "Mikiny",
    tagRaw: null,
    priceText: "1 290 Kč",
    priceCzk: 1290,
    optionsRaw: [],
    sizes: ["M"],
    descriptionRaw: "fixture",
    structured: { productType: "mikina", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    imageUrls,
    downloadedImages: [...imageUrls],
    downloadedImageHashes: [],
    fingerprint: "fixture",
  };
}

test("ingest downloads remote images into trusted local root and updates source artifacts deterministically", async () => {
  const runId = uniqueRunId("ingest");
  const imageA = await createImageBuffer({ r: 11, g: 22, b: 33 });
  const imageB = await createImageBuffer({ r: 44, g: 55, b: 66 });
  const imageMap = new Map([
    ["https://totalboardshop.cz/wp-content/uploads/a.jpg", imageA],
    ["https://totalboardshop.cz/wp-content/uploads/b.jpg", imageB],
  ]);
  await writeSourceFixture(runId, [createProduct(runId, [...imageMap.keys()])]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo | undefined) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : "";
    const body = imageMap.get(url);
    if (!body) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;

  try {
    const first = await runTotalboardshopSourceIngest({ runId, validateOnly: false });
    const second = await runTotalboardshopSourceIngest({ runId, validateOnly: false });
    assert.equal(first.downloadedImageCount, 2);
    assert.equal(second.downloadedImageCount, 2);
    const products = JSON.parse(await fs.promises.readFile(path.join("tmp", "source-datasets", runId, "products.json"), "utf8")) as SourceProductRecord[];
    assert.deepEqual(products[0]?.ingestedImagePaths, [
      `tmp/source-images/${runId}/${products[0]?.sourceProductKey}/01.jpg`,
      `tmp/source-images/${runId}/${products[0]?.sourceProductKey}/02.jpg`,
    ]);
    assert.equal(products[0]?.downloadedImages[0], "https://totalboardshop.cz/wp-content/uploads/a.jpg");
    assert.equal(products[0]?.downloadedImageHashes.length, 2);
    assert.equal(fs.existsSync(path.join("tmp", "source-images", runId, products[0]!.sourceProductKey, "01.jpg")), true);
    assert.equal(fs.existsSync(path.join("tmp", "source-images", runId, "image-manifest.json")), true);
    assert.deepEqual(first.products[0]?.ingestedImagePaths, second.products[0]?.ingestedImagePaths);
    assert.deepEqual(first.products[0]?.downloadedImageHashes, second.products[0]?.downloadedImageHashes);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(path.join("tmp", "source-datasets", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-images", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-images", `${runId}.ingest.json`), { force: true });
    await fs.promises.rm(path.join("tmp", "source-images", `${runId}.summary.md`), { force: true });
  }
});

test("ingest fails closed for malformed or forbidden image urls and prevents writes outside allowed roots", async () => {
  const runId = uniqueRunId("ingest-bad");
  await writeSourceFixture(runId, [createProduct(runId, ["https://evil.example.com/nope.jpg"])]);
  await assert.rejects(
    runTotalboardshopSourceIngest({ runId, validateOnly: false }),
    /Non-allowlisted host blocked/,
  );
  assert.equal(fs.existsSync(path.join("tmp", "source-images", runId)), false);

  const traversalRunId = uniqueRunId("ingest-traversal");
  const traversalProduct = createProduct(traversalRunId, ["https://totalboardshop.cz/wp-content/uploads/a.jpg"]);
  traversalProduct.sourceProductKey = "../escape";
  await writeSourceFixture(traversalRunId, [traversalProduct]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(await createImageBuffer({ r: 1, g: 2, b: 3 }), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  try {
    await assert.rejects(
      runTotalboardshopSourceIngest({ runId: traversalRunId, validateOnly: false }),
      /outside allowed root/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(path.join("tmp", "source-datasets", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-datasets", traversalRunId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-images", traversalRunId), { recursive: true, force: true });
  }
});

test("reviewed staging consumes ingested local paths and still rejects remote-only source image paths", async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ingest-stage-"));
  const runId = uniqueRunId("stage-ingested");
  const remoteOnlyRunId = uniqueRunId("stage-remote-only");
  const product = createProduct(runId, ["https://totalboardshop.cz/wp-content/uploads/a.jpg"]);
  await writeSourceFixture(runId, [product]);
  const curationDir = path.join(tmpRoot, "curation");
  const reviewDir = path.join(tmpRoot, "review");
  const stagingDir = path.join(process.cwd(), "tmp", "agent-staging");
  const manifestDir = path.join(process.cwd(), "tmp", "agent-manifests");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(await createImageBuffer({ r: 9, g: 9, b: 9 }), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;

  try {
    await assert.rejects(
      runApprovedStagingExecutor({
        runId,
        reviewRunId: runId,
        sourceRoot: path.join(process.cwd(), "tmp", "source-datasets"),
        curationDir,
        reviewDir,
        outputDir: stagingDir,
        manifestDir,
      }),
      /Missing required artifact/,
    );

    await runTotalboardshopSourceIngest({ runId, validateOnly: false });
    await fs.promises.mkdir(curationDir, { recursive: true });
    await fs.promises.mkdir(reviewDir, { recursive: true });
    await fs.promises.writeFile(path.join(curationDir, `${runId}.curation.json`), JSON.stringify({
      runId,
      sourceRunId: runId,
      createdAt: new Date().toISOString(),
      mode: "bootstrap-replacement",
      summary: { totalItems: 1, acceptedCandidates: 1, reviewRequired: 0, rejected: 0, deterministicMatches: 0, proposedNewCandidates: 1, malformedRejected: 0 },
      items: [{
        sourceProductKey: product.sourceProductKey,
        sourceUrl: product.sourceUrl,
        title: product.title,
        brandNormalized: "zle",
        categoryRaw: product.categoryRaw,
        structured: product.structured,
        priceCzk: product.priceCzk,
        sizes: product.sizes,
        imageCount: 1,
        proposedLocalProductId: null,
        reconciliation: "ACCEPT",
        delta: "NEW",
        curationDecision: "ACCEPT_CANDIDATE",
        reasonCodes: ["accepted_valid_new_candidate"],
        requiresHumanReview: false,
        fingerprints: { identityFingerprint: "a", contentFingerprint: "b", imageFingerprint: "c" },
      }],
    }, null, 2), "utf8");
    await fs.promises.writeFile(path.join(reviewDir, `${runId}.review.json`), JSON.stringify({
      runId,
      createdAt: new Date().toISOString(),
      sourceRunId: runId,
      decisions: [{ sourceProductKey: product.sourceProductKey, decision: "approved", resolutionType: "new_candidate" }],
    }, null, 2), "utf8");

    const staged = await runApprovedStagingExecutor({
      runId,
      reviewRunId: runId,
      sourceRoot: path.join(process.cwd(), "tmp", "source-datasets"),
      curationDir,
      reviewDir,
      outputDir: stagingDir,
      manifestDir,
      validateOnly: false,
    });
    assert.equal(staged.report.summary.stagedItems, 1);

    await writeSourceFixture(remoteOnlyRunId, [createProduct(remoteOnlyRunId, ["https://totalboardshop.cz/wp-content/uploads/remote.jpg"])]);
    await fs.promises.writeFile(path.join(curationDir, `${remoteOnlyRunId}.curation.json`), JSON.stringify({
      runId: remoteOnlyRunId, sourceRunId: remoteOnlyRunId, createdAt: new Date().toISOString(), mode: "bootstrap-replacement",
      summary: { totalItems: 1, acceptedCandidates: 1, reviewRequired: 0, rejected: 0, deterministicMatches: 0, proposedNewCandidates: 1, malformedRejected: 0 },
      items: [{ sourceProductKey: createProduct(remoteOnlyRunId, ["https://totalboardshop.cz/wp-content/uploads/remote.jpg"]).sourceProductKey, sourceUrl: `https://totalboardshop.cz/produkt/mikina-zle-${remoteOnlyRunId}`, title: `ZLE ${remoteOnlyRunId}`, brandNormalized: "zle", categoryRaw: "Mikiny", structured: { productType: "mikina", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] }, priceCzk: 1290, sizes: ["M"], imageCount: 1, proposedLocalProductId: null, reconciliation: "ACCEPT", delta: "NEW", curationDecision: "ACCEPT_CANDIDATE", reasonCodes: ["accepted_valid_new_candidate"], requiresHumanReview: false, fingerprints: { identityFingerprint: "a", contentFingerprint: "b", imageFingerprint: "c" } }],
    }, null, 2), "utf8");
    await fs.promises.writeFile(path.join(reviewDir, `${remoteOnlyRunId}.review.json`), JSON.stringify({
      runId: remoteOnlyRunId, createdAt: new Date().toISOString(), sourceRunId: remoteOnlyRunId,
      decisions: [{ sourceProductKey: createProduct(remoteOnlyRunId, ["https://totalboardshop.cz/wp-content/uploads/remote.jpg"]).sourceProductKey, decision: "approved", resolutionType: "new_candidate" }],
    }, null, 2), "utf8");
    await assert.rejects(
      runApprovedStagingExecutor({
        runId: remoteOnlyRunId,
        reviewRunId: remoteOnlyRunId,
        sourceRoot: path.join(process.cwd(), "tmp", "source-datasets"),
        curationDir,
        reviewDir,
        outputDir: stagingDir,
        manifestDir,
      }),
      /Source image path escapes images root/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(path.join("tmp", "source-datasets", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-datasets", remoteOnlyRunId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-images", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "source-images", `${runId}.ingest.json`), { force: true });
    await fs.promises.rm(path.join("tmp", "source-images", `${runId}.summary.md`), { force: true });
    await fs.promises.rm(path.join("tmp", "agent-staging", runId), { recursive: true, force: true });
    await fs.promises.rm(path.join("tmp", "agent-manifests", `${runId}.staging.json`), { force: true });
    await fs.promises.rm(path.join("tmp", "agent-manifests", `${runId}.staging-summary.md`), { force: true });
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});
