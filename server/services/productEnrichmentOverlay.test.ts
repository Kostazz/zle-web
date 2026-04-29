import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Product } from "@shared/schema";
import {
  __resetProductEnrichmentManifestCacheForTests,
  loadProductEnrichmentManifest,
  toPublicProduct,
} from "./productEnrichmentOverlay.ts";

const baseProduct: Product = {
  id: "p-1",
  name: "DB Name",
  price: 999,
  sizes: ["M"],
  image: "/images/products/p-1/cover.jpg",
  images: ["/images/products/p-1/01.jpg"],
  category: "tees",
  description: "DB Description",
  stock: 4,
  isActive: true,
  productModel: "legacy",
  unitCost: "100.00",
  stockOwner: "ZLE",
  pricingMode: "fixed",
  pricingPercent: "0.00",
};

async function withTempManifest(content: string): Promise<{ tempDir: string; manifestPath: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zle-enrichment-test-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  await fs.writeFile(manifestPath, content, "utf8");
  return { tempDir, manifestPath };
}

test("product without enrichment returns DB name/description", () => {
  const publicProduct = toPublicProduct(baseProduct);
  assert.equal(publicProduct.name, "DB Name");
  assert.equal(publicProduct.description, "DB Description");
});

test("displayName and description overrides", () => {
  const publicProduct = toPublicProduct(baseProduct, {
    displayName: "Public Name",
    description: "Public Description",
  });
  assert.equal(publicProduct.name, "Public Name");
  assert.equal(publicProduct.description, "Public Description");
});

test("enrichment optional fields are exposed when present", () => {
  const publicProduct = toPublicProduct(baseProduct, {
    material: "Cotton",
    dimensions: "10x20",
    seoTitle: "SEO Title",
    seoDescription: "SEO Description",
    badges: ["new"],
    tags: ["street"],
  });
  assert.equal(publicProduct.material, "Cotton");
  assert.equal(publicProduct.dimensions, "10x20");
  assert.equal(publicProduct.seoTitle, "SEO Title");
  assert.equal(publicProduct.seoDescription, "SEO Description");
  assert.deepEqual(publicProduct.badges, ["new"]);
  assert.deepEqual(publicProduct.tags, ["street"]);
});

test("partial enrichment keeps fallback fields", () => {
  const publicProduct = toPublicProduct(baseProduct, { displayName: "Only Name" });
  assert.equal(publicProduct.name, "Only Name");
  assert.equal(publicProduct.description, "DB Description");
});

test("internal and business fields never appear", () => {
  const publicProduct = toPublicProduct(baseProduct, {
    internalNotes: "Never public",
  });

  assert.equal("internalNotes" in publicProduct, false);
  assert.equal("unitCost" in publicProduct, false);
  assert.equal("stockOwner" in publicProduct, false);
  assert.equal("pricingMode" in publicProduct, false);
  assert.equal("pricingPercent" in publicProduct, false);

  const encoded = JSON.stringify(publicProduct);
  assert.equal(encoded.includes("internalNotes"), false);
  assert.equal(encoded.includes("unitCost"), false);
  assert.equal(encoded.includes("stockOwner"), false);
  assert.equal(encoded.includes("pricingMode"), false);
  assert.equal(encoded.includes("pricingPercent"), false);
});

test("valid manifest loads", async () => {
  __resetProductEnrichmentManifestCacheForTests();
  const { tempDir, manifestPath } = await withTempManifest(
    JSON.stringify({ "p-1": { displayName: "Public Name", description: "Public Description" } }),
  );

  try {
    const manifest = await loadProductEnrichmentManifest(manifestPath);
    assert.equal(manifest["p-1"]?.displayName, "Public Name");
    assert.equal(manifest["p-1"]?.description, "Public Description");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("invalid manifest fails soft to empty object", async () => {
  __resetProductEnrichmentManifestCacheForTests();
  const { tempDir, manifestPath } = await withTempManifest("{ invalid");

  try {
    const manifest = await loadProductEnrichmentManifest(manifestPath);
    assert.deepEqual(manifest, {});
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("missing manifest fails soft to empty object", async () => {
  __resetProductEnrichmentManifestCacheForTests();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zle-enrichment-test-missing-"));
  const missingPath = path.join(tempDir, "missing-manifest.json");

  try {
    const manifest = await loadProductEnrichmentManifest(missingPath);
    assert.deepEqual(manifest, {});
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cache reset helper works", async () => {
  __resetProductEnrichmentManifestCacheForTests();
  const { tempDir, manifestPath } = await withTempManifest(JSON.stringify({ "p-1": { displayName: "One" } }));

  try {
    const first = await loadProductEnrichmentManifest(manifestPath);
    __resetProductEnrichmentManifestCacheForTests();
    const second = await loadProductEnrichmentManifest(manifestPath);
    assert.deepEqual(first, second);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
