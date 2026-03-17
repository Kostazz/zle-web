import { deriveProductFingerprints, evaluateDelta } from "./delta-engine.ts";
import { normalizeText } from "./catalog-index.ts";
import { canonicalizeCategory } from "./category-normalization.ts";
import type {
  CatalogIndex,
  CatalogIndexEntry,
  DeltaOutcome,
  LocalCatalogProduct,
  ReconciliationInput,
  ReconciliationItem,
  ReconciliationLimits,
  ReconciliationOutcome,
  ReconciliationReport,
} from "./reconciliation-types.ts";
import type { SourceProductRecord } from "./source-dataset.ts";

function tokenSet(input: string): Set<string> {
  return new Set(normalizeText(input).split(" ").filter((t) => t.length >= 2));
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of Array.from(left)) if (right.has(token)) overlap++;
  return overlap / Math.max(left.size, right.size);
}

function compatibleCategory(source: SourceProductRecord, local: LocalCatalogProduct): boolean {
  if (!source.structured.productType && !source.categoryRaw) return false;
  const sourceCategory = canonicalizeCategory(source.structured.productType ?? source.categoryRaw);
  const localCategory = canonicalizeCategory(local.category ?? local.categoryNormalized);
  if (!sourceCategory || !localCategory) return false;
  return sourceCategory === localCategory;
}

function compatibleColors(source: SourceProductRecord, local: LocalCatalogProduct): boolean {
  if (source.structured.colorTokens.length === 0) return true;
  const localTokens = new Set(local.tokens);
  return source.structured.colorTokens.every((color) => {
    const normalizedColor = normalizeText(color);
    return !normalizedColor || localTokens.has(normalizedColor);
  });
}

function findStrongMatch(source: SourceProductRecord, localCatalog: LocalCatalogProduct[]): { match: LocalCatalogProduct | null; reason: string } {
  const sourceTokens = tokenSet(`${source.title} ${source.structured.designNormalized ?? ""} ${source.structured.productType ?? ""}`);
  const scored = localCatalog
    .map((local) => {
      const localTokens = new Set(local.tokens);
      const score = overlapScore(sourceTokens, localTokens);
      return { local, score };
    })
    .filter(({ score }) => score >= 0.5)
    .filter(({ local }) => compatibleCategory(source, local))
    .filter(({ local }) => compatibleColors(source, local))
    .sort((a, b) => b.score - a.score || a.local.id.localeCompare(b.local.id));

  if (scored.length === 0) return { match: null, reason: "no_strong_candidate" };
  if (scored.length > 1 && Math.abs(scored[0].score - scored[1].score) <= 0.1) {
    return { match: null, reason: "multiple_close_candidates" };
  }

  return { match: scored[0].local, reason: "single_strong_candidate" };
}

function classify(delta: DeltaOutcome, matchedLocalProductId: string | null): ReconciliationOutcome {
  if (delta === "AMBIGUOUS" || delta === "CHANGED_IDENTITY") return "REVIEW";
  if (!matchedLocalProductId && delta === "NEW") return "CREATE";
  if (matchedLocalProductId && (delta === "CHANGED_CONTENT" || delta === "CHANGED_IMAGES" || delta === "NEW")) return "UPDATE";
  if (matchedLocalProductId && delta === "UNCHANGED") return "KEEP";
  return "REVIEW";
}

function deltaPriority(delta: DeltaOutcome): number {
  if (delta === "NEW") return 1;
  if (delta === "CHANGED_CONTENT" || delta === "CHANGED_IMAGES") return 2;
  if (delta === "AMBIGUOUS" || delta === "CHANGED_IDENTITY") return 3;
  return 4;
}

function defaultSummary(totalSourceProducts: number): ReconciliationReport["summary"] {
  return {
    totalSourceProducts,
    new: 0,
    unchanged: 0,
    changedIdentity: 0,
    changedContent: 0,
    changedImages: 0,
    ambiguous: 0,
    create: 0,
    update: 0,
    keep: 0,
    archiveCandidate: 0,
    review: 0,
    skippedUnchangedByBudget: 0,
  };
}

