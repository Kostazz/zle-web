export type PublishExecutionItem = {
  sourceProductKey: string;
  resolutionType: "map_to_existing" | "new_candidate";
  approvedLocalProductId: string | null;
  liveTargetKey: string;
  plannedOutputs: string[];
  publishedOutputs: string[];
  removedManagedOutputs: string[];
  status: "published" | "failed" | "skipped";
  reasonCodes: string[];
  errorMessage?: string;
};

export type PublishExecutionSummary = {
  totalGateItems: number;
  readyForPublish: number;
  published: number;
  failed: number;
  skipped: number;
  mappedToExisting: number;
  newCandidatePublished: number;
};

export type PublishExecutionDebug = {
  hadPartialResults: boolean;
  errorStage: "validation" | "execution";
};

export type PublishExecutionReport = {
  runId: string;
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  gateRunId: string;
  createdAt: string;
  summary: PublishExecutionSummary;
  items: PublishExecutionItem[];
  debug?: PublishExecutionDebug;
};
