import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runProductPhotoIngest } from "./product-photo-ingest.ts";

const LIVE_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

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
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ingest-sec-"));
  await fs.promises.rm(path.join(process.cwd(), "tmp"), { recursive: true, force: true });
  return dir;
}

async function cleanupWorkDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.rm(path.join(process.cwd(), "tmp"), { recursive: true, force: true });
}

test("rejects symlinked direct output parent chain", async () => {
  const work = await freshWorkDir();
  const symlinkName = `ingest-test-link-${Date.now()}`;
  const symlinkPath = path.join(LIVE_ROOT, symlinkName);

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 10, g: 10, b: 10 });
    await fs.promises.mkdir(LIVE_ROOT, { recursive: true });
    await fs.promises.symlink(work, symlinkPath);

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join("client", "public", "images", "products", symlinkName),
        reportPath: path.join("tmp", "agent-reports", "t1.json"),
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: true,
        runId: "t1",
      }),
      /Symlink path blocked/,
    );
  } finally {
    await fs.promises.rm(symlinkPath, { force: true });
    await cleanupWorkDir(work);
  }
});

test("duplicate-to-review does not consume next slot", async () => {
  const work = await freshWorkDir();

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic-1.png"), { r: 255, g: 0, b: 0 });
    await fs.promises.copyFile(path.join(inputDir, "zle-tee-classic-1.png"), path.join(inputDir, "zle-tee-classic-2.png"));
    await makePng(path.join(inputDir, "zle-tee-classic-3.png"), { r: 0, g: 255, b: 0 });

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products"),
      reportPath: path.join("tmp", "agent-reports", "t2.json"),
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: true,
      direct: false,
      stagingDir: path.join("tmp", "agent-staging", "t2"),
      runId: "t2",
    });

    const product = result.report.products.find((item) => item.productId === "zle-tee-classic");
    assert.ok(product);
    assert.deepEqual(product.reservedSlots, ["01", "cover"]);

    const duplicateReview = result.report.reviewItems.find((item) => item.reason.includes("duplicate candidate"));
    assert.ok(duplicateReview);

    const writtenOutputs = result.report.writtenFiles.filter((file) => file.endsWith("cover.jpg") || file.endsWith("01.jpg"));
    assert.equal(writtenOutputs.length, 2);
  } finally {
    await cleanupWorkDir(work);
  }
});

test("human-facing report fields sanitize unicode spoofing characters", async () => {
  const work = await freshWorkDir();

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic.png"), { r: 0, g: 0, b: 255 });
    const suspiciousName = `IGNORE\u202E\u200Boverride.txt`;
    await fs.promises.writeFile(path.join(inputDir, suspiciousName), "payload", "utf8");

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products"),
      reportPath: path.join("tmp", "agent-reports", "t3.json"),
      lockDir: path.join("script", ".locks"),
      dryRun: false,
      maxImagesPerProduct: 8,
      staged: true,
      direct: false,
      stagingDir: path.join("tmp", "agent-staging", "t3"),
      runId: "t3",
    });

    assert.ok(result.report.ignoredFiles.some((name) => name.includes("?")));
    assert.ok(result.report.suspiciousInputs.some((name) => name.includes("?")));
    assert.ok(result.report.suspiciousInputs.every((name) => !name.includes("\u202E") && !name.includes("\u200B")));

    const summary = await fs.promises.readFile(path.join(process.cwd(), "tmp", "agent-reports", "t3.summary.md"), "utf8");
    assert.equal(summary.includes("\u202E"), false);
    assert.equal(summary.includes("\u200B"), false);
  } finally {
    await cleanupWorkDir(work);
  }
});

test("rejects direct output outside live root", async () => {
  const work = await freshWorkDir();

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 1, g: 1, b: 1 });

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join(work, "outside"),
        reportPath: path.join("tmp", "agent-reports", "t4.json"),
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: true,
        runId: "t4",
      }),
      /Direct mode output must stay inside/,
    );
  } finally {
    await cleanupWorkDir(work);
  }
});

test("staged:false without direct:true cannot bypass live output guard", async () => {
  const work = await freshWorkDir();

  try {
    await makePng(path.join(work, "in", "zle-tee-classic.png"), { r: 2, g: 2, b: 2 });

    await assert.rejects(
      runProductPhotoIngest({
        inputDir: path.join(work, "in"),
        outputDir: path.join("client", "public", "images", "products"),
        reportPath: path.join("tmp", "agent-reports", "t5.json"),
        lockDir: path.join("script", ".locks"),
        dryRun: false,
        maxImagesPerProduct: 8,
        staged: false,
        direct: false,
        runId: "t5",
      }),
      /staged:false requires direct:true/,
    );
  } finally {
    await cleanupWorkDir(work);
  }
});

test("direct run with review items is not marked published", async () => {
  const work = await freshWorkDir();
  const runId = `t6-${Date.now()}`;

  try {
    const inputDir = path.join(work, "in");
    await makePng(path.join(inputDir, "zle-tee-classic-1.png"), { r: 20, g: 20, b: 20 });
    await fs.promises.copyFile(path.join(inputDir, "zle-tee-classic-1.png"), path.join(inputDir, "zle-tee-classic-2.png"));

    const result = await runProductPhotoIngest({
      inputDir,
      outputDir: path.join("client", "public", "images", "products", `security-${runId}`),
      reportPath: path.join("tmp", "agent-reports", `${runId}.json`),
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
    await cleanupWorkDir(work);
  }
});
