import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PublishReportItem = {
  approvedLocalProductId?: string | null;
  liveTargetKey?: string | null;
  targetProductId?: string | null;
  status?: string | null;
  published?: boolean | null;
};

type PublishReportLike = {
  runId?: string;
  items?: PublishReportItem[];
  targetProductIds?: string[];
  targetAssetDirs?: string[];
};

type NormalizedPublishReport = {
  runId?: string;
  items: PublishReportItem[];
  targetProductIds: string[];
  targetAssetDirs: string[];
  publishedItems: PublishReportItem[];
  notPublishedItems: PublishReportItem[];
};

type LiveProductRecord = {
  id: string;
  keys: string[];
};

type ReplacementPlan = {
  liveProductId: string;
  targetProductId: string;
  liveTargetKey: string;
};

type PlanReport = {
  runId: string;
  generatedAt: string;
  liveProductsCount: number;
  liveAssetDirsCount: number;
  targetProductsCount: number;
  classifications: {
    keep: string[];
    update: string[];
    replace: ReplacementPlan[];
    retire: string[];
    reviewRequired: string[];
    orphanAssetDirs: string[];
  };
  conflicts: string[];
  notes: string[];
};

function parseRunId(argv: string[]): string {
  const flagIndex = argv.indexOf("--run-id");
  if (flagIndex === -1) throw new Error("Missing required argument --run-id <RUN_ID>");
  const runId = argv[flagIndex + 1]?.trim();
  if (!runId) throw new Error("Missing value for --run-id");
  return runId;
}

function validateRunId(runId: string): string {
  const trimmed = runId.trim();
  if (!trimmed) throw new Error("Invalid runId: empty value is not allowed.");
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error(`Invalid runId '${runId}': path separators and '..' are not allowed.`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`Invalid runId '${runId}': only [A-Za-z0-9._-] is allowed.`);
  }
  return trimmed;
}

async function assertPathInsideRoot(rootPath: string, targetPath: string, label: string): Promise<string> {
  await fs.promises.mkdir(rootPath, { recursive: true });
  const canonicalRoot = await fs.promises.realpath(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const targetParent = path.dirname(resolvedTarget);
  const canonicalParent = await fs.promises.realpath(targetParent);
  const relativeParent = path.relative(canonicalRoot, canonicalParent);
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
    throw new Error(`Unsafe ${label} path: ${targetPath} resolves outside ${rootPath}`);
  }

  if (fs.existsSync(resolvedTarget)) {
    const canonicalTarget = await fs.promises.realpath(resolvedTarget);
    const relativeTarget = path.relative(canonicalRoot, canonicalTarget);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      throw new Error(`Unsafe ${label} path: ${targetPath} resolves outside ${rootPath}`);
    }
  }

  return resolvedTarget;
}

async function readLines(filePath: string): Promise<string[]> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readProductIdLike(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function extractProductAssetKeyFromPathOrUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = normalized.match(/(?:^|https?:\/\/[^/]+)\/images\/products\/([^/?#]+)\//i);
  if (!match) return null;
  const key = match[1]?.trim();
  if (!key) return null;
  return key;
}

function inferLiveProductsFromJson(payload: unknown): LiveProductRecord[] {
  const asArray = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { products?: unknown[] }).products)
      ? (payload as { products: unknown[] }).products
      : null;

  if (!asArray) {
    throw new Error("Unrecognized live products payload shape");
  }

  const records: LiveProductRecord[] = [];
  for (const entry of asArray) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id =
      readProductIdLike(obj.id) ??
      readProductIdLike(obj.productId) ??
      readProductIdLike(obj.localProductId) ??
      readProductIdLike(obj.liveProductId);
    if (!id) continue;

    const keys = new Set<string>();
    const add = (input: unknown): void => {
      const parsed = readProductIdLike(input);
      if (parsed) keys.add(parsed);
    };

    add(obj.liveTargetKey);
    add(obj.assetDir);
    for (const key of readStringList(obj.assetDirs)) keys.add(key);
    for (const key of readStringList(obj.assetDirectories)) keys.add(key);

    const image = readProductIdLike(obj.image);
    if (image) {
      const extracted = extractProductAssetKeyFromPathOrUrl(image);
      if (extracted) keys.add(extracted);
    }

    if (Array.isArray(obj.images)) {
      for (const imageItem of obj.images) {
        if (typeof imageItem === "string") {
          const extracted = extractProductAssetKeyFromPathOrUrl(imageItem);
          if (extracted) keys.add(extracted);
          continue;
        }
        if (!imageItem || typeof imageItem !== "object") continue;
        const imageObj = imageItem as Record<string, unknown>;
        const candidates = [imageObj.url, imageObj.src, imageObj.path, imageObj.image];
        for (const candidate of candidates) {
          const candidateValue = readProductIdLike(candidate);
          if (!candidateValue) continue;
          const extracted = extractProductAssetKeyFromPathOrUrl(candidateValue);
          if (extracted) keys.add(extracted);
        }
      }
    }

    records.push({ id, keys: Array.from(keys) });
  }

  return records;
}