function countSummary(item: ReconciliationItem, summary: ReconciliationReport["summary"]): void {
  if (item.delta === "NEW") summary.new += 1;
  else if (item.delta === "UNCHANGED") summary.unchanged += 1;
  else if (item.delta === "CHANGED_IDENTITY") summary.changedIdentity += 1;
  else if (item.delta === "CHANGED_CONTENT") summary.changedContent += 1;
  else if (item.delta === "CHANGED_IMAGES") summary.changedImages += 1;
  else if (item.delta === "AMBIGUOUS") summary.ambiguous += 1;

  if (item.reconciliation === "CREATE") summary.create += 1;
  else if (item.reconciliation === "UPDATE") summary.update += 1;
  else if (item.reconciliation === "KEEP") summary.keep += 1;
  else if (item.reconciliation === "ARCHIVE_CANDIDATE") summary.archiveCandidate += 1;
  else if (item.reconciliation === "REVIEW") summary.review += 1;
}

function applyBudgets(items: ReconciliationItem[], limits: ReconciliationLimits): { selected: ReconciliationItem[]; skippedUnchanged: number } {
  const selected: ReconciliationItem[] = [];
  let newCount = 0;
  let changedCount = 0;
  let reviewCount = 0;
  let unchangedInspected = 0;
  let skippedUnchanged = 0;

  for (const item of items) {
    if (selected.length >= limits.maxCandidatesPerRun) break;

    if (item.delta === "NEW") {
      if (newCount >= limits.maxNewPerRun) continue;
      newCount++;
      selected.push(item);
      continue;
    }

    if (item.delta === "CHANGED_CONTENT" || item.delta === "CHANGED_IMAGES") {
      if (changedCount >= limits.maxChangedPerRun) continue;
      changedCount++;
      selected.push(item);
      continue;
    }

    if (item.reconciliation === "REVIEW") {
      if (reviewCount >= limits.maxReviewPerRun) continue;
      reviewCount++;
      selected.push(item);
      continue;
    }

    if (item.delta === "UNCHANGED") {
      if (unchangedInspected >= limits.maxUnchangedToInspectPerRun) {
        skippedUnchanged++;
        continue;
      }
      unchangedInspected++;
      selected.push(item);
      continue;
    }

    selected.push(item);
  }

  return { selected, skippedUnchanged };
}

function createUpdatedIndexEntry(
  source: SourceProductRecord,
  existing: CatalogIndexEntry | undefined,
  matchedLocalProductId: string | null,
  reconciliation: ReconciliationOutcome,
  lastDecision: "AUTO_APPROVE" | "REVIEW" | "REJECT" | null,
): CatalogIndexEntry {
  const fp = deriveProductFingerprints(source);
  const now = new Date().toISOString();
  return {
    sourceProductKey: source.sourceProductKey,
    sourceUrl: source.sourceUrl,
    sourceSlug: source.sourceSlug,
    brandNormalized: "zle",
    titleNormalized: fp.titleNormalized,
    identityFingerprint: fp.identityFingerprint,
    contentFingerprint: fp.contentFingerprint,
    imageFingerprint: fp.imageFingerprint,
    matchedLocalProductId,
    lastSeenAt: now,
    lastDecision,
    lastReconciliation: reconciliation,
    lastPublishedAt: existing?.lastPublishedAt ?? null,
    status: reconciliation === "REVIEW" ? "review" : reconciliation === "KEEP" || reconciliation === "UPDATE" || reconciliation === "CREATE" ? "active" : "unknown",
  };
}


