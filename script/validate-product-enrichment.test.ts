import test from "node:test";
import assert from "node:assert/strict";

import { parseProductEnrichmentManifest } from "./lib/product-enrichment.ts";

test("empty manifest passes", () => {
  const parsed = parseProductEnrichmentManifest({});
  assert.deepEqual(parsed, {});
});

test("valid single product enrichment passes", () => {
  const parsed = parseProductEnrichmentManifest({
    "product-id": {
      displayName: "Oversized Tee",
      description: "Heavyweight cotton",
      material: "100% cotton",
      dimensions: "Relaxed fit",
      seoTitle: "Oversized Tee",
      seoDescription: "Premium oversized cotton tee",
      badges: ["LIMITED"],
      tags: ["crew", "streetwear"],
      internalNotes: "Internal reference",
    },
  });

  assert.equal(parsed["product-id"]?.displayName, "Oversized Tee");
});

test("unknown top-level field inside a product fails", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        displayName: "Tee",
        unknownField: "not-allowed",
      },
    }),
  );
});

test("invalid field types fail", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        badges: "LIMITED",
      },
    }),
  );
});

test("seoTitle longer than 70 chars fails", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        seoTitle: "x".repeat(71),
      },
    }),
  );
});

test("seoDescription longer than 170 chars fails", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        seoDescription: "x".repeat(171),
      },
    }),
  );
});

test("badges and tags must be arrays of non-empty strings", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        badges: [""],
      },
    }),
  );

  assert.throws(() =>
    parseProductEnrichmentManifest({
      "product-id": {
        tags: ["ok", "   "],
      },
    }),
  );
});

test("internalNotes is allowed but not required", () => {
  const withoutNotes = parseProductEnrichmentManifest({
    "product-id": {
      displayName: "Tee",
    },
  });

  const withNotes = parseProductEnrichmentManifest({
    "product-id-2": {
      internalNotes: "Only internal",
    },
  });

  assert.equal(withoutNotes["product-id"]?.internalNotes, undefined);
  assert.equal(withNotes["product-id-2"]?.internalNotes, "Only internal");
});


test("product ID key with leading or trailing whitespace fails", () => {
  assert.throws(() =>
    parseProductEnrichmentManifest({
      " sku-1 ": {
        displayName: "Tee",
      },
    }),
  );
});

test("valid product ID key passes", () => {
  const parsed = parseProductEnrichmentManifest({
    "sku-1": {
      displayName: "Tee",
    },
  });

  assert.equal(parsed["sku-1"]?.displayName, "Tee");
});
