import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Product } from "@shared/schema";
import { mapPublishedItemToProduct, runImportTotalboardshopProducts } from "./import-totalboardshop-products.ts";
import type { SourceProductRecord } from "./source-dataset.ts";

function uniqueRunId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

function createSourceProduct(runId: string, overrides: Partial<SourceProductRecord> = {}): SourceProductRecord {
  return {
    sourceProductKey: `source-${runId}`,
    sourceUrl: `https://totalboardshop.cz/produkt/${runId}`,
    sourceSlug: runId,
    title: `ZLE ${runId}`,
    brandRaw: "ZLE",
    brandNormalized: "zle",
    categoryRaw: "Mikiny",
    tagRaw: null,
    priceText: "1 290 Kč",
    priceCzk: 1290,
    optionsRaw: [],
    sizes: ["M", "L"],
    descriptionRaw: "Fixture description",
    structured: { productType: "mikina", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    imageUrls: ["https://totalboardshop.cz/wp-content/uploads/cover.jpg"],
    downloadedImages: ["https://totalboardshop.cz/wp-content/uploads/cover.jpg"],
    downloadedImageHashes: [],
    fingerprint: "fixture",
    ...overrides,
  };
}

async function writeFixture(root: string, runId: string, sourceRunId: string, products: SourceProductRecord[]): Promise<{ reportRoot: string; sourceRoot: string; liveRoot: string; writes: Product[] }> {
  const reportRoot = path.join(root, "tmp", "publish-reports");
  const sourceRoot = path.join(root, "tmp", "source-datasets");
  const liveRoot = path.join(root, "client", "public", "images", "products");
  const writes: Product[] = [];

  await fs.promises.mkdir(reportRoot, { recursive: true });
  await fs.promises.mkdir(path.join(sourceRoot, sourceRunId), { recursive: true });
  await fs.promises.mkdir(liveRoot, { recursive: true });

  const report = {
    runId,
    sourceRunId,
    reviewRunId: runId,
    stagingRunId: runId,
    gateRunId: runId,
    createdAt: new Date().toISOString(),
    summary: {
      totalGateItems: 2,
      readyForPublish: 2,
      published: 2,
      failed: 0,
      skipped: 0,
      mappedToExisting: 1,
      newCandidatePublished: 1,
    },
    items: [
      {
        sourceProductKey: products[0]?.sourceProductKey ?? "missing-a",
        resolutionType: "new_candidate",
        approvedLocalProductId: null,
        liveTargetKey: "new-product-a",
        plannedOutputs: [],
        publishedOutputs: [],
        removedManagedOutputs: [],
        status: "published",
        reasonCodes: [],
      },
      {
        sourceProductKey: "mapped-existing",
        resolutionType: "map_to_existing",
        approvedLocalProductId: "legacy-1",
        liveTargetKey: "legacy-1",
        plannedOutputs: [],
        publishedOutputs: [],
        removedManagedOutputs: [],
        status: "published",
        reasonCodes: [],
      },
    ],
  };

  await fs.promises.writeFile(path.join(reportRoot, `${runId}.publish.json`), JSON.stringify(report, null, 2), "utf8");
  await fs.promises.writeFile(path.join(sourceRoot, sourceRunId, "products.json"), JSON.stringify(products, null, 2), "utf8");

  const liveDir = path.join(liveRoot, "new-product-a");
  await fs.promises.mkdir(liveDir, { recursive: true });
  await fs.promises.writeFile(path.join(liveDir, "cover.webp"), "cover-webp", "utf8");
  await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "cover-jpg", "utf8");
  await fs.promises.writeFile(path.join(liveDir, "01.webp"), "01-webp", "utf8");
  await fs.promises.writeFile(path.join(liveDir, "01.jpg"), "01-jpg", "utf8");
  await fs.promises.writeFile(path.join(liveDir, "02.webp"), "02-webp", "utf8");

  return { reportRoot, sourceRoot, liveRoot, writes };
}

