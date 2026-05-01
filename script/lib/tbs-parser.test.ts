import test from "node:test";
import assert from "node:assert/strict";

import { parseTbsProductPage } from "./tbs-parser.ts";

const URL = "https://totalboardshop.cz/obchod/test-product/";

function buildHtml(brand: string): string {
  return `
  <!doctype html>
  <html>
    <body>
      <h1 class="product_title entry-title">Test produkt</h1>
      <div>Značka: <span>${brand}</span></div>
      <div>Kategorie: <span>Trika</span></div>
      <p class="price">790 Kč</p>
      <div class="woocommerce-product-gallery">
        <img src="/wp-content/uploads/2025/10/test-front.jpg" />
      </div>
    </body>
  </html>`;
}

test("accepts current TBS brand metadata label and normalizes it to zle", () => {
  const parsed = parseTbsProductPage(URL, buildHtml("ZLE Lifestyle culture brand"));
  assert.equal(parsed.failure, undefined);
  assert.equal(parsed.product?.brandNormalized, "zle");
});

test("keeps all legacy trusted ZLE labels accepted", () => {
  for (const label of ["ZLE", "ZLE skateboarding", "ZLE skateboards"]) {
    const parsed = parseTbsProductPage(URL, buildHtml(label));
    assert.equal(parsed.failure, undefined, `label should be trusted: ${label}`);
    assert.equal(parsed.product?.brandNormalized, "zle");
  }
});

test("rejects non-ZLE brand", () => {
  const parsed = parseTbsProductPage(URL, buildHtml("Nike"));
  assert.equal(parsed.product, undefined);
  assert.equal(parsed.failure?.code, "brand_not_trusted");
});

test("rejects arbitrary string containing zle that is not explicitly trusted", () => {
  const parsed = parseTbsProductPage(URL, buildHtml("my custom zle-inspired label"));
  assert.equal(parsed.product, undefined);
  assert.equal(parsed.failure?.code, "brand_not_trusted");
});
