import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTbsProductPage, isProtectionPageHtml } from "./tbs-parser.ts";
import { runTotalboardshopSourceAgent } from "./source-totalboardshop.ts";

const WEDOS_HTML = `
<!doctype html>
<html>
  <head>
    <title>Proof of Work - WEDOS Protection</title>
  </head>
  <body>
    <main>
      <h1>Keeping you safe</h1>
      <div class="wedos protection challenge-widget">
        <p>WEDOS Protection verification</p>
        <div data-widget="captcha-widget"></div>
      </div>
    </main>
  </body>
</html>`;

const PRODUCT_HTML = `
<!doctype html>
<html>
  <body>
    <h1 class="product_title entry-title">Mikina ZLE Classic</h1>
    <div>Značka: <span>ZLE</span></div>
    <div>Kategorie: <span>Mikiny</span></div>
    <p class="price">1 290 Kč</p>
    <div><img src="/images/classic-cover.jpg" /></div>
    <h2>Popis</h2>
    <p>Velikosti S M L.</p>
  </body>
</html>`;

test("synthetic WEDOS challenge HTML is classified as blocked_by_protection instead of missing_title", () => {
  assert.equal(isProtectionPageHtml(WEDOS_HTML), true);
  const parsed = parseTbsProductPage("https://totalboardshop.cz/obchod/mikina-zle-classic/", WEDOS_HTML);
  assert.equal(parsed.product, undefined);
  assert.deepEqual(parsed.failure, {
    code: "blocked_by_protection",
    reason: "Protection or challenge page detected instead of product HTML",
  });
});

test("normal product HTML is not falsely classified as a protection page", () => {
  assert.equal(isProtectionPageHtml(PRODUCT_HTML), false);
  const parsed = parseTbsProductPage("https://totalboardshop.cz/obchod/mikina-zle-classic/", PRODUCT_HTML);
  assert.equal(parsed.failure, undefined);
  assert.equal(parsed.product?.title, "Mikina ZLE Classic");
});

test("crawl log skippedProducts records blocked_by_protection for challenge HTML", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-protection-"));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("nabidka-znacek")) {
      return new Response('<a href="https://totalboardshop.cz/obchod/mikina-zle-classic/">Product</a>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    return new Response(WEDOS_HTML, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  try {
    const result = await runTotalboardshopSourceAgent({
      runId: "tbs-protection-test",
      outputRoot: tempRoot,
      seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
      maxPages: 5,
      maxProducts: 5,
      maxImagesPerProduct: 2,
      maxImageBytes: 500_000,
    });

    const crawlLog = JSON.parse(await fs.promises.readFile(result.crawlLogPath, "utf8")) as {
      skippedProducts: Array<{ sourceUrl: string; reasonCode: string; detail?: string }>;
      skippedProductSummary: Record<string, number>;
    };

    assert.deepEqual(crawlLog.skippedProducts, [
      {
        sourceUrl: "https://totalboardshop.cz/obchod/mikina-zle-classic/",
        reasonCode: "blocked_by_protection",
        detail: "Protection or challenge page detected instead of product HTML",
      },
    ]);
    assert.equal(crawlLog.skippedProductSummary.blocked_by_protection, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
