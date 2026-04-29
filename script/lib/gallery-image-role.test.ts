import test from "node:test";
import assert from "node:assert/strict";
import { classifyGalleryImageRole, resolveGalleryImageOrder } from "./gallery-image-role.ts";

test("source order [front, size_chart, back] prioritizes product/back before chart", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/front-tee.jpg", originalIndex: 0 },
    { sourcePath: "/tmp/size-chart.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/back-view.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front-tee.jpg",
    "/tmp/back-view.jpg",
    "/tmp/size-chart.jpg",
  ]);
});

test("source order [size_chart, front, back] still avoids chart as cover/01", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/size-chart.png", originalIndex: 0 },
    { sourcePath: "/tmp/front-model.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/back-print.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front-model.jpg",
    "/tmp/back-print.jpg",
    "/tmp/size-chart.png",
  ]);
});

test("source order [front, back, size_chart] keeps stable expected order", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/front.jpg", originalIndex: 0 },
    { sourcePath: "/tmp/back.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/measurement-chart.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front.jpg",
    "/tmp/back.jpg",
    "/tmp/measurement-chart.jpg",
  ]);
});

test("size-chart-only source returns review_required", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/size-chart.jpg", originalIndex: 0 },
  ]);
  assert.equal(resolved.status, "review_required");
});

test("unknown does not outrank known product/detail roles", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/random-file.jpg", originalIndex: 0 },
    { sourcePath: "/tmp/front-tee.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/back.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front-tee.jpg",
    "/tmp/back.jpg",
    "/tmp/random-file.jpg",
  ]);
});

test("existing non-chart product galleries preserve stable relative order", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/front-tee.jpg", originalIndex: 0 },
    { sourcePath: "/tmp/front-tee-alt.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/back-tee.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front-tee.jpg",
    "/tmp/front-tee-alt.jpg",
    "/tmp/back-tee.jpg",
  ]);
});

test("classify marks obvious size-chart/logo keywords conservatively", () => {
  assert.equal(classifyGalleryImageRole("/tmp/spec-logo-chart.png").role, "logo_or_technical");
  assert.equal(classifyGalleryImageRole("/tmp/tabulka-velikosti.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/size-specification.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/kapybara-size-specification.jpg").role, "size_chart");
});

test("basename-only classification: parent folder hints must not override front.jpg", () => {
  assert.equal(classifyGalleryImageRole("/tmp/size-chart-bucket/front.jpg").role, "product");
  assert.equal(classifyGalleryImageRole("/tmp/backups/front.jpg").role, "product");
});

test("basename-only classification still detects semantic basename hints", () => {
  assert.equal(classifyGalleryImageRole("/tmp/backups/back-print.jpg").role, "back_detail");
});

test("token-safe technical matching: special-front is not matched as spec", () => {
  assert.equal(classifyGalleryImageRole("/tmp/special-front.jpg").role, "product");
});

test("spec-logo-chart remains logo/technical without size token", () => {
  assert.equal(classifyGalleryImageRole("/tmp/spec-logo-chart.png").role, "logo_or_technical");
});

test("managed numeric slot filename alone does not imply product detail", () => {
  assert.equal(classifyGalleryImageRole("/tmp/01.jpg").role, "unknown");
});

test("size chart hint beats numeric slot filename", () => {
  assert.equal(classifyGalleryImageRole("/tmp/01-size-chart.jpg").role, "size_chart");
});

test("size-specific and size-special are not false-positive size spec charts", () => {
  assert.equal(classifyGalleryImageRole("/tmp/size-specific-front.jpg").role, "product");
  assert.equal(classifyGalleryImageRole("/tmp/size-special-front.jpg").role, "product");
});

test("exact size-spec phrase is allowed as size_chart signal", () => {
  assert.equal(classifyGalleryImageRole("/tmp/size-spec-front.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/size-specification.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/size-chart.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/tabulka-velikosti.jpg").role, "size_chart");
  assert.equal(classifyGalleryImageRole("/tmp/special-front.jpg").role, "product");
});

test("regression: front/back stay ahead of size-specification image", () => {
  const resolved = resolveGalleryImageOrder([
    { sourcePath: "/tmp/front-model.jpg", originalIndex: 0 },
    { sourcePath: "/tmp/kapybara-size-specification.jpg", originalIndex: 1 },
    { sourcePath: "/tmp/back-print-detail.jpg", originalIndex: 2 },
  ]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.ordered.map((item) => item.sourcePath), [
    "/tmp/front-model.jpg",
    "/tmp/back-print-detail.jpg",
    "/tmp/kapybara-size-specification.jpg",
  ]);
});

test("roleHintPath classification never replaces local sourcePath", () => {
  const localPath = "tmp/source-images/run/product/01.jpg";
  const resolved = resolveGalleryImageOrder([
    {
      sourcePath: localPath,
      originalIndex: 0,
      roleHintPath: "https://totalboardshop.cz/wp-content/uploads/front-model.jpg",
    },
  ]);
  assert.equal(resolved.status, "ok");
  assert.equal(resolved.ordered[0]?.sourcePath, localPath);
  assert.equal(resolved.ordered[0]?.role, "product");
});
