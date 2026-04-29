import test from "node:test";
import assert from "node:assert/strict";

import { getProductImageCandidates, isImageOwnedByProduct } from "./product-ui";

test("getProductImageCandidates includes local fallback slots through 08 in slot order", () => {
  const product = { id: "hoodie-ice-cream", image: "", images: [] };

  const candidates = getProductImageCandidates(product);

  assert.deepEqual(candidates, [
    "/images/products/hoodie-ice-cream/cover.jpg",
    "/images/products/hoodie-ice-cream/01.jpg",
    "/images/products/hoodie-ice-cream/02.jpg",
    "/images/products/hoodie-ice-cream/03.jpg",
    "/images/products/hoodie-ice-cream/04.jpg",
    "/images/products/hoodie-ice-cream/05.jpg",
    "/images/products/hoodie-ice-cream/06.jpg",
    "/images/products/hoodie-ice-cream/07.jpg",
    "/images/products/hoodie-ice-cream/08.jpg",
  ]);
});

test("declared 05 image prevents duplicate fallback for slot 05", () => {
  const product = {
    id: "hoodie-ice-cream",
    image: "/images/products/hoodie-ice-cream/05.webp",
    images: [],
  };

  const candidates = getProductImageCandidates(product);

  assert.equal(candidates.filter((path) => path.includes("/05.")).length, 1);
  assert.equal(candidates[0], "/images/products/hoodie-ice-cream/05.webp");
});

test("ownership guard rejects non-owned paths", () => {
  const product = { id: "hoodie-ice-cream" };

  assert.equal(isImageOwnedByProduct(product, "/images/products/other-product/05.jpg"), false);
  assert.equal(isImageOwnedByProduct(product, "/images/../secrets/05.jpg"), false);
  assert.equal(isImageOwnedByProduct(product, "https://cdn.example.com/images/products/hoodie-ice-cream/05.jpg"), false);
});

test("current behavior for cover and 01 remains unchanged", () => {
  const product = {
    id: "hoodie-ice-cream",
    image: "/images/products/hoodie-ice-cream/cover.webp",
    images: ["/images/products/hoodie-ice-cream/01.webp"],
  };

  const candidates = getProductImageCandidates(product);

  assert.equal(candidates[0], "/images/products/hoodie-ice-cream/cover.webp");
  assert.equal(candidates[1], "/images/products/hoodie-ice-cream/01.webp");
  assert.ok(!candidates.includes("/images/products/hoodie-ice-cream/cover.jpg"));
  assert.ok(!candidates.includes("/images/products/hoodie-ice-cream/01.jpg"));
});
