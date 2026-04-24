import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __setSourceTotalboardshopTestHooks,
  runTotalboardshopSourceAgent,
} from "./source-totalboardshop.ts";

const LISTING_HTML = `
  <a href="https://totalboardshop.cz/obchod/mikina-zle-classic/">Product</a>
  <a href="https://totalboardshop.cz/obchod/mikina-zle-failed/">Failed Product</a>
`;
const PRODUCT_HTML = `
<!doctype html>
<html>
  <body>
    <h1 class="product_title entry-title">Mikina ZLE Classic</h1>
    <div>Značka: <span>ZLE</span></div>
    <div>Kategorie: <span>Mikiny</span></div>
    <p class="price">1 290 Kč</p>
    <div class="woocommerce-product-gallery">
      <img data-large_image="https://totalboardshop.cz/wp-content/uploads/2025/10/mikina-zle-classic.jpg" />
    </div>
    <h2>Popis</h2>
    <p>Velikosti S M L.</p>
  </body>
</html>`;
const WEDOS_HTML = `
<!doctype html>
<html>
  <head><title>Proof of Work - WEDOS Protection</title></head>
  <body><h1>Keeping you safe</h1><div>WEDOS Protection</div></body>
</html>`;

test("seed acquisition failure hard-fails the run", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-source-seed-fail-"));
  try {
    __setSourceTotalboardshopTestHooks({
      htmlAcquirerFactory: async () => ({
        async fetchHtml() {
          throw new Error("seed timeout");
        },
        async close() {},
      }),
    });

    await assert.rejects(
      () =>
        runTotalboardshopSourceAgent({
          runId: "tbs-seed-hard-fail",
          outputRoot: tempRoot,
          seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
          maxPages: 2,
          maxProducts: 2,
          maxImagesPerProduct: 1,
          maxImageBytes: 500_000,
        }),
      /seed timeout/,
    );
  } finally {
    __setSourceTotalboardshopTestHooks({});
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("primary crawl error is preserved when acquirer.close also fails", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-source-primary-error-"));
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    __setSourceTotalboardshopTestHooks({
      htmlAcquirerFactory: async () => ({
        async fetchHtml() {
          throw new Error("seed timeout");
        },
        async close() {
          throw new Error("close failed");
        },
      }),
    });

    await assert.rejects(
      () =>
        runTotalboardshopSourceAgent({
          runId: "tbs-primary-error",
          outputRoot: tempRoot,
          seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
          maxPages: 2,
          maxProducts: 2,
          maxImagesPerProduct: 1,
          maxImageBytes: 500_000,
        }),
      /seed timeout/,
    );
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0] ?? ""), /cleanup failed after primary error/);
    assert.match(String(warnings[0]?.[1] ?? ""), /close failed/);
  } finally {
    console.warn = originalWarn;
    __setSourceTotalboardshopTestHooks({});
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("seed empty listing hard-fails fail-closed", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-source-seed-empty-"));
  try {
    __setSourceTotalboardshopTestHooks({
      htmlAcquirerFactory: async () => ({
        async fetchHtml(url: string) {
          return { finalUrl: url, status: 200, contentType: "text/html", html: "<html><body>empty</body></html>" };
        },
        async close() {},
      }),
    });

    await assert.rejects(
      () =>
        runTotalboardshopSourceAgent({
          runId: "tbs-seed-empty",
          outputRoot: tempRoot,
          seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
          maxPages: 2,
          maxProducts: 2,
          maxImagesPerProduct: 1,
          maxImageBytes: 500_000,
        }),
      /Seed returned empty listing/,
    );
  } finally {
    __setSourceTotalboardshopTestHooks({});
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("seed protection page hard-fails fail-closed", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-source-seed-protection-"));
  try {
    __setSourceTotalboardshopTestHooks({
      htmlAcquirerFactory: async () => ({
        async fetchHtml(url: string) {
          return { finalUrl: url, status: 200, contentType: "text/html", html: WEDOS_HTML };
        },
        async close() {},
      }),
    });

    await assert.rejects(
      () =>
        runTotalboardshopSourceAgent({
          runId: "tbs-seed-protection",
          outputRoot: tempRoot,
          seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
          maxPages: 2,
          maxProducts: 2,
          maxImagesPerProduct: 1,
          maxImageBytes: 500_000,
        }),
      /Seed returned protection page/,
    );
  } finally {
    __setSourceTotalboardshopTestHooks({});
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("detail acquisition failure is skipped and image flow remains unchanged", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-source-detail-skip-"));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "4" },
    });
  }) as typeof fetch;

  try {
    __setSourceTotalboardshopTestHooks({
      htmlAcquirerFactory: async () => ({
        async fetchHtml(url: string) {
          if (url.includes("nabidka-znacek")) {
            return { finalUrl: url, status: 200, contentType: "text/html", html: LISTING_HTML };
          }
          if (url.includes("mikina-zle-classic")) {
            return { finalUrl: url, status: 200, contentType: "text/html", html: PRODUCT_HTML };
          }
          throw new Error("detail blocked");
        },
        async close() {},
      }),
    });

    const result = await runTotalboardshopSourceAgent({
      runId: "tbs-detail-skip",
      outputRoot: tempRoot,
      seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
      maxPages: 2,
      maxProducts: 2,
      maxImagesPerProduct: 1,
      maxImageBytes: 500_000,
    });

    const products = JSON.parse(await fs.promises.readFile(result.productsPath, "utf8")) as Array<{ downloadedImages: string[] }>;
    const crawlLog = JSON.parse(await fs.promises.readFile(result.crawlLogPath, "utf8")) as {
      skippedUrls: Array<{ url: string; reasonCode: string; detail?: string }>;
    };
    assert.equal(products.length, 1);
    assert.equal(products[0]?.downloadedImages.length, 1);
    assert.equal(crawlLog.skippedUrls.length, 1);
    assert.equal(crawlLog.skippedUrls[0]?.reasonCode, "fetch_failed");
    assert.match(crawlLog.skippedUrls[0]?.detail || "", /detail blocked/);
    assert.equal(calls.length, 1);
    assert.match(calls[0] || "", /wp-content\/uploads\/2025\/10\/mikina-zle-classic.jpg/);
  } finally {
    __setSourceTotalboardshopTestHooks({});
    globalThis.fetch = originalFetch;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