test("imports only published new_candidate items and skips map_to_existing items", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-"));
  const runId = uniqueRunId("publish");
  const sourceRunId = uniqueRunId("source");
  try {
    const product = createSourceProduct(runId);
    const { reportRoot, sourceRoot, liveRoot, writes } = await writeFixture(root, runId, sourceRunId, [product]);

    const result = await runImportTotalboardshopProducts({
      runId,
      reportRoot,
      sourceRoot,
      liveImageRoot: liveRoot,
      productWriter: {
        async upsertProduct(dbProduct) {
          writes.push(dbProduct);
          return { action: "inserted", product: dbProduct };
        },
      },
      logger: { log() {}, error() {} },
    });

    assert.equal(result.summary.totalPublishedItems, 2);
    assert.equal(result.summary.importedNewCandidateItems, 1);
    assert.equal(result.summary.skippedItems, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.id, "new-product-a");
    assert.equal(writes[0]?.productModel, "new");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("fails closed on missing publish artifact", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-missing-report-"));
  try {
    await assert.rejects(
      runImportTotalboardshopProducts({
        runId: uniqueRunId("missing-report"),
        reportRoot: path.join(root, "tmp", "publish-reports"),
        sourceRoot: path.join(root, "tmp", "source-datasets"),
        liveImageRoot: path.join(root, "client", "public", "images", "products"),
        productWriter: { async upsertProduct(product) { return { action: "inserted", product }; } },
        logger: { log() {}, error() {} },
      }),
      /Missing required artifact: publish report/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("fails closed on missing source product match", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-missing-source-"));
  const runId = uniqueRunId("publish");
  const sourceRunId = uniqueRunId("source");
  try {
    const { reportRoot, sourceRoot, liveRoot } = await writeFixture(root, runId, sourceRunId, []);
    await assert.rejects(
      runImportTotalboardshopProducts({
        runId,
        reportRoot,
        sourceRoot,
        liveImageRoot: liveRoot,
        productWriter: { async upsertProduct(product) { return { action: "inserted", product }; } },
        logger: { log() {}, error() {} },
      }),
      /Missing source product match/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("maps deterministic image paths with jpg preference", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-images-"));
  try {
    const source = createSourceProduct("image-fixture");
    const liveRoot = path.join(root, "client", "public", "images", "products");
    const liveDir = path.join(liveRoot, "new-product-a");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.webp"), "cover-webp", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "cover-jpg", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "01.webp"), "01-webp", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "01.jpg"), "01-jpg", "utf8");
    await fs.promises.writeFile(path.join(liveDir, "02.webp"), "02-webp", "utf8");

    const mapped = mapPublishedItemToProduct(source, "new-product-a", liveRoot);
    assert.equal(mapped.image, "/images/products/new-product-a/cover.jpg");
    assert.deepEqual(mapped.images, [
      "/images/products/new-product-a/cover.jpg",
      "/images/products/new-product-a/01.jpg",
      "/images/products/new-product-a/02.webp",
    ]);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("unsupported categories fail closed with detailed source category context", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-category-"));
  try {
    const source = createSourceProduct("category-fixture", {
      categoryRaw: "Batohy",
      structured: { productType: "batoh", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    });
    const liveRoot = path.join(root, "client", "public", "images", "products");
    const liveDir = path.join(liveRoot, "new-product-a");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "cover-jpg", "utf8");

    assert.throws(
      () => mapPublishedItemToProduct(source, "new-product-a", liveRoot),
      /Unsupported catalog category for source-category-fixture: categoryRaw="Batohy" productType="batoh"/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("idempotent rerun behavior updates the same product id safely", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-idempotent-"));
  const runId = uniqueRunId("publish");
  const sourceRunId = uniqueRunId("source");
  try {
    const product = createSourceProduct(runId);
    const { reportRoot, sourceRoot, liveRoot } = await writeFixture(root, runId, sourceRunId, [product]);
    const store = new Map<string, Product>();

    const writer = {
      async upsertProduct(dbProduct: Product) {
        const action = store.has(dbProduct.id) ? "updated" as const : "inserted" as const;
        store.set(dbProduct.id, dbProduct);
        return { action, product: dbProduct };
      },
    };

    const first = await runImportTotalboardshopProducts({ runId, reportRoot, sourceRoot, liveImageRoot: liveRoot, productWriter: writer, logger: { log() {}, error() {} } });
    const second = await runImportTotalboardshopProducts({ runId, reportRoot, sourceRoot, liveImageRoot: liveRoot, productWriter: writer, logger: { log() {}, error() {} } });

    assert.equal(first.summary.inserted, 1);
    assert.equal(first.summary.updated, 0);
    assert.equal(second.summary.inserted, 0);
    assert.equal(second.summary.updated, 1);
    assert.equal(store.size, 1);
    assert.equal(store.get("new-product-a")?.name, product.title);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
