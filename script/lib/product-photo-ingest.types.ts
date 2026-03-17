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
  dryRun: boolean;
  productOverride?: string;
  maxImagesPerProduct: number;
  lockDir: string;
};

export type IngestReport = {
  startedAt: string;
  finishedAt: string;
  inputDir: string;
  outputDir: string;
  dryRun: boolean;
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
  errors: string[];
  products: IngestProductTrace[];
};

export type IngestRunResult = {
  report: IngestReport;
};
