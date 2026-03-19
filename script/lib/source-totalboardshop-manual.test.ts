import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManualTrustedProductSnapshot, runTotalboardshopManualSourceAgent } from "./source-totalboardshop.ts";
import { runCurationAgent } from "./curation-agent.ts";

test("manual trusted snapshot emits compatible source artifacts for one product", async () => {
  const outputRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-manual-source-"));
  const runId = "tbs-manual-fixture";
  const inputPath = path.join(outputRoot, "manual-product.json");
  const snapshot = {
    sourceUrl: "https://totalboardshop.cz/obchod/panska-mikina-zle-abstract/",
    title: "Pánská mikina ZLE skateboards – Abstract (Black/khaki)",
    brand: "ZLE skateboarding",
    description: "Trusted manual snapshot for one reviewed pipeline run.",
    price: 1350,
    currency: "CZK",
    availability: "in_stock",
    category: "Mikiny",
    images: [
      "https://totalboardshop.cz/wp-content/uploads/2025/10/produktovka-mikina-black.jpg",
      "https://totalboardshop.cz/wp-content/uploads/2025/10/produktovka-mikina-black-detail.jpg",
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    variants: ["Black/khaki"],
  };
  await fs.promises.writeFile(inputPath, JSON.stringify(snapshot, null, 2), "utf8");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("manual path must not fetch");
  }) as typeof fetch;

  try {
    const result = await runTotalboardshopManualSourceAgent({
      runId,
      outputRoot,
      inputPath,
      snapshot,
    });

    assert.equal(result.productCount, 1);
    assert.equal(result.imageCount, 2);
    assert.equal(fetchCalls, 0);

    const dataset = JSON.parse(await fs.promises.readFile(result.datasetPath, "utf8")) as {
      mode: string;
      productCount: number;
      imageCount: number;
      sourceInput?: { type: string; operatorProvided: boolean; inputPath?: string };
    };
    const products = JSON.parse(await fs.promises.readFile(result.productsPath, "utf8")) as Array<{
      title: string;
      brandNormalized: string;
      categoryRaw: string;
      priceCzk: number | null;
      sizes: string[];
      optionsRaw: string[];
      imageUrls: string[];
      downloadedImages: string[];
    }>;
    const crawlLog = JSON.parse(await fs.promises.readFile(result.crawlLogPath, "utf8")) as {
      visitedPages: string[];
      mode?: string;
      trust?: { sourceType: string; operatorProvided: boolean; notes: string[]; inputPath?: string };
    };
    const audit = JSON.parse(await fs.promises.readFile(result.auditPath, "utf8")) as {
      sourceMode?: string;
      trust?: { sourceType: string; operatorProvided: boolean; notes: string[]; inputPath?: string };
    };

    assert.equal(dataset.mode, "manual-trusted-snapshot");
    assert.equal(dataset.productCount, 1);
    assert.equal(dataset.imageCount, 2);
    assert.deepEqual(dataset.sourceInput, {
      type: "manual-trusted",
      operatorProvided: true,
      inputPath,
    });

    assert.equal(products.length, 1);
    assert.equal(products[0]?.title, snapshot.title);
    assert.equal(products[0]?.brandNormalized, "zle");
    assert.equal(products[0]?.categoryRaw, snapshot.category);
    assert.equal(products[0]?.priceCzk, 1350);
    assert.deepEqual(products[0]?.sizes, snapshot.sizes);
    assert.deepEqual(products[0]?.optionsRaw, snapshot.variants);
    assert.deepEqual(products[0]?.imageUrls, snapshot.images);
    assert.deepEqual(products[0]?.downloadedImages, snapshot.images);

    assert.deepEqual(crawlLog.visitedPages, []);
    assert.equal(crawlLog.mode, "manual-trusted-snapshot");
    assert.deepEqual(crawlLog.trust, {
      sourceType: "manual-trusted",
      operatorProvided: true,
      inputPath,
      notes: [
        "Operator-provided local trusted snapshot used instead of live crawl.",
        "No network fetch was attempted in this manual-source path.",
      ],
    });
    assert.equal(audit.sourceMode, "manual-trusted-snapshot");
    assert.deepEqual(audit.trust, crawlLog.trust);

    const curationOutputDir = path.join(outputRoot, "curation");
    const indexPath = path.join(outputRoot, "catalog-index.json");
    const curation = await runCurationAgent({
      runId,
      mode: "bootstrap-replacement",
      outputDir: curationOutputDir,
      sourceRoot: outputRoot,
      indexPath,
    });
    assert.equal(curation.report.summary.totalItems, 1);
    assert.equal(curation.report.sourceRunId, runId);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(outputRoot, { recursive: true, force: true });
  }
});

test("manual trusted snapshot validation fails closed for invalid operator input", async () => {
  assert.throws(
    () => parseManualTrustedProductSnapshot(JSON.stringify({
      sourceUrl: "https://example.com/not-allowlisted",
      title: "Bad product",
      brand: "ZLE",
      description: "bad",
      price: 100,
      currency: "CZK",
      availability: "in_stock",
      category: "Mikiny",
      images: [],
    })),
    /Non-allowlisted host blocked|images must contain at least one URL/,
  );

  assert.throws(
    () => parseManualTrustedProductSnapshot("{not-json}"),
    /invalid manual snapshot JSON/,
  );
});
