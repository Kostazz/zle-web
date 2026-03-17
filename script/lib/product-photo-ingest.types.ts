export type ProductDescriptor = {
  id: string;
  name: string;
};

export type ProductAliasMap = Map<string, Set<string>>;

export type IngestFileCandidate = {
  absolutePath: string;
  relativePath: string;
  baseName: string;
  ext: string;
  groupKey: string;
};

export type IngestGroup = {
  key: string;
  files: IngestFileCandidate[];
};

export type MatchLevel = "exact" | "prefix" | "contains";

export type MatchResult = {
  productId: string;
  level: MatchLevel;
  alias: string;
} | null;

export type IngestOptions = {
  inputDir: string;
  outputDir: string;
  reportPath: string;
  dryRun: boolean;
  productOverride?: string;
};

export type IngestReport = {
  startedAt: string;
  finishedAt: string;
  inputDir: string;
  outputDir: string;
  dryRun: boolean;
  totalFilesScanned: number;
  imageFilesAccepted: number;
  matchedProducts: string[];
  unmatchedFiles: string[];
  skippedFiles: string[];
  writtenFiles: string[];
  errors: string[];
};

export type IngestRunResult = {
  report: IngestReport;
};
