export type ApprovedStagingResolution = "map_to_existing" | "new_candidate";

export type ApprovedStagingItem = {
  sourceProductKey: string;
  sourceRunId: string;
  reviewRunId: string;
  resolutionType: ApprovedStagingResolution;
  approvedLocalProductId: string | null;
  sourceImagePaths: string[];
  sourceUrl: string;
  title: string;
  imageCount: number;
  stagingTargetKey: string;
};

export type StagingExecutionItem = {
  sourceProductKey: string;
  resolutionType: ApprovedStagingResolution;
  approvedLocalProductId: string | null;
  stagingTargetKey: string;
  plannedOutputs: string[];
  producedOutputs: string[];
  status: "staged" | "failed" | "skipped";
  reasonCodes: string[];
  errorMessage?: string;
};

export type StagingExecutionSummary = {
  totalApprovedItems: number;
  selectedItems: number;
  stagedItems: number;
  failedItems: number;
  skippedItems: number;
  validateOnly: boolean;
  producedOutputs: number;
};

export type StagingExecutionReport = {
  runId: string;
  sourceRunId: string;
  reviewRunId: string;
  createdAt: string;
  summary: StagingExecutionSummary;
  items: StagingExecutionItem[];
};
