import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { runProductPhotoIngest } from "./product-photo-ingest.ts";

const LIVE_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

function uniqueSuffix(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

function createTestPaths(label: string) {
  const runId = uniqueSuffix(label);
  return {
    runId,
    reportPath: path.join("tmp", "agent-reports", `${runId}.json`),
    summaryPath: path.join("tmp", "agent-reports", `${runId}.summary.md`),
    stagingDir: path.join("tmp", "agent-staging", runId),
    manifestDir: path.join("tmp", "agent-manifests", runId),
    reviewDir: path.join("tmp", "agent-review", runId),
  };
}

async function makePng(filePath: string, rgb: { r: number; g: number; b: number }): Promise<void> {
  const buffer = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: rgb,
    },
  })
    .png()
    .toBuffer();

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
}

async function freshWorkDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "ingest-sec-"));
}

async function cleanupWorkDir(dir: string, paths: ReturnType<typeof createTestPaths>): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
  await Promise.all([
    fs.promises.rm(path.resolve(process.cwd(), paths.reportPath), { force: true }),
    fs.promises.rm(path.resolve(process.cwd(), paths.summaryPath), { force: true }),
    fs.promises.rm(path.resolve(process.cwd(), paths.stagingDir), { recursive: true, force: true }),
    fs.promises.rm(path.resolve(process.cwd(), paths.manifestDir), { recursive: true, force: true }),
    fs.promises.rm(path.resolve(process.cwd(), paths.reviewDir), { recursive: true, force: true }),
  ]);
}

test("rejects symlinked direct output parent chain", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t1");
  const symlinkName = uniqueSuffix("ingest-test-link");
  const symlinkPath = path.join(LIVE_ROOT, symlinkName);

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 10, g: 10, b: 10 });
    await fs.promises.mkdir(LIVE_ROOT, { recursive: true });
    await fs.promises.symlink(work, symlinkPath);

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join("client", "public", "images", "products", symlinkName),
        reportPath: paths.reportPath,
        summaryPath: paths.summaryPath,
        manifestDir: paths.manifestDir,
        reviewDir: paths.reviewDir,
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: true,
        runId: paths.runId,
      }),
      /Symlink path blocked/,
    );
  } finally {
    await fs.promises.rm(symlinkPath, { force: true });
    await cleanupWorkDir(work, paths);
  }
});

test("staged ingest does not self-collide in duplicate detection", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t2");

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic-1.png"), { r: 255, g: 0, b: 0 });
    await fs.promises.copyFile(path.join(inputDir, "zle-tee-classic-1.png"), path.join(inputDir, "zle-tee-classic-2.png"));
    await makePng(path.join(inputDir, "zle-tee-classic-3.png"), { r: 0, g: 255, b: 0 });

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products"),
      reportPath: paths.reportPath,
      summaryPath: paths.summaryPath,
      manifestDir: paths.manifestDir,
      reviewDir: paths.reviewDir,
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: true,
      direct: false,
      stagingDir: paths.stagingDir,
      runId: paths.runId,
    });

    const product = result.report.products.find((item) => item.productId === "zle-tee-classic");
    assert.ok(product);
    assert.deepEqual(product.reservedSlots, ["01", "02", "cover"]);
    assert.equal(result.report.reviewItems.filter((item) => item.reason.includes("duplicate candidate")).length, 0);

    const writtenOutputs = result.report.writtenFiles.filter(
      (file) => file.endsWith("cover.jpg") || file.endsWith("01.jpg") || file.endsWith("02.jpg"),
    );
    assert.equal(writtenOutputs.length, 3);
  } finally {
    await cleanupWorkDir(work, paths);
  }
});

test("human-facing report fields sanitize unicode spoofing characters", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t3");

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic.png"), { r: 0, g: 0, b: 255 });
    const suspiciousName = `IGNORE\u202E\u200Boverride.txt`;
    await fs.promises.writeFile(path.join(inputDir, suspiciousName), "payload", "utf8");

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products"),
      reportPath: paths.reportPath,
      summaryPath: paths.summaryPath,
      manifestDir: paths.manifestDir,
      reviewDir: paths.reviewDir,
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: true,
      direct: false,
      stagingDir: paths.stagingDir,
      runId: paths.runId,
    });

    assert.ok(result.report.ignoredFiles.some((name) => name.includes("?")));
    assert.ok(result.report.suspiciousInputs.some((name) => name.includes("?")));
    assert.ok(result.report.suspiciousInputs.every((name) => !name.includes("\u202E") && !name.includes("\u200B")));

    const summary = await fs.promises.readFile(path.resolve(process.cwd(), paths.summaryPath), "utf8");
    assert.equal(summary.includes("\u202E"), false);
    assert.equal(summary.includes("\u200B"), false);
  } finally {
    await cleanupWorkDir(work, paths);
  }
});

test("rejects direct output outside live root", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t4");

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 1, g: 1, b: 1 });

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join(work, "outside"),
        reportPath: paths.reportPath,
        summaryPath: paths.summaryPath,
        manifestDir: paths.manifestDir,
        reviewDir: paths.reviewDir,
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: true,
        runId: paths.runId,
      }),
      /Direct mode output must stay inside/,
    );
  } finally {
    await cleanupWorkDir(work, paths);
  }
});

test("staged:false without direct:true cannot bypass live output guard", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t5");

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 2, g: 2, b: 2 });

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join("client", "public", "images", "products"),
        reportPath: paths.reportPath,
        summaryPath: paths.summaryPath,
        manifestDir: paths.manifestDir,
        reviewDir: paths.reviewDir,
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: false,
        runId: paths.runId,
      }),
      /staged:false requires direct:true/,
    );
  } finally {
    await cleanupWorkDir(work, paths);
  }
});

test("direct run with review items is not marked published", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t6");
  const runId = paths.runId;

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic-1.png"), { r: 20, g: 20, b: 20 });
    await fs.promises.copyFile(path.join(inputDir, "zle-tee-classic-1.png"), path.join(inputDir, "zle-tee-classic-2.png"));

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products", `security-${runId}`),
      reportPath: paths.reportPath,
      summaryPath: paths.summaryPath,
      manifestDir: paths.manifestDir,
      reviewDir: paths.reviewDir,
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: false,
      direct: true,
      runId,
    });

    assert.ok(result.runManifest);
    assert.notEqual(result.runManifest.publishState, "published");
    assert.equal(result.runManifest.publishState, "partial");
    assert.ok(result.report.reviewItems.length > 0);
  } finally {
    await fs.promises.rm(path.join(LIVE_ROOT, `security-${runId}`), { recursive: true, force: true });
    await cleanupWorkDir(work, paths);
  }
});

test("staged run does not write global asset fingerprint index", async () => {
  const work = await freshWorkDir();
  const paths = createTestPaths("t7");

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic.png"), { r: 3, g: 3, b: 3 });

    await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products"),
      reportPath: paths.reportPath,
      summaryPath: paths.summaryPath,
      manifestDir: paths.manifestDir,
      reviewDir: paths.reviewDir,
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: true,
      direct: false,
      stagingDir: paths.stagingDir,
      runId: paths.runId,
    });

    assert.equal(fs.existsSync(path.resolve(process.cwd(), paths.manifestDir, "asset-index.json")), false);
  } finally {
    await cleanupWorkDir(work, paths);
  }
});
