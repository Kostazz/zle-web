import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { computeAuditChainHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { runCurationAgent } from "./curation-agent.ts";
import { writeReviewDecisionTemplate, validateReviewDecisionManifest, type ReviewDecisionManifest } from "./review-decision-agent.ts";
import { runApprovedStagingExecutor } from "./staging-review-executor.ts";
import { writePublishGateTemplate, runPublishGateAgent } from "./publish-gate-agent.ts";
import { writeLineageProof } from "./lineage-proof.ts";
import { runManualPublishExecutor } from "./manual-publish-executor.ts";
import { createSourceProductKey } from "./tbs-parser.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./source-dataset.ts";
import type { PublishGateManifest } from "./publish-gate-types.ts";

function uniqueRunId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function createJpeg(targetPath: string, color: { r: number; g: number; b: number }): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: color,
    },
  }).jpeg().toFile(targetPath);
}

async function writeSourceRun(root: string, runId: string): Promise<{ sourceRoot: string; product: SourceProductRecord }> {
  const sourceRoot = path.join(root, "tmp", "source-datasets");
  const runDir = path.join(sourceRoot, runId);
  const imagesDir = path.join(runDir, "images", "mikina-zle-audit");
  const sourceProductKey = createSourceProductKey("mikina-zle-audit");
  const imageRelativePath = path.posix.join("images", "mikina-zle-audit", "cover.jpg");
  const imageAbsolutePath = path.join(imagesDir, "cover.jpg");
  await createJpeg(imageAbsolutePath, { r: 12, g: 34, b: 56 });
  const imageHash = await sha256File(imageAbsolutePath);

  const product: SourceProductRecord = {
    sourceProductKey,
    sourceUrl: "https://totalboardshop.cz/produkt/mikina-zle-audit",
    sourceSlug: "mikina-zle-audit",
    title: "ZLE Audit Mikina",
    brandRaw: "ZLE",
    brandNormalized: "zle",
    categoryRaw: "Mikiny",
    tagRaw: null,
    priceText: "1 290 Kč",
    priceCzk: 1290,
    optionsRaw: ["M", "L"],
    sizes: ["M", "L"],
    descriptionRaw: "Audit fixture for reviewed publish chain.",
    structured: {
      productType: "mikina",
      audience: null,
      lineNormalized: null,
      designNormalized: "audit",
      colorTokens: ["black"],
    },
    imageUrls: ["https://totalboardshop.cz/images/mikina-zle-audit-cover.jpg"],
    downloadedImages: [imageRelativePath],
    downloadedImageHashes: [imageHash],
    fingerprint: "fixture-fingerprint",
  };

  const dataset: SourceDatasetManifest = {
    runId,
    source: "totalboardshop",
    sourceRoot: "https://totalboardshop.cz/",
    createdAt: new Date().toISOString(),
    mode: "crawl-snapshot",
    scope: {
      brand: "ZLE",
      matchMode: "exact",
    },
    productCount: 1,
    imageCount: 1,
    productsPath: "products.json",
    crawlLogPath: "crawl-log.json",
    auditPath: "audit.json",
    imagesPath: "images",
  };

  const productsPath = path.join(runDir, "products.json");
  const crawlLogPath = path.join(runDir, "crawl-log.json");
  await fs.promises.mkdir(runDir, { recursive: true });
  await fs.promises.writeFile(path.join(runDir, "dataset.json"), JSON.stringify(dataset, null, 2), "utf8");
  await fs.promises.writeFile(productsPath, JSON.stringify([product], null, 2), "utf8");
  await fs.promises.writeFile(crawlLogPath, JSON.stringify({ seedUrls: [], visitedPages: [], skippedUrls: [], skippedProducts: [], downloadErrors: [], limits: { maxPages: 1, maxProducts: 1, maxImagesPerProduct: 2, maxImageBytes: 1000000 } }, null, 2), "utf8");

  const auditArtifacts = {
    dataset: { path: path.relative(process.cwd(), path.join(runDir, "dataset.json")).split(path.sep).join("/"), sha256: await sha256File(path.join(runDir, "dataset.json")) },
    products: { path: path.relative(process.cwd(), productsPath).split(path.sep).join("/"), sha256: await sha256File(productsPath) },
    crawlLog: { path: path.relative(process.cwd(), crawlLogPath).split(path.sep).join("/"), sha256: await sha256File(crawlLogPath) },
  };
  const audit: AuditChainRecord = {
    runId,
    createdAt: new Date().toISOString(),
    artifacts: auditArtifacts,
    chain: {
      previousRunHash: null,
      currentRunHash: computeAuditChainHash(runId, auditArtifacts, null),
    },
  };
  await fs.promises.writeFile(path.join(runDir, "audit.json"), JSON.stringify(audit, null, 2), "utf8");
  return { sourceRoot, product };
}

