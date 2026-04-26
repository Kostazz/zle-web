import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Product } from "@shared/schema";
import { canonicalizeCategory, isSupportedCategory, normalizeCategory, normalizeCategoryText } from "./category-normalization.ts";
import { deriveSizesFromOptionsRawStrict, mapPublishedItemToProduct, runImportTotalboardshopProducts } from "./import-totalboardshop-products.ts";
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

async function withLiveRoot<T>(fn: (liveRoot: string) => Promise<T>): Promise<T> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-category-live-"));
  try {
    const liveRoot = path.join(root, "client", "public", "images", "products");
    const liveDir = path.join(liveRoot, "new-product-a");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "cover-jpg", "utf8");
    return await fn(liveRoot);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

test("category text normalization removes diacritics, trims whitespace, and collapses separators", () => {
  assert.equal(normalizeCategoryText(" Kšiltovky "), "ksiltovky");
  assert.equal(normalizeCategoryText("Trička"), "tricka");
  assert.equal(normalizeCategoryText("Tryčka"), "trycka");
  assert.equal(normalizeCategoryText("Mikýny"), "mikyny");
  assert.equal(normalizeCategoryText("  trucker---hat  "), "trucker hat");
});

test("supported-category guard accepts only internal categories", () => {
  assert.equal(isSupportedCategory("tee"), true);
  assert.equal(isSupportedCategory("accessories"), true);
  assert.equal(isSupportedCategory("batoh"), false);
  assert.equal(isSupportedCategory(null), false);
});

test("Kšiltovky and cap-like synonyms map to cap", async () => {
  assert.equal(canonicalizeCategory("Kšiltovky"), "cap");
  assert.equal(canonicalizeCategory("snapbacky"), "cap");
  assert.equal(canonicalizeCategory("trucker hats"), "cap");

  await withLiveRoot(async (liveRoot) => {
    const mapped = mapPublishedItemToProduct(createSourceProduct("cap-fixture", {
      categoryRaw: "Kšiltovky",
      structured: { productType: "trucker hat", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    }), "new-product-a", liveRoot);
    assert.equal(mapped.category, "cap");
  });
});

test("Trička, Tryčka, and tee variants map to tee", async () => {
  assert.equal(canonicalizeCategory("Trička"), "tee");
  assert.equal(canonicalizeCategory("Tryčka"), "tee");
  assert.equal(canonicalizeCategory("t-shirts"), "tee");
  assert.equal(canonicalizeCategory("Tees"), "tee");

  await withLiveRoot(async (liveRoot) => {
    const mapped = mapPublishedItemToProduct(createSourceProduct("tee-fixture", {
      categoryRaw: "Trička",
      structured: { productType: "Tryčka", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    }), "new-product-a", liveRoot);
    assert.equal(mapped.category, "tee");
  });
});

test("Mikina, Mikyna, and hoodie variants map to hoodie", async () => {
  assert.equal(canonicalizeCategory("Mikina"), "hoodie");
  assert.equal(canonicalizeCategory("Mikyna"), "hoodie");
  assert.equal(canonicalizeCategory("hoodies"), "hoodie");

  await withLiveRoot(async (liveRoot) => {
    const mapped = mapPublishedItemToProduct(createSourceProduct("hoodie-fixture", {
      categoryRaw: "Mikina",
      structured: { productType: "Mikyna", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    }), "new-product-a", liveRoot);
    assert.equal(mapped.category, "hoodie");
  });
});

test("normalizer maps totalboardshop categoryRaw and productType values to required internal categories", () => {
  assert.equal(normalizeCategory({ categoryRaw: "Trička", productType: null, title: "Basic Tričko" }), "tee");
  assert.equal(normalizeCategory({ categoryRaw: "Mikiny", productType: null, title: "Heavy Mikina" }), "hoodie");
  assert.equal(normalizeCategory({ categoryRaw: null, productType: "mikina", title: "Core drop" }), "hoodie");
  assert.equal(normalizeCategory({ categoryRaw: "Kšiltovky", productType: null, title: "Snapback" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Ostatní doplňky", productType: null, title: "Pin pack" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Dětské", productType: null, title: "Kids logo tee" }), "tee");
});

test("beanie variants map correctly", async () => {
  assert.equal(canonicalizeCategory("Beanies"), "beanie");
  assert.equal(canonicalizeCategory("Kulichy"), "beanie");
  assert.equal(canonicalizeCategory("Zimní čepice"), "beanie");

  await withLiveRoot(async (liveRoot) => {
    const mapped = mapPublishedItemToProduct(createSourceProduct("beanie-fixture", {
      categoryRaw: "Kulichy",
      structured: { productType: "Zimní čepice", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    }), "new-product-a", liveRoot);
    assert.equal(mapped.category, "beanie");
  });
});

test("explicit non-hooded wording maps to crewneck only when clearly stated", async () => {
  assert.equal(canonicalizeCategory("sweatshirt"), "crewneck");
  assert.equal(canonicalizeCategory("Mikina bez kapuce"), "crewneck");

  await withLiveRoot(async (liveRoot) => {
    const mapped = mapPublishedItemToProduct(createSourceProduct("crew-fixture", {
      categoryRaw: "Mikina bez kapuce",
      structured: { productType: "sweatshirt", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
    }), "new-product-a", liveRoot);
    assert.equal(mapped.category, "crewneck");
  });
});

test("fallback from title maps tričko, mikina, and čepice/kšiltovka safely", () => {
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Oversized tričko black" }), "tee");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Classic Beanie black" }), "beanie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Kulich ZLE winter" }), "beanie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Zimní čepice core logo" }), "beanie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Heavyweight crewneck washed" }), "crewneck");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Mikina bez kapuce stone wash" }), "crewneck");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "ZLE zip mikina premium" }), "hoodie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Signature hoodie drop" }), "hoodie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Hoodie Tool" }), "hoodie");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Street Gear Tee" }), "tee");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Corduroy čepice limited" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Mesh kšiltovka logo" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Cap Gear" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Classic snapback black" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Foam trucker cap" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Trucker Tool" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Síťovka logo edition" }), "cap");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Metal klíčenka ZLE" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Nylon ledvinka utility" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "ZLE BAG" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "ZLE GEAR" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "ZLE TOOL" }), "accessories");
  assert.equal(normalizeCategory({ categoryRaw: "Neznámé", productType: null, title: "Mystery product" }), "tee");
});

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

