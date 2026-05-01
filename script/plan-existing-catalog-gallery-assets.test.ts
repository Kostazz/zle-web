import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planFromData, resolvePlannerOutputDir, validateRunId } from "./plan-existing-catalog-gallery-assets.ts";

function mk(dir: string, file: string, content: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function hashBuffer(content: string) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(content)).digest("hex")}`;
}

function manifestFor(key: string, imgs: Array<{ path: string; url: string; content: string }>) {
  return {
    runId: "r1",
    products: [{
      sourceProductKey: key,
      ingestedImages: imgs.map((img, i) => ({ path: img.path, originalImageUrl: img.url, originalImageIndex: i })),
      downloadedImageHashes: imgs.map((img) => hashBuffer(img.content)),
    }],
  };
}

test("planner safety and slot behavior", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-"));

  await t.test("Existing cover is never replaced", () => {
    const d = path.join(root, "prod1"); mk(d, "cover.jpg", "cover");
    const { items } = planFromData(manifestFor("prod1--x", [{ path: "01.jpg", url: "https://x/front.jpg", content: "front" }]), root);
    assert.equal(items.some((i) => i.proposedFiles?.includes("cover.jpg")), false);
  });

  await t.test("Missing 01 can be planned as NEW", () => {
    const d = path.join(root, "prod2"); mk(d, "cover.jpg", "cover");
    const { items } = planFromData(manifestFor("prod2--x", [{ path: "01.jpg", url: "https://x/front-shirt-a.jpg", content: "a" }]), root);
    assert.equal(items[0]?.proposedSlot, "01");
  });

  await t.test("Missing 02 can be planned as NEW", () => {
    const d = path.join(root, "prod3"); mk(d, "01.jpg", "exists");
    const { items } = planFromData(manifestFor("prod3--x", [{ path: "01.jpg", url: "https://x/front-shirt-b.jpg", content: "b" }]), root);
    assert.equal(items[0]?.proposedSlot, "02");
  });

  await t.test("Existing 01 is never overwritten", () => {
    const d = path.join(root, "prod4"); mk(d, "01.jpg", "x");
    const { items } = planFromData(manifestFor("prod4--x", [{ path: "01.jpg", url: "https://x/front-shirt-c.jpg", content: "c" }]), root);
    assert.notEqual(items[0]?.proposedSlot, "01");
  });

  await t.test("Existing 02 is never overwritten", () => {
    const d = path.join(root, "prod5"); mk(d, "01.jpg", "x"); mk(d, "02.jpg", "y");
    const { items } = planFromData(manifestFor("prod5--x", [{ path: "01.jpg", url: "https://x/front-shirt-d.jpg", content: "d" }]), root);
    assert.notEqual(items[0]?.proposedSlot, "02");
  });

  await t.test("Same hash already in folder becomes SAME or DUPLICATE", () => {
    const d = path.join(root, "prod6"); mk(d, "01.jpg", "same-content");
    const { items } = planFromData(manifestFor("prod6--x", [{ path: "01.jpg", url: "https://x/front-shirt-e.jpg", content: "same-content" }]), root);
    assert.ok(["SAME", "DUPLICATE_AFTER_NORMALIZATION"].includes(items[0]!.classification));
  });

  await t.test("Different hash for occupied slots never overwrites", () => {
    const d = path.join(root, "prod7"); mk(d, "01.jpg", "x"); mk(d, "02.jpg", "y");
    const { items } = planFromData(manifestFor("prod7--x", [{ path: "01.jpg", url: "https://x/front-shirt-f.jpg", content: "z" }]), root);
    assert.equal(items[0]?.classification, "NEW");
    assert.equal(items[0]?.proposedSlot, "03");
  });

  await t.test("Size chart is not treated as safe hero requirement and is technical", () => {
    const d = path.join(root, "prod8"); mk(d, "01.jpg", "x");
    const { items } = planFromData(manifestFor("prod8--x", [{ path: "01.jpg", url: "https://cdn/Kapybara-wear-velikostni-tabulka-HEAVY-FREE.jpg", content: "sz" }]), root);
    assert.equal(items[0]?.classification, "TECHNICAL_IMAGE");
  });

  await t.test("Product id mapping requires existing local folder", () => {
    const { items } = planFromData(manifestFor("missing-prod--x", [{ path: "01.jpg", url: "https://x/front-shirt-g.jpg", content: "g" }]), root);
    assert.equal(items[0]?.classification, "LOCAL_PRODUCT_MISSING");
  });

  await t.test("Slot cap 08 is respected", () => {
    const d = path.join(root, "prod9");
    for (let i = 1; i <= 8; i++) mk(d, `${String(i).padStart(2, "0")}.jpg`, `${i}`);
    const { items } = planFromData(manifestFor("prod9--x", [{ path: "01.jpg", url: "https://x/front-shirt-h.jpg", content: "h" }]), root);
    assert.equal(items[0]?.classification, "NO_FREE_SLOT");
  });

  await t.test("Cover hash duplicate is treated as SAME and not re-added as 01", () => {
    const d = path.join(root, "prod10"); mk(d, "cover.jpg", "hero");
    const { items } = planFromData(manifestFor("prod10--x", [{ path: "01.jpg", url: "https://x/front-hero-shirt.jpg", content: "hero" }]), root);
    assert.equal(items[0]?.classification, "SAME");
  });

  await t.test("Failed source image is emitted as SOURCE_PRODUCT_WITH_FAILED_IMAGE", () => {
    const d = path.join(root, "prod11"); mk(d, "01.jpg", "x");
    const manifest = manifestFor("prod11--x", [{ path: "01.jpg", url: "https://x/ok.jpg", content: "ok" }]);
    (manifest as any).failures = [{ sourceProductKey: "prod11--x", imageUrl: "https://x/missing.jpg", reason: "HTTP 404" }];
    const { items } = planFromData(manifest as any, root);
    assert.equal(items.some((i) => i.classification === "SOURCE_PRODUCT_WITH_FAILED_IMAGE"), true);
  });
});


test("output dir guard enforces tmp/gallery-missing-plans root", async (t) => {
  await t.test("default output dir accepted", () => {
    const resolved = resolvePlannerOutputDir();
    assert.equal(resolved, path.resolve("tmp", "gallery-missing-plans"));
  });

  await t.test("nested subdir under allowed root accepted", () => {
    const resolved = resolvePlannerOutputDir("tmp/gallery-missing-plans/some-subdir");
    assert.equal(resolved, path.resolve("tmp", "gallery-missing-plans", "some-subdir"));
  });

  await t.test("client/public/images/products is rejected", () => {
    assert.throws(() => resolvePlannerOutputDir("client/public/images/products"), /outside tmp\/gallery-missing-plans/);
  });

  await t.test("parent traversal is rejected", () => {
    assert.throws(() => resolvePlannerOutputDir("../unsafe-dir"), /outside tmp\/gallery-missing-plans/);
  });

  await t.test("absolute outside path is rejected", () => {
    assert.throws(() => resolvePlannerOutputDir(path.resolve("/tmp/outside-zle")), /outside tmp\/gallery-missing-plans/);
  });
});


test("source-level hash dedupe does not consume slots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-srcdup-"));
  const d = path.join(root, "proddup");
  fs.mkdirSync(d, { recursive: true });

  const manifest = {
    runId: "r2",
    products: [{
      sourceProductKey: "proddup--x",
      ingestedImages: [
        { path: "01.jpg", originalImageUrl: "https://x/front-one-shirt.jpg", originalImageIndex: 0 },
        { path: "02.jpg", originalImageUrl: "https://x/front-one-copy-shirt.jpg", originalImageIndex: 1 },
        { path: "03.jpg", originalImageUrl: "https://x/front-two-shirt.jpg", originalImageIndex: 2 },
      ],
      downloadedImageHashes: [hashBuffer("img-1"), hashBuffer("img-1"), hashBuffer("img-2")],
    }],
  };

  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "NEW");
  assert.equal(items[0]?.proposedSlot, "01");
  assert.equal(items[1]?.classification, "DUPLICATE_AFTER_NORMALIZATION");
  assert.equal(items[1]?.proposedSlot, undefined);
  assert.equal(items[2]?.classification, "NEW");
  assert.equal(items[2]?.proposedSlot, "02");
});

test("source duplicates do not force NO_FREE_SLOT when slot remains", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-srcdup-nearfull-"));
  const d = path.join(root, "prodnearfull");
  for (let i = 1; i <= 7; i++) mk(d, `${String(i).padStart(2, "0")}.jpg`, `existing-${i}`);

  const manifest = {
    runId: "r3",
    products: [{
      sourceProductKey: "prodnearfull--x",
      ingestedImages: [
        { path: "01.jpg", originalImageUrl: "https://x/front-new-a-shirt.jpg", originalImageIndex: 0 },
        { path: "02.jpg", originalImageUrl: "https://x/front-new-a-dup-shirt.jpg", originalImageIndex: 1 },
      ],
      downloadedImageHashes: [hashBuffer("new-a"), hashBuffer("new-a")],
    }],
  };

  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "NEW");
  assert.equal(items[0]?.proposedSlot, "08");
  assert.equal(items[1]?.classification, "DUPLICATE_AFTER_NORMALIZATION");
  assert.notEqual(items[1]?.classification, "NO_FREE_SLOT");
});


test("run id safety validation", () => {
  assert.equal(validateRunId("tbs-20260501-full-gallery-refresh-02"), "tbs-20260501-full-gallery-refresh-02");
  for (const bad of ["../evil", "evil/plan", "evil\\plan", "evil plan", ".hidden", "abc..def"]) {
    assert.throws(() => validateRunId(bad), /Unsafe run id/);
  }
});

test("unsafe localProductId never escapes localRoot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-unsafe-id-"));
  const manifest = {
    runId: "r4",
    products: [{
      sourceProductKey: "../evil--x",
      ingestedImages: [{ path: "01.jpg", originalImageUrl: "https://x/front-shirt-a.jpg", originalImageIndex: 0 }],
      downloadedImageHashes: [hashBuffer("a")],
    }, {
      sourceProductKey: "evil/path--x",
      ingestedImages: [{ path: "01.jpg", originalImageUrl: "https://x/front-shirt-b.jpg", originalImageIndex: 0 }],
      downloadedImageHashes: [hashBuffer("b")],
    }, {
      sourceProductKey: "evil\\path--x",
      ingestedImages: [{ path: "01.jpg", originalImageUrl: "https://x/front-shirt-c.jpg", originalImageIndex: 0 }],
      downloadedImageHashes: [hashBuffer("c")],
    }, {
      sourceProductKey: ".hidden--x",
      ingestedImages: [{ path: "01.jpg", originalImageUrl: "https://x/front-shirt-d.jpg", originalImageIndex: 0 }],
      downloadedImageHashes: [hashBuffer("d")],
    }],
    failures: [{ sourceProductKey: "../evil--x", imageUrl: "https://x/fail.jpg", reason: "404" }],
  };
  const { items } = planFromData(manifest as any, root);
  const unsafeItems = items.filter((i) => i.reasonCodes.includes("unsafe_local_product_id"));
  assert.ok(unsafeItems.length >= 5);
});

test("missing source hash fails closed with manual review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-missing-hash-"));
  const d = path.join(root, "prodhash");
  fs.mkdirSync(d, { recursive: true });
  const manifest = {
    runId: "r5",
    products: [{
      sourceProductKey: "prodhash--x",
      ingestedImages: [{ path: "01.jpg", originalImageUrl: "https://x/front-shirt-a.jpg", originalImageIndex: 0 }],
      downloadedImageHashes: [],
    }],
  };
  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.ok(items[0]?.reasonCodes.includes("missing_source_hash"));
});


test("unsupported/rejected roles never consume slots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-reject-role-"));
  const d = path.join(root, "prodrole");
  fs.mkdirSync(d, { recursive: true });

  const manifest = {
    runId: "r6",
    products: [{
      sourceProductKey: "prodrole--x",
      ingestedImages: [
        { path: "01.jpg", originalImageUrl: "https://x/vector.svg", originalImageIndex: 0 },
        { path: "02.jpg", originalImageUrl: "https://x/anim.gif", originalImageIndex: 1 },
        { path: "03.jpg", originalImageUrl: "https://x/front-valid-shirt.jpg", originalImageIndex: 2 },
      ],
      downloadedImageHashes: [hashBuffer("svg"), hashBuffer("gif"), hashBuffer("valid")],
    }],
  };

  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.equal(items[0]?.proposedSlot, undefined);
  assert.ok(items[0]?.reasonCodes.includes("unsupported_gallery_image_role"));
  assert.ok(items[0]?.reasonCodes.includes("role_reject"));

  assert.equal(items[1]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.equal(items[1]?.proposedSlot, undefined);
  assert.ok(items[1]?.reasonCodes.includes("role_reject"));

  assert.equal(items[2]?.classification, "NEW");
  assert.equal(items[2]?.proposedSlot, "01");
});

test("unsupported roles do not cause NO_FREE_SLOT for later valid image", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-reject-nearfull-"));
  const d = path.join(root, "prodrole2");
  for (let i = 1; i <= 7; i++) mk(d, `${String(i).padStart(2, "0")}.jpg`, `existing-${i}`);

  const manifest = {
    runId: "r7",
    products: [{
      sourceProductKey: "prodrole2--x",
      ingestedImages: [
        { path: "01.jpg", originalImageUrl: "https://x/unsupported.svg", originalImageIndex: 0 },
        { path: "02.jpg", originalImageUrl: "https://x/front-shirt.jpg", originalImageIndex: 1 },
      ],
      downloadedImageHashes: [hashBuffer("unsup"), hashBuffer("valid-front")],
    }],
  };

  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.equal(items[1]?.classification, "NEW");
  assert.equal(items[1]?.proposedSlot, "08");
});

test("role_unknown gets non-binding candidate slots and stays manual review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-unknown-candidate-"));
  const d = path.join(root, "produ");
  fs.mkdirSync(d, { recursive: true });

  const manifest = {
    runId: "r8",
    products: [{
      sourceProductKey: "produ--x",
      ingestedImages: [
        { path: "a.jpg", originalImageUrl: "https://x/53137-scaled.jpg", originalImageIndex: 0 },
        { path: "b.jpg", originalImageUrl: "https://x/53137-scaled-copy.jpg", originalImageIndex: 1 },
        { path: "c.jpg", originalImageUrl: "https://x/53071-scaled.jpg", originalImageIndex: 2 },
      ],
      downloadedImageHashes: [hashBuffer("u1"), hashBuffer("u1"), hashBuffer("u2")],
    }],
  };
  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.equal(items[0]?.candidateSlot, "01");
  assert.equal(items[0]?.proposedSlot, undefined);
  assert.ok(items[0]?.reasonCodes.includes("unknown_role_candidate_for_missing_slot"));
  assert.equal(items[1]?.classification, "DUPLICATE_AFTER_NORMALIZATION");
  assert.equal(items[1]?.candidateSlot, undefined);
  assert.equal(items[2]?.candidateSlot, "02");
});

test("role_unknown hash in local and missing hash are not candidates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-unknown-localhash-"));
  const d = path.join(root, "produ2");
  mk(d, "cover.jpg", "same-cover");
  const manifest = {
    runId: "r9",
    products: [{
      sourceProductKey: "produ2--x",
      ingestedImages: [
        { path: "a.jpg", originalImageUrl: "https://x/DSC0733-scaled.jpg", originalImageIndex: 0 },
        { path: "b.jpg", originalImageUrl: "https://x/53509.jpg", originalImageIndex: 1 },
      ],
      downloadedImageHashes: [hashBuffer("same-cover")],
    }],
  };
  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.classification, "SAME");
  assert.equal(items[0]?.candidateSlot, undefined);
  assert.equal(items[1]?.classification, "REQUIRES_MANUAL_REVIEW");
  assert.ok(items[1]?.reasonCodes.includes("missing_source_hash"));
  assert.equal(items[1]?.candidateSlot, undefined);
});

test("candidate and proposed slots never conflict within same product", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-shared-slots-"));

  const d1 = path.join(root, "prodmix1");
  for (let i = 1; i <= 5; i++) mk(d1, `${String(i).padStart(2, "0")}.jpg`, `existing-${i}`);
  const manifest1 = {
    runId: "r10",
    products: [{
      sourceProductKey: "prodmix1--x",
      ingestedImages: [
        { path: "a.jpg", originalImageUrl: "https://x/front-product-shirt.jpg", originalImageIndex: 0 },
        { path: "b.jpg", originalImageUrl: "https://x/53137-scaled.jpg", originalImageIndex: 1 },
      ],
      downloadedImageHashes: [hashBuffer("new-product"), hashBuffer("unknown-a")],
    }],
  };
  const { items: items1 } = planFromData(manifest1 as any, root);
  assert.equal(items1[0]?.proposedSlot, "06");
  assert.equal(items1[1]?.candidateSlot, "07");

  const d2 = path.join(root, "prodmix2");
  for (let i = 1; i <= 5; i++) mk(d2, `${String(i).padStart(2, "0")}.jpg`, `existing2-${i}`);
  const manifest2 = {
    runId: "r11",
    products: [{
      sourceProductKey: "prodmix2--x",
      ingestedImages: [
        { path: "a.jpg", originalImageUrl: "https://x/53071-scaled.jpg", originalImageIndex: 0 },
        { path: "b.jpg", originalImageUrl: "https://x/front-product-two-shirt.jpg", originalImageIndex: 1 },
      ],
      downloadedImageHashes: [hashBuffer("unknown-b"), hashBuffer("new-product-b")],
    }],
  };
  const { items: items2 } = planFromData(manifest2 as any, root);
  assert.equal(items2[0]?.candidateSlot, "06");
  assert.equal(items2[1]?.proposedSlot, "07");
});

test("multiple unknown and NEW items allocate non-overlapping deterministic slots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zle-plan-shared-seq-"));
  const d = path.join(root, "prodseq");
  for (let i = 1; i <= 4; i++) mk(d, `${String(i).padStart(2, "0")}.jpg`, `existing-${i}`);
  const manifest = {
    runId: "r12",
    products: [{
      sourceProductKey: "prodseq--x",
      ingestedImages: [
        { path: "u1.jpg", originalImageUrl: "https://x/53509.jpg", originalImageIndex: 0 },
        { path: "p1.jpg", originalImageUrl: "https://x/front-product-a-shirt.jpg", originalImageIndex: 1 },
        { path: "u2.jpg", originalImageUrl: "https://x/DSC0733-scaled.jpg", originalImageIndex: 2 },
        { path: "p2.jpg", originalImageUrl: "https://x/front-product-b-shirt.jpg", originalImageIndex: 3 },
      ],
      downloadedImageHashes: [hashBuffer("u1"), hashBuffer("p1"), hashBuffer("u2"), hashBuffer("p2")],
    }],
  };
  const { items } = planFromData(manifest as any, root);
  assert.equal(items[0]?.candidateSlot, "05");
  assert.equal(items[1]?.proposedSlot, "06");
  assert.equal(items[2]?.candidateSlot, "07");
  assert.equal(items[3]?.proposedSlot, "08");
});