function validatePublishReportShape(payload: unknown): NormalizedPublishReport {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Malformed publish report: expected object");
  }

  const report = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(report, "items") && !Array.isArray(report.items)) {
    throw new Error("Malformed publish report: 'items' must be an array when provided");
  }
  if (Object.prototype.hasOwnProperty.call(report, "targetProductIds") && !Array.isArray(report.targetProductIds)) {
    throw new Error("Malformed publish report: 'targetProductIds' must be an array when provided");
  }
  if (Object.prototype.hasOwnProperty.call(report, "targetAssetDirs") && !Array.isArray(report.targetAssetDirs)) {
    throw new Error("Malformed publish report: 'targetAssetDirs' must be an array when provided");
  }

  const items = (report.items as PublishReportItem[] | undefined) ?? [];
  const { publishedItems, notPublishedItems } = classifyPublishItems(items);

  return {
    runId: typeof report.runId === "string" ? report.runId : undefined,
    items,
    targetProductIds: (report.targetProductIds as string[] | undefined) ?? [],
    targetAssetDirs: (report.targetAssetDirs as string[] | undefined) ?? [],
    publishedItems,
    notPublishedItems,
  };
}

function getEffectiveTargetProductId(item: PublishReportItem): string | null {
  return readProductIdLike(item.approvedLocalProductId) ?? readProductIdLike(item.targetProductId);
}

function classifyPublishItem(item: PublishReportItem): "published" | "not_published" {
  if (item.published === true) return "published";
  if (item.published === false) return "not_published";
  if (typeof item.status === "string") {
    const normalized = item.status.trim().toLowerCase();
    if (normalized === "published" || normalized === "success") return "published";
    if (normalized === "failed" || normalized === "skipped" || normalized === "error" || normalized === "pending" || normalized === "draft") return "not_published";
  }
  throw new Error(
    `Unknown publish state for item with liveTargetKey '${String(item.liveTargetKey ?? "")}' and approvedLocalProductId '${String(item.approvedLocalProductId ?? "")}'`,
  );
}

function classifyPublishItems(items: PublishReportItem[]): { publishedItems: PublishReportItem[]; notPublishedItems: PublishReportItem[] } {
  const publishedItems: PublishReportItem[] = [];
  const notPublishedItems: PublishReportItem[] = [];
  for (const item of items) {
    const classification = classifyPublishItem(item);
    if (classification === "published") publishedItems.push(item);
    else notPublishedItems.push(item);
  }
  return { publishedItems, notPublishedItems };
}