test("derives apparel sizes from optionsRaw when sizes are empty", () => {
  assert.deepEqual(
    deriveSizesFromOptionsRawStrict(["Vyberte možnost", "XS", "S", "M", "L", "XL", "2XL", "3XL"]),
    ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
  );
});

test("strict parser removes placeholders and unknown noisy option values", () => {
  assert.deepEqual(
    deriveSizesFromOptionsRawStrict(["", "Vyberte možnost", "Velikost", "BLACK", "M", "Cotton", "L", "XYZ"]),
    ["M", "L"],
  );
});

test("cap-like options remain size-less when no valid size values exist", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-cap-sizeless-"));
  try {
    const liveRoot = path.join(root, "client", "public", "images", "products");
    const liveDir = path.join(liveRoot, "new-product-a");
    await fs.promises.mkdir(liveDir, { recursive: true });
    await fs.promises.writeFile(path.join(liveDir, "cover.jpg"), "cover-jpg", "utf8");

    const mapped = mapPublishedItemToProduct(createSourceProduct("cap-size-fixture", {
      categoryRaw: "Kšiltovky",
      structured: { productType: "cap", audience: null, lineNormalized: null, designNormalized: "fixture", colorTokens: ["black"] },
      sizes: [],
      optionsRaw: ["Vyberte možnost", "Black", "Red"],
    }), "new-product-a", liveRoot);
    assert.deepEqual(mapped.sizes, []);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("importer writes parsed sizes into product records when source sizes are empty", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-import-parsed-sizes-"));
  const runId = uniqueRunId("publish");
  const sourceRunId = uniqueRunId("source");
  try {
    const product = createSourceProduct(runId, {
      sizes: [],
      optionsRaw: ["Vyberte možnost", "S", "M", "L", "2XL", "3XL"],
    });
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

    assert.equal(result.products.length, 1);
    assert.deepEqual(result.products[0]?.sizes, ["S", "M", "L", "XXL", "XXXL"]);
    assert.deepEqual(writes[0]?.sizes, ["S", "M", "L", "XXL", "XXXL"]);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