test("full reviewed TotalBoardShop chain stays connected in validate-only mode", async () => {
  const sandboxRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tbs-e2e-hardening-"));
  const sourceRunId = uniqueRunId("source");
  const reviewRunId = sourceRunId;
  const stagingRunId = sourceRunId;
  const gateRunId = sourceRunId;
  const lineageRunId = `${sourceRunId}-lineage`;
  const reviewDir = path.join(process.cwd(), "tmp", "review-decisions");
  const curationDir = path.join(process.cwd(), "tmp", "curation");
  const stagingManifestDir = path.join(process.cwd(), "tmp", "agent-manifests");
  const gateDir = path.join(process.cwd(), "tmp", "publish-gates");
  const lineageDir = path.join(process.cwd(), "tmp", "lineage");
  const reportDir = path.join(process.cwd(), "tmp", "publish-reports");
  const stagingOutputDir = path.join(process.cwd(), "tmp", "agent-staging");
  const liveRoot = path.join(sandboxRoot, "client", "public", "images", "products");
  const { sourceRoot, product } = await writeSourceRun(sandboxRoot, sourceRunId);
  const liveProbePath = path.join(liveRoot, "existing-live", "cover.jpg");

  try {
    await fs.promises.mkdir(path.dirname(liveProbePath), { recursive: true });
    await fs.promises.writeFile(liveProbePath, "live-before", "utf8");

    const curation = await runCurationAgent({
      runId: sourceRunId,
      mode: "bootstrap-replacement",
      outputDir: curationDir,
      sourceRoot,
      indexPath: path.join(sandboxRoot, "tmp", "catalog-index", "zle-source-index.json"),
    });
    assert.equal(curation.report.summary.totalItems, 1);

    const reviewTemplate = await writeReviewDecisionTemplate({
      runId: sourceRunId,
      curationDir,
      outputDir: reviewDir,
    });
    assert.equal(reviewTemplate.manifest.decisions.length, 1);

    const approvedManifest: ReviewDecisionManifest = {
      ...reviewTemplate.manifest,
      decisions: reviewTemplate.manifest.decisions.map((entry) => ({
        ...entry,
        decision: "approved",
        resolutionType: "new_candidate",
        operatorNotes: "Approved for deterministic audit-chain validation.",
      })),
    };
    await fs.promises.writeFile(path.join(reviewDir, `${reviewRunId}.review.json`), JSON.stringify(approvedManifest, null, 2), "utf8");

    const validatedReview = await validateReviewDecisionManifest({
      runId: sourceRunId,
      curationDir,
      outputDir: reviewDir,
    });
    assert.equal(validatedReview.summary.approvedCount, 1);

    const staging = await runApprovedStagingExecutor({
      runId: stagingRunId,
      reviewRunId,
      sourceRoot,
      curationDir,
      reviewDir,
      outputDir: stagingOutputDir,
      manifestDir: stagingManifestDir,
      validateOnly: false,
    });
    assert.equal(staging.report.summary.stagedItems, 1);
    assert.equal(staging.report.summary.producedOutputs, 2);

    const gateTemplate = await writePublishGateTemplate({
      runId: gateRunId,
      outputDir: gateDir,
      reviewDir,
      stagingManifestDir,
      curationDir,
      writeTemplate: true,
    });
    const approvedGate: PublishGateManifest = {
      ...gateTemplate.manifest,
      items: gateTemplate.manifest.items.map((item) => ({
        ...item,
        releaseDecision: "ready_for_publish",
        operatorNotes: "Release approved for validate-only audit test.",
      })),
    };
    approvedGate.summary = {
      ...approvedGate.summary,
      readyForPublish: 1,
      holdCount: 0,
      rejectReleaseCount: 0,
    };
    await fs.promises.writeFile(path.join(gateDir, `${gateRunId}.publish-gate.json`), JSON.stringify(approvedGate, null, 2), "utf8");

    const normalizedGate = await runPublishGateAgent({
      runId: gateRunId,
      outputDir: gateDir,
      reviewDir,
      stagingManifestDir,
      curationDir,
    });
    assert.equal(normalizedGate.manifest.summary.readyForPublish, 1);

    const lineage = await writeLineageProof({
      runId: lineageRunId,
      sourceRunId,
      reviewRunId,
      stagingRunId,
      gateRunId,
      reviewDir,
      stagingManifestDir,
      gateDir,
      outputDir: lineageDir,
    });
    assert.equal(lineage.artifact.verdict, "pass");
    assert.deepEqual(lineage.artifact.mismatches, []);

    const publish = await runManualPublishExecutor({
      runId: stagingRunId,
      gateRunId,
      validateOnly: true,
      gateDir,
      stagingManifestDir,
      stagingRoot: stagingOutputDir,
      reportDir,
      liveRoot,
      tempRoot: path.join(sandboxRoot, "tmp"),
    });
    assert.equal(publish.report.summary.readyForPublish, 1);
    assert.equal(publish.report.summary.skipped, 1);
    assert.equal(publish.report.summary.published, 0);

    const expectedArtifacts = [
      curation.reportPath,
      curation.reviewQueuePath,
      path.join(reviewDir, `${reviewRunId}.review.json`),
      path.join(reviewDir, `${reviewRunId}.summary.md`),
      path.join(stagingManifestDir, `${stagingRunId}.staging.json`),
      path.join(stagingManifestDir, `${stagingRunId}.staging-summary.md`),
      path.join(gateDir, `${gateRunId}.publish-gate.json`),
      path.join(gateDir, `${gateRunId}.summary.md`),
      path.join(lineageDir, `${lineageRunId}.lineage.json`),
      path.join(lineageDir, `${lineageRunId}.summary.md`),
      path.join(reportDir, `${stagingRunId}.publish.json`),
      path.join(reportDir, `${stagingRunId}.summary.md`),
    ];
    for (const artifactPath of expectedArtifacts) assert.equal(fs.existsSync(artifactPath), true, artifactPath);

    const stagingReport = JSON.parse(await fs.promises.readFile(path.join(stagingManifestDir, `${stagingRunId}.staging.json`), "utf8")) as { sourceRunId: string; reviewRunId: string; runId: string; items: Array<{ sourceProductKey: string; stagingTargetKey: string }> };
    const gateManifest = JSON.parse(await fs.promises.readFile(path.join(gateDir, `${gateRunId}.publish-gate.json`), "utf8")) as { sourceRunId: string; reviewRunId: string; stagingRunId: string; items: Array<{ sourceProductKey: string; stagingTargetKey: string }> };
    assert.equal(stagingReport.sourceRunId, sourceRunId);
    assert.equal(stagingReport.reviewRunId, reviewRunId);
    assert.equal(gateManifest.sourceRunId, sourceRunId);
    assert.equal(gateManifest.reviewRunId, reviewRunId);
    assert.equal(gateManifest.stagingRunId, stagingRunId);
    assert.equal(gateManifest.items[0]?.sourceProductKey, product.sourceProductKey);
    assert.equal(stagingReport.items[0]?.stagingTargetKey, "new/mikina-zle-audit");
    assert.equal(gateManifest.items[0]?.stagingTargetKey, "new/mikina-zle-audit");

    assert.equal(await fs.promises.readFile(liveProbePath, "utf8"), "live-before");
    assert.equal(fs.existsSync(path.join(liveRoot, product.sourceProductKey, "cover.jpg")), false);
  } finally {
    for (const artifactPath of [
      path.join(curationDir, `${sourceRunId}.curation.json`),
      path.join(curationDir, `${sourceRunId}.review-queue.json`),
      path.join(curationDir, `${sourceRunId}.summary.md`),
      path.join(reviewDir, `${reviewRunId}.review.json`),
      path.join(reviewDir, `${reviewRunId}.summary.md`),
      path.join(stagingManifestDir, `${stagingRunId}.staging.json`),
      path.join(stagingManifestDir, `${stagingRunId}.staging-summary.md`),
      path.join(gateDir, `${gateRunId}.publish-gate.json`),
      path.join(gateDir, `${gateRunId}.summary.md`),
      path.join(lineageDir, `${lineageRunId}.lineage.json`),
      path.join(lineageDir, `${lineageRunId}.summary.md`),
      path.join(reportDir, `${stagingRunId}.publish.json`),
      path.join(reportDir, `${stagingRunId}.summary.md`),
    ]) {
      await fs.promises.rm(artifactPath, { force: true });
    }
    await fs.promises.rm(path.join(stagingOutputDir, stagingRunId), { recursive: true, force: true });
    await fs.promises.rm(sandboxRoot, { recursive: true, force: true });
  }
});