function canEmitArchiveCandidates(input: ReconciliationInput, allItems: ReconciliationItem[]): boolean {
  if (input.mode !== "bootstrap-replacement") return false;
  if (input.filters.category || input.filters.limit !== undefined) return false;

  const total = allItems.length;
  const totalNew = allItems.filter((item) => item.delta === "NEW").length;
  const totalChanged = allItems.filter((item) => item.delta === "CHANGED_CONTENT" || item.delta === "CHANGED_IMAGES").length;
  const totalReview = allItems.filter((item) => item.reconciliation === "REVIEW").length;
  const totalUnchanged = allItems.filter((item) => item.delta === "UNCHANGED").length;

  if (input.limits.maxCandidatesPerRun < total) return false;
  if (input.limits.maxNewPerRun < totalNew) return false;
  if (input.limits.maxChangedPerRun < totalChanged) return false;
  if (input.limits.maxReviewPerRun < totalReview) return false;
  if (input.limits.maxUnchangedToInspectPerRun < totalUnchanged) return false;

  return true;
}
export function reconcileSourceProducts(input: ReconciliationInput): { report: ReconciliationReport; updatedEntries: CatalogIndexEntry[] } {
  const byKey = new Map(input.index.entries.map((entry) => [entry.sourceProductKey, entry]));
  const filterCategory = canonicalizeCategory(input.filters.category);
  const filtered = input.sourceProducts
    .filter((product) => {
      if (!filterCategory) return true;
      const sourceCategory = canonicalizeCategory(product.structured.productType ?? product.categoryRaw);
      return sourceCategory === filterCategory;
    })
    .slice(0, input.filters.limit ?? Number.MAX_SAFE_INTEGER);

  const candidates: ReconciliationItem[] = [];
  const updatedEntries: CatalogIndexEntry[] = [];
  const matchedLocalIds = new Set<string>();

  for (const source of filtered) {
    const existing = byKey.get(source.sourceProductKey);
    const delta = evaluateDelta(source, existing);

    let matchedLocalProductId = existing?.matchedLocalProductId ?? null;
    const reasonCodes = [...delta.reasonCodes];
    const notes: string[] = [];

    if (!matchedLocalProductId) {
      const match = findStrongMatch(source, input.localCatalog);
      if (match.match) {
        matchedLocalProductId = match.match.id;
        reasonCodes.push("matched_local_product");
        notes.push(`Matched by deterministic strong candidate: ${match.match.id}`);
      } else {
        reasonCodes.push(match.reason);
      }
    }

    if (matchedLocalProductId && matchedLocalIds.has(matchedLocalProductId)) {
      reasonCodes.push("local_product_collision");
      matchedLocalProductId = null;
    }

    let reconciliation = classify(delta.delta, matchedLocalProductId);
    if (reasonCodes.includes("multiple_close_candidates") || reasonCodes.includes("local_product_collision")) {
      reconciliation = "REVIEW";
    }

    if (reconciliation !== "REVIEW" && matchedLocalProductId) matchedLocalIds.add(matchedLocalProductId);

    const item: ReconciliationItem = {
      sourceProductKey: source.sourceProductKey,
      sourceUrl: source.sourceUrl,
      delta: delta.delta,
      reconciliation,
      matchedLocalProductId,
      reasonCodes,
      notes,
    };

    candidates.push(item);
    updatedEntries.push(createUpdatedIndexEntry(source, existing, matchedLocalProductId, reconciliation, input.lastDecision));
  }

  const ordered = [...candidates].sort((a, b) => {
    const p = deltaPriority(a.delta) - deltaPriority(b.delta);
    if (p !== 0) return p;
    return a.sourceProductKey.localeCompare(b.sourceProductKey);
  });

  const budgeted = applyBudgets(ordered, input.limits);
  const summary = defaultSummary(filtered.length);
  for (const item of budgeted.selected) countSummary(item, summary);
  summary.skippedUnchangedByBudget = budgeted.skippedUnchanged;

  const matchedAcrossFullSet = new Set(candidates.map((item) => item.matchedLocalProductId).filter((id): id is string => Boolean(id)));
  const emitArchiveCandidates = canEmitArchiveCandidates(input, candidates);
  const archiveCandidates = emitArchiveCandidates
    ? input.localCatalog
        .filter((local) => !matchedAcrossFullSet.has(local.id))
        .map((local) => ({ localProductId: local.id, reasonCodes: ["not_matched_in_bootstrap_wave"] }))
    : [];
  summary.archiveCandidate = archiveCandidates.length;

  return {
    report: {
      runId: input.runId,
      createdAt: new Date().toISOString(),
      mode: input.mode,
      summary,
      items: budgeted.selected,
      archiveCandidates,
    },
    updatedEntries,
  };
}