function inferTargetSets(report: NormalizedPublishReport): {
  targetProductIds: Set<string>;
  targetKeys: Set<string>;
  touchedProductIds: Set<string>;
  auditNotes: string[];
} {
  const targetProductIds = new Set<string>();
  const targetKeys = new Set<string>();
  const touchedProductIds = new Set<string>();
  const auditNotes: string[] = [];

  for (const id of readStringList(report.targetProductIds)) {
    targetProductIds.add(id);
  }

  for (const item of report.publishedItems) {
    const approvedId = readProductIdLike(item.approvedLocalProductId);
    const targetKey = readProductIdLike(item.liveTargetKey);
    const explicitTargetId = readProductIdLike(item.targetProductId);

    const effectiveTargetProductId = getEffectiveTargetProductId(item);
    if (effectiveTargetProductId) {
      targetProductIds.add(effectiveTargetProductId);
      touchedProductIds.add(effectiveTargetProductId);
      if (!approvedId && !explicitTargetId && targetKey) {
        auditNotes.push(`Published item with missing explicit target product id uses liveTargetKey '${targetKey}' as effective target product id.`);
      }
    }
    if (targetKey) targetKeys.add(targetKey);
  }

  return { targetProductIds, targetKeys, touchedProductIds, auditNotes };
}

