import type { SourceProductRecord } from "./source-dataset.ts";

export type DeltaOutcome = "NEW" | "UNCHANGED" | "CHANGED_IDENTITY" | "CHANGED_CONTENT" | "CHANGED_IMAGES" | "AMBIGUOUS";
export type ReconciliationOutcome = "CREATE" | "UPDATE" | "KEEP" | "ARCHIVE_CANDIDATE" | "REVIEW";
export type ReconciliationMode = "bootstrap-replacement" | "incremental-sync";

export type CatalogIndexStatus = "active" | "review" | "rejected" | "unknown";

export type CatalogIndexEntry = {
  sourceProductKey: string;
  sourceUrl: string;
  sourceSlug: string;
  brandNormalized: "zle";
  titleNormalized: string;
  identityFingerprint: string;
  contentFingerprint: string;
  imageFingerprint: string;
  matchedLocalProductId: string | null;
  lastSeenAt: string;
  lastDecision: "AUTO_APPROVE" | "REVIEW" | "REJECT" | null;
  lastReconciliation: ReconciliationOutcome | null;
  lastPublishedAt: string | null;
  status: CatalogIndexStatus;
};

export type CatalogIndex = {
  version: 1;
  updatedAt: string;
  entries: CatalogIndexEntry[];
};

export type LocalCatalogProduct = {
  id: string;
  name: string;
  nameNormalized: string;
  category: string | null;
  categoryNormalized: string | null;
  sizes: string[];
  imageHints: string[];
  tokens: string[];
};

export type DeltaResult = {
  sourceProductKey: string;
  sourceUrl: string;
  identityFingerprint: string;
  contentFingerprint: string;
  imageFingerprint: string;
  delta: DeltaOutcome;
  reasonCodes: string[];
};

export type ReconciliationItem = {
  sourceProductKey: string;
  sourceUrl: string;
  delta: DeltaOutcome;
  reconciliation: ReconciliationOutcome;
  matchedLocalProductId: string | null;
  reasonCodes: string[];
  notes: string[];
};

export type ReconciliationSummary = {
  totalSourceProducts: number;
  new: number;
  unchanged: number;
  changedIdentity: number;
  changedContent: number;
  changedImages: number;
  ambiguous: number;
  create: number;
  update: number;
  keep: number;
  archiveCandidate: number;
  review: number;
  skippedUnchangedByBudget: number;
};

export type ReconciliationReport = {
  runId: string;
  createdAt: string;
  mode: ReconciliationMode;
  summary: ReconciliationSummary;
  items: ReconciliationItem[];
  archiveCandidates: Array<{ localProductId: string; reasonCodes: string[] }>;
};

export type ReconciliationLimits = {
  maxCandidatesPerRun: number;
  maxNewPerRun: number;
  maxChangedPerRun: number;
  maxReviewPerRun: number;
  maxUnchangedToInspectPerRun: number;
};

export type ReconciliationFilters = {
  category?: string;
  limit?: number;
};

export type ReconciliationInput = {
  runId: string;
  mode: ReconciliationMode;
  sourceProducts: SourceProductRecord[];
  localCatalog: LocalCatalogProduct[];
  index: CatalogIndex;
  limits: ReconciliationLimits;
  filters: ReconciliationFilters;
  lastDecision: "AUTO_APPROVE" | "REVIEW" | "REJECT" | null;
};
