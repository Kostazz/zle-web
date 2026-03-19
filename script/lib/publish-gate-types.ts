export type ReleaseDecision = "ready_for_publish" | "hold" | "reject_release";

export type PublishGateDecision = {
  sourceProductKey: string;
  releaseDecision: ReleaseDecision;
  operatorNotes?: string;
};

export type PublishGateEligibilityStatus = "eligible" | "blocked";

export type PublishGateItem = {
  sourceProductKey: string;
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  resolutionType: "map_to_existing" | "new_candidate";
  approvedLocalProductId: string | null;
  stagingTargetKey: string;
  plannedOutputs: string[];
  producedOutputs: string[];
  eligibilityStatus: PublishGateEligibilityStatus;
  reasonCodes: string[];
  releaseDecision: ReleaseDecision;
  operatorNotes?: string;
};

export type PublishGateSummary = {
  totalStagedItems: number;
  eligibleItems: number;
  blockedItems: number;
  readyForPublish: number;
  holdCount: number;
  rejectReleaseCount: number;
};

export type PublishGateManifest = {
  runId: string;
  sourceRunId: string;
  reviewRunId: string;
  stagingRunId: string;
  createdAt: string;
  summary: PublishGateSummary;
  items: PublishGateItem[];
};
