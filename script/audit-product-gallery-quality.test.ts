import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  auditProducts,
  closeDbPoolSafely,
  detectBrandLogoByPath,
  detectSizeChartByPath,
  inferLogoCoverFromSignals,
  inferSizeChartFromSignals,
  resolveLocalProductAssetPath,
} from "./audit-product-gallery-quality.ts";
import type { Product } from "@shared/schema";

function productFixture(overrides: Partial<Product>): Product {
  return {
    id: "p-1",
    name: "Fixture",
    price: 1000,
    sizes: ["M"],
    image: "/images/products/p-1/cover.jpg",
    images: ["/images/products/p-1/cover.jpg", "/images/products/p-1/01.jpg"],
    category: "tee",
    description: "Fixture",
    stock: 10,
    isActive: true,
    productModel: null,
    unitCost: null,
    stockOwner: null,
    pricingMode: null,
    pricingPercent: null,
    ...overrides,
  };
}

test("detectSizeChartByPath uses conservative filename hints", () => {
  assert.equal(detectSizeChartByPath("/images/products/abc/size-chart.png").hit, true);
  assert.equal(detectSizeChartByPath("/images/products/abc/front-model.jpg").hit, false);
});

test("detectBrandLogoByPath requires logo hint without product-view hint", () => {
  assert.equal(detectBrandLogoByPath("/images/products/abc/logo-only.jpg").hit, true);
  assert.equal(detectBrandLogoByPath("/images/products/abc/logo-front-tee.jpg").hit, false);
});

test("signal-based size-chart heuristic can detect chart-like covers with generic filenames", () => {
  const result = inferSizeChartFromSignals({
    width: 1200,
    height: 1400,
    aspectRatio: 1200 / 1400,
    whiteRatio: 0.82,
    darkRatio: 0.02,
    edgeDensity: 0.19,
    colorfulness: 0.08,
  });
  assert.equal(result.hit, true);
});

test("signal-based logo-cover heuristic can detect sparse brand-only candidate with generic filename", () => {
  const result = inferLogoCoverFromSignals({
    width: 1400,
    height: 1400,
    aspectRatio: 1,
    whiteRatio: 0.88,
    darkRatio: 0.01,
    edgeDensity: 0.08,
    colorfulness: 0.05,
  });
  assert.equal(result.hit, true);
});

test("auditProducts flags low-count and suspicious cover findings and tracks manual review", () => {
  const audited = auditProducts([
    productFixture({
      id: "tee-low",
      category: "tee",
      image: "/images/products/tee-low/size-chart.jpg",
      images: ["/images/products/tee-low/size-chart.jpg"],
    }),
    productFixture({
      id: "hoodie-ok",
      category: "hoodie",
      images: [
        "/images/products/hoodie-ok/cover.jpg",
        "/images/products/hoodie-ok/01.jpg",
        "/images/products/hoodie-ok/measurement-chart.jpg",
      ],
      image: "/images/products/hoodie-ok/cover.jpg",
    }),
  ]);

  assert.equal(audited.counts.products, 2);
  assert.ok(audited.findings.some((f) => f.productId === "tee-low" && f.code === "single_image_product"));
  assert.ok(audited.findings.some((f) => f.productId === "tee-low" && f.code === "possible_size_chart_cover"));
  assert.ok(audited.findings.some((f) => f.productId === "hoodie-ok" && f.code === "possible_size_chart_in_gallery"));
  assert.deepEqual(audited.productsNeedingManualReview, ["tee-low"]);
  assert.equal(audited.galleryImageCountByCategory.tee["1"], 1);
});

test("auditProducts uses pixel-signal evidence for generic 'cover.jpg' names", () => {
  const imagePath = "/images/products/signal-cover/cover.jpg";
  const signals = new Map([
    [
      imagePath,
      {
        width: 1400,
        height: 1600,
        aspectRatio: 1400 / 1600,
        whiteRatio: 0.8,
        darkRatio: 0.01,
        edgeDensity: 0.2,
        colorfulness: 0.07,
      },
    ],
  ]);

  const audited = auditProducts(
    [
      productFixture({
        id: "signal-cover",
        category: "hoodie",
        image: imagePath,
        images: [imagePath, "/images/products/signal-cover/01.jpg", "/images/products/signal-cover/02.jpg"],
      }),
    ],
    { imageSignalsByPath: signals },
  );

  assert.ok(audited.findings.some((f) => f.code === "possible_size_chart_cover" && f.productId === "signal-cover"));
});

test("resolveLocalProductAssetPath resolves client/public product asset path", async () => {
  const rel = path.join("client", "public", "images", "products", "path-test-a", "cover.jpg");
  await fs.promises.mkdir(path.dirname(rel), { recursive: true });
  await fs.promises.writeFile(rel, "x", "utf8");
  try {
    const resolved = resolveLocalProductAssetPath("/images/products/path-test-a/cover.jpg");
    assert.equal(resolved, path.resolve(rel));
  } finally {
    await fs.promises.rm(path.join("client", "public", "images", "products", "path-test-a"), { recursive: true, force: true });
  }
});

test("resolveLocalProductAssetPath resolves public product asset path", async () => {
  const rel = path.join("public", "images", "products", "path-test-b", "cover.jpg");
  await fs.promises.mkdir(path.dirname(rel), { recursive: true });
  await fs.promises.writeFile(rel, "x", "utf8");
  try {
    const resolved = resolveLocalProductAssetPath("/images/products/path-test-b/cover.jpg");
    assert.equal(resolved, path.resolve(rel));
  } finally {
    await fs.promises.rm(path.join("public", "images", "products", "path-test-b"), { recursive: true, force: true });
  }
});

test("resolveLocalProductAssetPath rejects traversal and non-product web paths", () => {
  assert.equal(resolveLocalProductAssetPath("/images/products/../escape/cover.jpg"), null);
  assert.equal(resolveLocalProductAssetPath("/images/other/path.jpg"), null);
});

test("closeDbPoolSafely does not throw when DB import/cleanup is unavailable", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.doesNotReject(closeDbPoolSafely());
  } finally {
    if (typeof original === "string") process.env.DATABASE_URL = original;
  }
});
