import type { DeltaOutcome, ReconciliationOutcome, ReconciliationMode } from "./reconciliation-types.ts";
import type { SourceProductRecord } from "./source-dataset.ts";

export type CurationDecision = "ACCEPT_CANDIDATE" | "REVIEW_REQUIRED" | "REJECTED";
export type ProposedMapping = string | null;
export type CurationMode = ReconciliationMode;
export type CurationReasonCode =
  | "brand_not_zle"
  | "missing_source_product_key"
  | "invalid_source_product_key"
  | "missing_source_slug"
  | "missing_source_url"
  | "missing_title"
  | "missing_images"
  | "reconciliation_review"
  | "ambiguous_mapping_signal"
  | "weak_signal_requires_review"
  | "accepted_deterministic_match"
  | "accepted_valid_new_candidate"
  | "run_id_mismatch"
  | "dataset_products_count_mismatch";

export type CurationFingerprints = {
  identityFingerprint: string;
  contentFingerprint: string;
  imageFingerprint: string;
};

export type CurationItem = {
  sourceProductKey: string;
  sourceUrl: string;
  title: string;
  brandNormalized: SourceProductRecord["brandNormalized"] | string;
  categoryRaw: string;
  structured: SourceProductRecord["structured"];
  priceCzk: number | null;
  sizes: string[];
  imageCount: number;
  proposedLocalProductId: ProposedMapping;
  reconciliation: ReconciliationOutcome;
  delta: DeltaOutcome;
  curationDecision: CurationDecision;
  reasonCodes: string[];
  requiresHumanReview: boolean;
  fingerprints: CurationFingerprints;
};

export type CurationSummary = {
  totalItems: number;
  acceptedCandidates: number;
  reviewRequired: number;
  rejected: number;
  deterministicMatches: number;
  proposedNewCandidates: number;
  malformedRejected: number;
};

export type CurationReport = {
  runId: string;
  sourceRunId: string;
  createdAt: string;
  mode: CurationMode;
  summary: CurationSummary;
  items: CurationItem[];
};

export type ReviewIssueType =
  | "RECONCILIATION_REVIEW"
  | "AMBIGUOUS_MAPPING"
  | "WEAK_SIGNAL"
  | "RUN_ID_MISMATCH";

export type ReviewQueueItem = {
  sourceProductKey: string;
  sourceUrl: string;
  title: string;
  proposedLocalProductId: ProposedMapping;
  issueType: ReviewIssueType;
  reasonCodes: string[];
  humanActionRequired: string;
};

export type ReviewDecisionItem = {
  sourceProductKey: string;
  decision: "APPROVE_CANDIDATE" | "REJECT_CANDIDATE" | "MAP_TO_LOCAL_PRODUCT" | "DEFER";
  reviewer?: string;
  reviewedAt?: string;
  mappedLocalProductId?: string | null;
  notes?: string;
};

export type ReviewDecisionManifest = {
  runId: string;
  createdAt: string;
  sourceRunId: string;
  decisions: ReviewDecisionItem[];
};