function buildSummary(plan: PlanReport): string {
  const safeClassifiedCount = plan.classifications.keep.length + plan.classifications.update.length + plan.classifications.replace.length;
  const coveragePercent = plan.liveProductsCount > 0 ? (safeClassifiedCount / plan.liveProductsCount) * 100 : 0;
  const lines: string[] = [];
  lines.push("# Catalog sanitize plan summary");
  lines.push("");
  lines.push(`- Run ID: ${plan.runId}`);
  lines.push(`- Generated at: ${plan.generatedAt}`);
  lines.push(`- Live products: ${plan.liveProductsCount}`);
  lines.push(`- Live asset dirs: ${plan.liveAssetDirsCount}`);
  lines.push(`- Target products: ${plan.targetProductsCount}`);
  lines.push("");
  lines.push("## Classifications");
  lines.push(`- keep: ${plan.classifications.keep.length}`);
  lines.push(`- update: ${plan.classifications.update.length}`);
  lines.push(`- replace: ${plan.classifications.replace.length}`);
  lines.push(`- retire: ${plan.classifications.retire.length}`);
  lines.push(`- reviewRequired: ${plan.classifications.reviewRequired.length}`);
  lines.push(`- orphanAssetDirs: ${plan.classifications.orphanAssetDirs.length}`);
  lines.push(`- conflicts: ${plan.conflicts.length}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push(`- total live: ${plan.liveProductsCount}`);
  lines.push(`- safe classified: ${safeClassifiedCount}`);
  lines.push(`- coverage percent: ${coveragePercent.toFixed(1)}%`);
  lines.push("");
  lines.push("## Conflicts");
  lines.push(`- total: ${plan.conflicts.length}`);
  if (plan.conflicts.length > 0) {
    for (const conflict of plan.conflicts) lines.push(`  - ${conflict}`);
  }
  lines.push("");
  lines.push("> ⚠️ Planning-only output. This report does not apply changes, delete files, move assets, import data, or write to DB.");
  lines.push("> ⚠️ retire != delete. Manual confirmation is required before any destructive action.");
  lines.push("> ⚠️ orphanAssetDirs != delete. Orphan detection is only a planning signal, not a removal command.");
  lines.push("> ⚠️ reviewRequired requires manual review before any migration/apply decision.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runCatalogSanitizePlan(runId: string): Promise<{ planPath: string; summaryPath: string; plan: PlanReport }> {
  const safeRunId = validateRunId(runId);
  const sanitizeRoot = path.join("tmp", "catalog-sanitize");
  const liveProductsPath = path.join(sanitizeRoot, `live-products.${safeRunId}.json`);
  const liveProductIdsPath = path.join(sanitizeRoot, `live-product-ids.${safeRunId}.txt`);
  const liveAssetDirsPath = path.join(sanitizeRoot, `live-asset-dirs.${safeRunId}.txt`);
  const targetPublishReportPath = path.join("tmp", "publish-reports", `${safeRunId}.publish.json`);

  if (!fs.existsSync(targetPublishReportPath)) {
    throw new Error(`Missing required target publish report: ${targetPublishReportPath}`);
  }

  const [liveProductsRaw, liveProductIds, liveAssetDirs, publishReportRaw] = await Promise.all([
    fs.promises.readFile(liveProductsPath, "utf8"),
    readLines(liveProductIdsPath),
    readLines(liveAssetDirsPath),
    fs.promises.readFile(targetPublishReportPath, "utf8"),
  ]);

  const liveProductsJson = JSON.parse(liveProductsRaw) as unknown;
  const publishReport = validatePublishReportShape(JSON.parse(publishReportRaw) as unknown);
  if (!publishReport.runId) {
    throw new Error("Publish report runId is missing");
  }
  if (publishReport.runId !== safeRunId) {
    throw new Error(`Publish report runId mismatch: expected '${safeRunId}', got '${publishReport.runId}'`);
  }

  const liveProducts = inferLiveProductsFromJson(liveProductsJson);
  const liveProductIdSet = new Set(liveProductIds);
  const liveProductById = new Map<string, LiveProductRecord>();
  for (const product of liveProducts) {
    if (!liveProductById.has(product.id)) liveProductById.set(product.id, product);
  }

  const missingLiveMetadataIds = liveProductIds.filter((liveProductId) => !liveProductById.has(liveProductId));
  if (missingLiveMetadataIds.length > 0) {
    const preview = missingLiveMetadataIds.slice(0, 10).join(", ");
    throw new Error(
      `Live product metadata mismatch: ${missingLiveMetadataIds.length} ids from live-product-ids are missing in live-products payload: ${preview}`,
    );
  }
  const liveProductsWithNoKeys = liveProductIds.filter((liveProductId) => {
    const liveRecord = liveProductById.get(liveProductId);
    return !!liveRecord && liveRecord.keys.length < 1;
  });
  if (liveProductsWithNoKeys.length > 0) {
    const preview = liveProductsWithNoKeys.slice(0, 10).join(", ");
    throw new Error(`Live product metadata mismatch: ${liveProductsWithNoKeys.length} records have no usable asset key signal: ${preview}`);
  }

  const { targetProductIds, targetKeys, touchedProductIds, auditNotes } = inferTargetSets(publishReport);

  const replace: ReplacementPlan[] = [];
  const conflicts: string[] = [];
  const notes: string[] = [];
  notes.push(...auditNotes);
  const keep: string[] = [];
  const update: string[] = [];
  const retire: string[] = [];
  const reviewRequired: string[] = [];

  const targetByKey = new Map<string, string>();
  const ambiguousKeys = new Set<string>();

  for (const item of publishReport.publishedItems) {
    const key = readProductIdLike(item.liveTargetKey);
    const targetProductId = getEffectiveTargetProductId(item);
    if (!key || !targetProductId) continue;

    if (targetByKey.has(key) && targetByKey.get(key) !== targetProductId) {
      ambiguousKeys.add(key);
      conflicts.push(`Multiple target product ids for liveTargetKey '${key}': '${targetByKey.get(key)}' vs '${targetProductId}'`);
      continue;
    }

    targetByKey.set(key, targetProductId);
  }

  for (const liveProductId of liveProductIds) {
    const inTarget = targetProductIds.has(liveProductId);
    if (inTarget) {
      if (touchedProductIds.has(liveProductId)) update.push(liveProductId);
      else keep.push(liveProductId);
      continue;
    }

    const liveRecord = liveProductById.get(liveProductId);
    if (!liveRecord) {
      throw new Error(`Live product metadata mismatch: missing live-products record for '${liveProductId}'`);
    }
    const keys = liveRecord.keys;

    const hasAmbiguousKey = keys.some((key) => ambiguousKeys.has(key));
    if (hasAmbiguousKey) {
      reviewRequired.push(liveProductId);
      conflicts.push(`Live product '${liveProductId}' is linked to ambiguous liveTargetKey mapping.`);
      continue;
    }

    const matchingTargets = new Set<string>();
    for (const key of keys) {
      const maybeTarget = targetByKey.get(key);
      if (maybeTarget) matchingTargets.add(maybeTarget);
    }

    if (matchingTargets.size > 1) {
      reviewRequired.push(liveProductId);
      conflicts.push(`Ambiguous replacement for live product '${liveProductId}': multiple target candidates (${Array.from(matchingTargets).join(", ")})`);
      continue;
    }

    if (matchingTargets.size === 1) {
      const targetProductId = Array.from(matchingTargets)[0];
      const matchedKey = keys.find((key: string) => targetByKey.get(key) === targetProductId) ?? "";

      if (!targetProductIds.has(targetProductId)) {
        reviewRequired.push(liveProductId);
        conflicts.push(`Target mapping exists for live product '${liveProductId}' but targetProductId '${targetProductId}' is not present in target product id set.`);
        continue;
      }

      if (targetProductId !== liveProductId) {
        replace.push({
          liveProductId,
          targetProductId,
          liveTargetKey: matchedKey,
        });
      } else {
        reviewRequired.push(liveProductId);
        notes.push(`Live product '${liveProductId}' has key-based mapping signal but is not present in target product id set.`);
      }
      continue;
    }

    const hasWeakMappingSignal = keys.some((key) => targetKeys.has(key));
    if (hasWeakMappingSignal) {
      reviewRequired.push(liveProductId);
      notes.push(`Live product '${liveProductId}' missing in target but has target key overlap; manual review required.`);
      continue;
    }

    retire.push(liveProductId);
  }

  const liveKeysOwnedByProducts = new Set<string>();
  for (const product of liveProducts) {
    for (const key of product.keys) liveKeysOwnedByProducts.add(key);
  }

  const orphanAssetDirs: string[] = [];
  for (const dir of liveAssetDirs) {
    if (!liveKeysOwnedByProducts.has(dir) && !targetKeys.has(dir) && !targetProductIds.has(dir) && !liveProductIdSet.has(dir)) {
      orphanAssetDirs.push(dir);
    }
  }

  if (replace.length === 0) {
    notes.push("No explicit replace mappings inferred from publish report liveTargetKey/product-id pairs.");
  }

  if (publishReport.items.length === 0) {
    notes.push("Publish report items are empty: update/replace signals may be incomplete.");
  }
  if (publishReport.items.length < targetProductIds.size) {
    notes.push("Publish report items count is lower than target product ids count; update detection may be incomplete.");
    notes.push("Update detection depends on publishReport.items completeness.");
  }
  if (reviewRequired.length > liveProductIds.length * 0.5) {
    notes.push("High reviewRequired ratio — mapping may be incomplete.");
  }

  const plan: PlanReport = {
    runId: safeRunId,
    generatedAt: new Date().toISOString(),
    liveProductsCount: liveProductIds.length,
    liveAssetDirsCount: liveAssetDirs.length,
    targetProductsCount: targetProductIds.size,
    classifications: {
      keep: Array.from(new Set(keep)).sort(),
      update: Array.from(new Set(update)).sort(),
      replace,
      retire: Array.from(new Set(retire)).sort(),
      reviewRequired: Array.from(new Set(reviewRequired)).sort(),
      orphanAssetDirs: Array.from(new Set(orphanAssetDirs)).sort(),
    },
    conflicts,
    notes,
  };

  await fs.promises.mkdir(sanitizeRoot, { recursive: true });
  const planPath = path.join(sanitizeRoot, `${safeRunId}.plan.json`);
  const summaryPath = path.join(sanitizeRoot, `${safeRunId}.summary.md`);
  await assertPathInsideRoot(sanitizeRoot, planPath, "plan output");
  await assertPathInsideRoot(sanitizeRoot, summaryPath, "summary output");
  await fs.promises.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(summaryPath, buildSummary(plan), "utf8");

  return { planPath, summaryPath, plan };
}

async function main(): Promise<void> {
  try {
    const runId = validateRunId(parseRunId(process.argv.slice(2)));
    const result = await runCatalogSanitizePlan(runId);
    console.log(`runId ${result.plan.runId}`);
    console.log(`plan ${result.planPath}`);
    console.log(`summary ${result.summaryPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
