import fs from "node:fs";
import path from "node:path";
import type { RunManifest } from "./ingest-manifest.ts";
import type { IngestReport } from "./product-photo-ingest.types.ts";
import type { AuditChainRecord } from "./audit-chain.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./source-dataset.ts";

export type Decision = "AUTO_APPROVE" | "REVIEW" | "REJECT";

export type DecisionOutput = {
  runId: string;
  createdAt: string;
  decision: Decision;
  publishAllowed: boolean;
  reasonCodes: string[];
  summary: {
    errors: number;
    unmatched: number;
    suspicious: number;
    reviewItems: number;
    lockConflicts: number;
    verdict: IngestReport["verdict"] | "unknown";
  };
  artifacts: {
    datasetPath: string;
    productsPath: string;
    auditPath: string;
    reportPath: string;
    manifestPath: string;
    reviewPath: string | null;
  };
};

function readJsonFile<T>(targetPath: string): T {
  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as T;
}

function exists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

export function decideRun(runId: string, roots?: { reportDir?: string; manifestDir?: string; reviewDir?: string; sourceRoot?: string; decisionDir?: string }): DecisionOutput {
  const reportDir = roots?.reportDir ?? path.join("tmp", "agent-reports");
  const manifestDir = roots?.manifestDir ?? path.join("tmp", "agent-manifests");
  const reviewDir = roots?.reviewDir ?? path.join("tmp", "agent-review");
  const sourceRoot = roots?.sourceRoot ?? path.join("tmp", "source-datasets");

  const reportPath = path.join(reportDir, `${runId}.json`);
  const manifestPath = path.join(manifestDir, `${runId}.run.json`);
  const reviewPath = path.join(reviewDir, runId, "review.json");
  const datasetPath = path.join(sourceRoot, runId, "dataset.json");
  const productsPath = path.join(sourceRoot, runId, "products.json");
  const auditPath = path.join(sourceRoot, runId, "audit.json");

  const reasonCodes: string[] = [];

  const missing = [reportPath, manifestPath, datasetPath, productsPath, auditPath].filter((filePath) => !exists(filePath));
  if (missing.length > 0) {
    reasonCodes.push("missing_required_artifact");
    return {
      runId,
      createdAt: new Date().toISOString(),
      decision: "REJECT",
      publishAllowed: false,
      reasonCodes,
      summary: { errors: 0, unmatched: 0, suspicious: 0, reviewItems: 0, lockConflicts: 0, verdict: "unknown" },
      artifacts: {
        datasetPath,
        productsPath,
        auditPath,
        reportPath,
        manifestPath,
        reviewPath: exists(reviewPath) ? reviewPath : null,
      },
    };
  }

  let report: IngestReport;
  let manifest: RunManifest;
  let dataset: SourceDatasetManifest;
  let products: SourceProductRecord[];
  let audit: AuditChainRecord;

  try {
    report = readJsonFile<IngestReport>(reportPath);
    manifest = readJsonFile<RunManifest>(manifestPath);
    dataset = readJsonFile<SourceDatasetManifest>(datasetPath);
    products = readJsonFile<SourceProductRecord[]>(productsPath);
    audit = readJsonFile<AuditChainRecord>(auditPath);
  } catch {
    reasonCodes.push("invalid_json");
    return {
      runId,
      createdAt: new Date().toISOString(),
      decision: "REJECT",
      publishAllowed: false,
      reasonCodes,
      summary: { errors: 0, unmatched: 0, suspicious: 0, reviewItems: 0, lockConflicts: 0, verdict: "unknown" },
      artifacts: {
        datasetPath,
        productsPath,
        auditPath,
        reportPath,
        manifestPath,
        reviewPath: exists(reviewPath) ? reviewPath : null,
      },
    };
  }

  if (report.runId !== runId || manifest.runId !== runId || dataset.runId !== runId || audit.runId !== runId) {
    reasonCodes.push("run_id_mismatch");
  }

  if (report.direct || report.mode !== "staged" || manifest.publishState !== "staged") {
    reasonCodes.push("non_staged_run");
  }

  if (dataset.scope.brand !== "ZLE" || dataset.scope.matchMode !== "exact") reasonCodes.push("invalid_source_scope");
  if (dataset.source !== "totalboardshop") reasonCodes.push("invalid_source");
  if (!Array.isArray(products)) reasonCodes.push("invalid_products");

  if (products.some((product) => product.brandNormalized !== "zle")) {
    reasonCodes.push("non_zle_product_detected");
  }

  const summary = {
    errors: report.errors.length,
    unmatched: report.unmatchedFiles.length,
    suspicious: report.suspiciousInputs.length,
    reviewItems: report.reviewItems.length,
    lockConflicts: report.lockConflicts.length,
    verdict: report.verdict,
  };

  if (reasonCodes.length > 0) {
    return {
      runId,
      createdAt: new Date().toISOString(),
      decision: "REJECT",
      publishAllowed: false,
      reasonCodes,
      summary,
      artifacts: {
        datasetPath,
        productsPath,
        auditPath,
        reportPath,
        manifestPath,
        reviewPath: exists(reviewPath) ? reviewPath : null,
      },
    };
  }

  const autoApprove =
    report.direct === false &&
    report.errors.length === 0 &&
    report.unmatchedFiles.length === 0 &&
    report.suspiciousInputs.length === 0 &&
    report.lockConflicts.length === 0 &&
    report.reviewItems.length === 0 &&
    report.verdict === "success" &&
    manifest.publishState === "staged" &&
    manifest.requiresReview === false;

  if (autoApprove) {
    return {
      runId,
      createdAt: new Date().toISOString(),
      decision: "AUTO_APPROVE",
      publishAllowed: true,
      reasonCodes: [],
      summary,
      artifacts: {
        datasetPath,
        productsPath,
        auditPath,
        reportPath,
        manifestPath,
        reviewPath: exists(reviewPath) ? reviewPath : null,
      },
    };
  }

  const reviewVerdicts: Array<IngestReport["verdict"]> = ["success-with-review", "partial-failure"];
  const reviewReasonCodes: string[] = [];
  if (manifest.requiresReview === true) reviewReasonCodes.push("manifest_requires_review");
  if (report.unmatchedFiles.length > 0) reviewReasonCodes.push("unmatched_files_present");
  if (report.suspiciousInputs.length > 0) reviewReasonCodes.push("suspicious_inputs_present");
  if (report.reviewItems.length > 0) reviewReasonCodes.push("review_items_present");
  if (report.lockConflicts.length > 0) reviewReasonCodes.push("lock_conflicts_present");
  if (reviewVerdicts.includes(report.verdict)) reviewReasonCodes.push("review_verdict");

  if (reviewReasonCodes.length > 0) {
    return {
      runId,
      createdAt: new Date().toISOString(),
      decision: "REVIEW",
      publishAllowed: false,
      reasonCodes: reviewReasonCodes,
      summary,
      artifacts: {
        datasetPath,
        productsPath,
        auditPath,
        reportPath,
        manifestPath,
        reviewPath: exists(reviewPath) ? reviewPath : null,
      },
    };
  }

  return {
    runId,
    createdAt: new Date().toISOString(),
    decision: "REJECT",
    publishAllowed: false,
    reasonCodes: ["failed_verdict_or_unknown_state"],
    summary,
    artifacts: {
      datasetPath,
      productsPath,
      auditPath,
      reportPath,
      manifestPath,
      reviewPath: exists(reviewPath) ? reviewPath : null,
    },
  };
}
