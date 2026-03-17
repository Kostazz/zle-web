import type { AssetManifest, IngestSourceType, RunManifest } from "./ingest-manifest.ts";

export type ProductDescriptor = {
  id: string;
  name: string;
};

export type ProductAliasMap = Map<string, Set<string>>;

export type MatchLevel = "exact" | "prefix" | "contains";

export type MatchResult = {
  productId: string;
  level: MatchLevel;
  alias: string;
} | null;

export type IngestFileCandidate = {
  absolutePath: string;
  relativePath: string;
  baseName: string;
  ext: string;
  parentDir: string;
};

export type ReviewIssueType =
  | "unmatched"
  | "ambiguous"
  | "suspicious"
  | "symlink"
  | "unsupported"
  | "malformed"
  | "lock-conflict";

export type ReviewItem = {
  sourceRelativePath: string;
  reason: string;
  issueType: ReviewIssueType;
  proposedProductId?: string;
  confidence?: number;
  humanActionRequired: boolean;
};

export type MatchDecision = {
  sourceRelativePath: string;
  productId: string | null;
  level: MatchLevel | "none" | "ambiguous";
  alias: string | null;
  confidence: number;
  reason: string;
};

export type SourceItemTrace = {
  sourceRelativePath: string;
  productId: string;
  slot: string;
  outputs: string[];
  outputHashes: {
    jpgSha256: string;
    webpSha256: string;
  };
  mode: "written" | "would-write" | "skipped-unchanged" | "limit-reached" | "error";
  reason?: string;
};

export type LockConflict = {
  productId: string;
  lockPath: string;
  reason: string;
};

export type IngestProductTrace = {
  productId: string;
  lockPath?: string;
  existingSlotsAtStart: string[];
  reservedSlots: string[];
  sources: SourceItemTrace[];
};

export type IngestOptions = {
  inputDir: string;
  outputDir: string;
  reportPath: string;
  summaryPath?: string;
  reviewDir?: string;
  dryRun: boolean;
  productOverride?: string;
  maxImagesPerProduct: number;
  lockDir: string;
  runId?: string;
  sourceType?: IngestSourceType;
  staged?: boolean;
  direct?: boolean;
  stagingDir?: string;
  manifestDir?: string;
};

export type IngestReport = {
  runId: string;
  sourceType: IngestSourceType;
  startedAt: string;
  finishedAt: string;
  inputDir: string;
  outputDir: string;
  mode: "dry-run" | "staged" | "direct";
  dryRun: boolean;
  staged: boolean;
  direct: boolean;
  maxImagesPerProduct: number;
  totalFilesScanned: number;
  imageFilesAccepted: number;
  matchedProducts: string[];
  matchedFiles: string[];
  unmatchedFiles: string[];
  ignoredFiles: string[];
  skippedFiles: string[];
  skippedUnchangedFiles: string[];
  writtenFiles: string[];
  simulatedFiles: string[];
  lockConflicts: LockConflict[];
  matchDecisions: MatchDecision[];
  suspiciousInputs: string[];
  reviewItems: ReviewItem[];
  reviewManifestPath?: string;
  summaryPath?: string;
  verdict: "success" | "success-with-review" | "partial-failure" | "failed";
  errors: string[];
  products: IngestProductTrace[];
};

export type IngestRunResult = {
  report: IngestReport;
  runManifest?: RunManifest;
  assetManifests?: AssetManifest[];
};
