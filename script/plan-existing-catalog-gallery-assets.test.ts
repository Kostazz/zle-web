import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planFromData, resolvePlannerOutputDir } from "./plan-existing-catalog-gallery-assets.ts";

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
    const { items } = planFromData(manifestFor("prod2--x", [{ path: "01.jpg", url: "https://x/a.jpg", content: "a" }]), root);
    assert.equal(items[0]?.proposedSlot, "01");
  });

  await t.test("Missing 02 can be planned as NEW", () => {
    const d = path.join(root, "prod3"); mk(d, "01.jpg", "exists");
    const { items } = planFromData(manifestFor("prod3--x", [{ path: "01.jpg", url: "https://x/b.jpg", content: "b" }]), root);
    assert.equal(items[0]?.proposedSlot, "02");
  });

  await t.test("Existing 01 is never overwritten", () => {
    const d = path.join(root, "prod4"); mk(d, "01.jpg", "x");
    const { items } = planFromData(manifestFor("prod4--x", [{ path: "01.jpg", url: "https://x/c.jpg", content: "c" }]), root);
    assert.notEqual(items[0]?.proposedSlot, "01");
  });

  await t.test("Existing 02 is never overwritten", () => {
    const d = path.join(root, "prod5"); mk(d, "01.jpg", "x"); mk(d, "02.jpg", "y");
    const { items } = planFromData(manifestFor("prod5--x", [{ path: "01.jpg", url: "https://x/d.jpg", content: "d" }]), root);
    assert.notEqual(items[0]?.proposedSlot, "02");
  });

  await t.test("Same hash already in folder becomes SAME or DUPLICATE", () => {
    const d = path.join(root, "prod6"); mk(d, "01.jpg", "same-content");
    const { items } = planFromData(manifestFor("prod6--x", [{ path: "01.jpg", url: "https://x/e.jpg", content: "same-content" }]), root);
    assert.ok(["SAME", "DUPLICATE_AFTER_NORMALIZATION"].includes(items[0]!.classification));
  });

  await t.test("Different hash for occupied slots never overwrites", () => {
    const d = path.join(root, "prod7"); mk(d, "01.jpg", "x"); mk(d, "02.jpg", "y");
    const { items } = planFromData(manifestFor("prod7--x", [{ path: "01.jpg", url: "https://x/f.jpg", content: "z" }]), root);
    assert.equal(items[0]?.classification, "NEW");
    assert.equal(items[0]?.proposedSlot, "03");
  });

  await t.test("Size chart is not treated as safe hero requirement and is technical", () => {
    const d = path.join(root, "prod8"); mk(d, "01.jpg", "x");
    const { items } = planFromData(manifestFor("prod8--x", [{ path: "01.jpg", url: "https://cdn/Kapybara-wear-velikostni-tabulka-HEAVY-FREE.jpg", content: "sz" }]), root);
    assert.equal(items[0]?.classification, "TECHNICAL_IMAGE");
  });

  await t.test("Product id mapping requires existing local folder", () => {
    const { items } = planFromData(manifestFor("missing-prod--x", [{ path: "01.jpg", url: "https://x/g.jpg", content: "g" }]), root);
    assert.equal(items[0]?.classification, "LOCAL_PRODUCT_MISSING");
  });

  await t.test("Slot cap 08 is respected", () => {
    const d = path.join(root, "prod9");
    for (let i = 1; i <= 8; i++) mk(d, `${String(i).padStart(2, "0")}.jpg`, `${i}`);
    const { items } = planFromData(manifestFor("prod9--x", [{ path: "01.jpg", url: "https://x/h.jpg", content: "h" }]), root);
    assert.equal(items[0]?.classification, "NO_FREE_SLOT");
  });

  await t.test("Cover hash duplicate is treated as SAME and not re-added as 01", () => {
    const d = path.join(root, "prod10"); mk(d, "cover.jpg", "hero");
    const { items } = planFromData(manifestFor("prod10--x", [{ path: "01.jpg", url: "https://x/hero.jpg", content: "hero" }]), root);
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
