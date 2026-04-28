import fs from "node:fs";
import path from "node:path";

type FindingLevel = "info" | "warning" | "risk" | "error";

type Finding = {
  level: FindingLevel;
  code: string;
  message: string;
  suggestedAction: string;
  sourceProductKey?: string;
  path?: string;
  artifact?: string;
  classification?: "benign_shared_family_image" | "suspicious_cross_product_duplicate";
  duplicateHash?: string;
  products?: string[] | null;
  files?: string[] | null;
  evidence?: Record<string, unknown> | null;
};

type SourceProduct = {
  sourceProductKey?: unknown;
  sourceSlug?: unknown;
  title?: unknown;
  downloadedImages?: unknown;
  ingestedImagePaths?: unknown;
  imageUrls?: unknown;
  downloadedImageHashes?: unknown;
};

type JsonMap = Record<string, unknown>;

type LiveImageRef = {
  sourceProductKey?: string;
  artifact: string;
  ownerKey?: string;
  path: string;
};

type LivePathClassification =
  | { kind: "managed_web"; managedWebPath: string }
  | { kind: "managed_filesystem"; managedWebPath: string }
  | { kind: "intermediate" }
  | { kind: "unsafe"; reasonCode: "live_path_contains_traversal" | "live_path_absolute_filesystem" | "live_path_prefix_invalid"; message: string };

type LivePathAuditResult = {
  isManaged: boolean;
  managedWebPath?: string;
  validManagedJpg: boolean;
};

type SourceLocalField = "downloadedImages" | "ingestedImagePaths";
type SourceLocalImagePathEntry = {
  field: SourceLocalField;
  rawPath: string;
};

type AuditReport = {
  runId: string;
  createdAt: string;
  status: "passed" | "failed";
  confidence: number;
  counts: {
    sourceProducts: number;
    checkedSourceImages: number;
    checkedLiveImages: number;
    info: number;
    warnings: number;
    risks: number;
    errors: number;
  };
  findings: Finding[];
};

type DuplicateOccurrence = {
  sourceProductKey: string;
  sourceSlug?: string;
  folder?: string;
  filePath?: string;
  slot?: string;
  sourceUrl?: string;
  isPrimary: boolean;
};

const LIVE_ROOT = path.resolve("client", "public", "images", "products");
const VALID_BASENAMES = new Set(["cover.jpg", "cover.webp", "01.jpg", "01.webp", "02.jpg", "02.webp", "03.jpg", "03.webp", "04.jpg", "04.webp"]);
const SOURCE_ARTIFACT_LABEL = "tmp/source-datasets/<runId>/products.json";

function parseArgs(argv: string[]): { runId: string } {
  let runId = "";
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--run-id") {
      runId = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
  }
  if (!runId.trim()) throw new Error("Missing --run-id <runId>");
  const normalizedRunId = runId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(normalizedRunId)) {
    throw new Error("Invalid --run-id: use letters/numbers plus dash/underscore, with optional single-dot-separated segments");
  }
  return { runId: normalizedRunId };
}

function readJsonIfPresent(filePath: string, artifactLabel: string, findings: Finding[], required = false): unknown | null {
  if (!fs.existsSync(filePath)) {
    if (required) {
      findings.push({
        level: "error",
        code: "missing_source_products_artifact",
        message: `Missing required source products artifact: ${artifactLabel}`,
        suggestedAction: "Generate source dataset artifacts for this run before running photos audit.",
        artifact: artifactLabel,
      });
    } else {
      findings.push({
        level: "warning",
        code: "missing_downstream_artifact",
        message: `Optional downstream artifact not found: ${artifactLabel}`,
        suggestedAction: "Run the corresponding pipeline stage if you need this check to include that artifact.",
        artifact: artifactLabel,
      });
    }
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    findings.push({
      level: required ? "error" : "warning",
      code: required ? "invalid_required_source_json" : "invalid_optional_json",
      message: `Invalid JSON in ${artifactLabel}: ${error instanceof Error ? error.message : String(error)}`,
      suggestedAction: "Fix artifact JSON and rerun the audit.",
      artifact: artifactLabel,
    });
    return null;
  }
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function extractLocalSourceImagePathEntries(product: SourceProduct): SourceLocalImagePathEntry[] {
  const downloadedImages = extractStringArray(product.downloadedImages).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (downloadedImages.length > 0) return downloadedImages.map((rawPath) => ({ field: "downloadedImages", rawPath }));

  const ingestedImagePaths = extractStringArray(product.ingestedImagePaths).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (ingestedImagePaths.length > 0) return ingestedImagePaths.map((rawPath) => ({ field: "ingestedImagePaths", rawPath }));

  // imageUrls represent remote URLs and must not be treated as local filesystem paths.
  return [];
}

function toPortablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function resolveSourceLocalImagePath(
  runId: string,
  entry: SourceLocalImagePathEntry,
): { ok: true; resolved: string; normalized: string } | { ok: false; code: "unsafe_absolute_source_path" | "unsafe_source_path_traversal"; message: string } {
  const portableRaw = toPortablePath(entry.rawPath);
  const normalized = path.posix.normalize(portableRaw);
  if (path.isAbsolute(entry.rawPath)) {
    return {
      ok: false,
      code: "unsafe_absolute_source_path",
      message: `Source image path is absolute (${entry.field}): ${entry.rawPath}`,
    };
  }
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return {
      ok: false,
      code: "unsafe_source_path_traversal",
      message: `Unsafe traversal in source image path (${entry.field}): ${entry.rawPath}`,
    };
  }

  if (entry.field === "downloadedImages") {
    const sourceRoot = path.resolve("tmp", "source-datasets", runId);
    const resolved = path.resolve(sourceRoot, normalized);
    const relativeToRoot = path.relative(sourceRoot, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return {
        ok: false,
        code: "unsafe_source_path_traversal",
        message: `Source image path escapes source run root (${entry.field}): ${entry.rawPath}`,
      };
    }
    return { ok: true, resolved, normalized };
  }

  const repoRoot = path.resolve(process.cwd());
  const resolved = path.resolve(repoRoot, normalized);
  const relativeToRepo = path.relative(repoRoot, resolved);
  if (relativeToRepo.startsWith("..") || path.isAbsolute(relativeToRepo)) {
    return {
      ok: false,
      code: "unsafe_source_path_traversal",
      message: `Source image path escapes repository root (${entry.field}): ${entry.rawPath}`,
    };
  }
  return { ok: true, resolved, normalized };
}

function classifyLiveOutputPath(rawPath: string): LivePathClassification {
  const portable = toPortablePath(rawPath.trim());
  const normalizedPortable = path.posix.normalize(portable);

  if (normalizedPortable === ".." || normalizedPortable.startsWith("../") || normalizedPortable.includes("/../")) {
    return {
      kind: "unsafe",
      reasonCode: "live_path_contains_traversal",
      message: `Live image path contains traversal segment: ${rawPath}`,
    };
  }

  // /images/products/* is a browser/web path and intentionally valid, even if Node considers it "absolute".
  if (normalizedPortable.startsWith("/images/products/") || normalizedPortable.startsWith("images/products/")) {
    const managedWebPath = normalizedPortable.startsWith("/") ? normalizedPortable : `/${normalizedPortable}`;
    return { kind: "managed_web", managedWebPath };
  }

  if (normalizedPortable.startsWith("client/public/images/products/")) {
    return {
      kind: "managed_filesystem",
      managedWebPath: `/${normalizedPortable.replace(/^client\/public\//, "")}`,
    };
  }

  if (normalizedPortable === "tmp" || normalizedPortable.startsWith("tmp/")) {
    return { kind: "intermediate" };
  }

  if (path.isAbsolute(rawPath)) {
    const repoRoot = path.resolve(process.cwd());
    const liveFsRoot = path.resolve(repoRoot, "client", "public", "images", "products");
    const tmpRoot = path.resolve(repoRoot, "tmp");
    const resolved = path.resolve(rawPath);

    if (resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`)) {
      return { kind: "intermediate" };
    }

    if (resolved === liveFsRoot || resolved.startsWith(`${liveFsRoot}${path.sep}`)) {
      const relative = toPortablePath(path.relative(liveFsRoot, resolved));
      if (!relative || relative === "." || relative.startsWith("..")) {
        return {
          kind: "unsafe",
          reasonCode: "live_path_prefix_invalid",
          message: `Malformed managed filesystem image path: ${rawPath}`,
        };
      }
      return { kind: "managed_filesystem", managedWebPath: `/images/products/${relative}` };
    }

    return {
      kind: "unsafe",
      reasonCode: "live_path_absolute_filesystem",
      message: `Live image path appears to be an absolute filesystem path: ${rawPath}`,
    };
  }

  return {
    kind: "unsafe",
    reasonCode: "live_path_prefix_invalid",
    message: `Live image path does not map to a managed or intermediate root: ${rawPath}`,
  };
}

function deriveStagingOwnerKey(item: JsonMap): { ownerKey?: string; confident: boolean } {
  const resolutionType = typeof item.resolutionType === "string" ? item.resolutionType : "";
  const approvedLocalProductId = typeof item.approvedLocalProductId === "string" && item.approvedLocalProductId.trim() ? item.approvedLocalProductId.trim() : undefined;
  const stagingTargetKey = typeof item.stagingTargetKey === "string" ? item.stagingTargetKey.trim() : "";

  if (resolutionType === "map_to_existing") {
    if (!approvedLocalProductId) return { confident: false };
    return { ownerKey: approvedLocalProductId, confident: true };
  }

  if (resolutionType === "new_candidate") {
    const [, key] = stagingTargetKey.split("/", 2);
    if (!key) return { confident: false };
    return { ownerKey: key, confident: true };
  }

  if (approvedLocalProductId) return { ownerKey: approvedLocalProductId, confident: true };
  return { confident: false };
}

function derivePublishOwnerKey(item: JsonMap): { ownerKey?: string; confident: boolean } {
  const liveTargetKey = typeof item.liveTargetKey === "string" && item.liveTargetKey.trim() ? item.liveTargetKey.trim() : undefined;
  if (!liveTargetKey) return { confident: false };
  return { ownerKey: liveTargetKey, confident: true };
}

function collectLiveImageRefs(staging: unknown, publish: unknown): LiveImageRef[] {
  const refs: LiveImageRef[] = [];
  const collect = (artifact: string, root: unknown, outputField: string, deriveOwner: (item: JsonMap) => { ownerKey?: string; confident: boolean }) => {
    if (!root || typeof root !== "object") return;
    const items = (root as JsonMap).items;
    if (!Array.isArray(items)) return;
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as JsonMap;
      const sourceProductKey = typeof item.sourceProductKey === "string" ? item.sourceProductKey : undefined;
      const owner = deriveOwner(item);
      const outputs = extractStringArray(item[outputField]);
      for (const output of outputs) {
        refs.push({
          sourceProductKey,
          artifact,
          ownerKey: owner.ownerKey,
          path: output,
        });
      }
      if (!owner.confident) {
        refs.push({
          sourceProductKey,
          artifact,
          ownerKey: undefined,
          path: "",
        });
      }
    }
  };

  collect("tmp/agent-manifests/<runId>.staging.json", staging, "producedOutputs", deriveStagingOwnerKey);
  collect("tmp/publish-reports/<runId>.publish.json", publish, "publishedOutputs", derivePublishOwnerKey);
  return refs;
}

function auditLiveImagePath(ref: LiveImageRef, findings: Finding[]): LivePathAuditResult {
  if (!ref.path) {
    findings.push({
      level: "risk",
      code: "ownership_not_confident",
      message: "Could not confidently derive expected live product folder for ownership check.",
      suggestedAction: "Ensure staging/publish artifact includes clear target key fields.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
    });
    return { isManaged: false, validManagedJpg: false };
  }

  const classification = classifyLiveOutputPath(ref.path);
  if (classification.kind === "intermediate") {
    findings.push({
      level: "info",
      code: "intermediate_output_path_not_live_managed",
      message: `Output path is intermediate and not a live managed path: ${ref.path}`,
      suggestedAction: "No action required unless this path is expected to be a final live output.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
      path: ref.path,
    });
    return { isManaged: false, validManagedJpg: false };
  }

  if (classification.kind === "unsafe") {
    findings.push({
      level: "risk",
      code: classification.reasonCode,
      message: classification.message,
      suggestedAction: "Normalize and restrict outputs to managed web/filesystem paths or tmp intermediate paths.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
      path: ref.path,
    });
    return { isManaged: false, validManagedJpg: false };
  }

  let valid = true;
  const p = classification.managedWebPath;
  if (p.includes("..")) {
    valid = false;
    findings.push({
      level: "risk",
      code: "live_path_contains_traversal",
      message: `Live image path contains traversal segment: ${p}`,
      suggestedAction: "Normalize and reject any output path containing traversal.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
      path: ref.path,
    });
  }
  if (p.includes("/foto/")) {
    valid = false;
    findings.push({
      level: "risk",
      code: "live_path_legacy_foto",
      message: `Live image path contains legacy /foto/ segment: ${p}`,
      suggestedAction: "Use only managed /images/products/ paths.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
      path: ref.path,
    });
  }

  const rel = p.startsWith("/") ? p.slice(1) : p;
  const segments = rel.split("/");
  if (segments.length !== 4 || segments[0] !== "images" || segments[1] !== "products") {
    valid = false;
    findings.push({
      level: "risk",
      code: "live_path_not_single_product_folder",
      message: `Live path is not scoped to exactly one product folder: ${p}`,
      suggestedAction: "Use /images/products/<product-folder>/<managed-filename> format.",
      sourceProductKey: ref.sourceProductKey,
      artifact: ref.artifact,
      path: ref.path,
    });
  } else {
    const basename = segments[3] ?? "";
    if (!VALID_BASENAMES.has(basename)) {
      valid = false;
      findings.push({
        level: "risk",
        code: "live_path_unmanaged_basename",
        message: `Live image basename is outside managed slots: ${p}`,
        suggestedAction: "Use one of the managed names: cover/01..04 with jpg/webp.",
        sourceProductKey: ref.sourceProductKey,
        artifact: ref.artifact,
        path: ref.path,
      });
    }

    if (ref.ownerKey && segments[2] !== ref.ownerKey) {
      valid = false;
      findings.push({
        level: "risk",
        code: "live_path_owner_mismatch",
        message: `Live image path folder does not match expected owner folder (${ref.ownerKey}): ${p}`,
        suggestedAction: "Ensure each item only references images inside its own target folder.",
        sourceProductKey: ref.sourceProductKey,
        artifact: ref.artifact,
        path: ref.path,
      });
    }
    if (!ref.ownerKey) {
      findings.push({
        level: "risk",
        code: "ownership_not_confident",
        message: "Could not confidently derive expected live product folder for ownership check.",
        suggestedAction: "Ensure staging/publish artifact includes clear target key fields.",
        sourceProductKey: ref.sourceProductKey,
        artifact: ref.artifact,
        path: ref.path,
      });
    }
  }

  return {
    isManaged: true,
    managedWebPath: p,
    validManagedJpg: valid && segments.length === 4 && segments[3].endsWith(".jpg"),
  };
}

function findingSortKey(finding: Finding): [number, string, string, string] {
  const severityOrder: Record<FindingLevel, number> = { error: 0, risk: 1, warning: 2, info: 3 };
  return [severityOrder[finding.level], finding.code, finding.sourceProductKey ?? "", finding.path ?? ""];
}

function normalizeFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const ka = findingSortKey(a);
    const kb = findingSortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1].localeCompare(kb[1]);
    if (ka[2] !== kb[2]) return ka[2].localeCompare(kb[2]);
    return ka[3].localeCompare(kb[3]);
  });
}

function classifySlotFromPath(rawPath: string): { slot?: string; isPrimary: boolean } {
  const portable = toPortablePath(rawPath);
  const base = path.posix.basename(portable);
  if (!base) return { isPrimary: false };
  if (base === "cover.jpg" || base === "cover.webp" || base === "01.jpg" || base === "01.webp") {
    return { slot: base, isPrimary: true };
  }
  if (/^\d{2}\.(jpg|webp)$/i.test(base)) return { slot: base, isPrimary: false };
  return { slot: base, isPrimary: false };
}

function deriveFamilyKey(value: string): string {
  const tokens = value.split("-").filter((token) => token.length > 0);
  if (tokens.length <= 3) return value;
  return tokens.slice(0, Math.max(2, tokens.length - 2)).join("-");
}

function isLikelySameFamily(occurrences: DuplicateOccurrence[]): boolean {
  const keys = new Set(
    occurrences.map((entry) => deriveFamilyKey(entry.sourceSlug?.trim() || entry.sourceProductKey)),
  );
  return keys.size === 1;
}

function calculateConfidence(findings: Finding[]): number {
  const penaltyByLevel: Record<FindingLevel, number> = { error: 40, risk: 15, warning: 3, info: 0 };
  let totalPenalty = 0;
  for (const finding of findings) {
    let penalty = penaltyByLevel[finding.level];
    if (finding.code === "duplicate_hash_cross_product_folder_risk" && finding.classification === "benign_shared_family_image") {
      penalty = 2;
    }
    totalPenalty += penalty;
  }
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

function findingDetailsLine(finding: Finding): string {
  const classification = finding.classification ? ` (${finding.classification})` : "";
  const products = Array.isArray(finding.products) && finding.products.length > 0 ? ` products=${finding.products.slice(0, 4).join(",")}${finding.products.length > 4 ? ",..." : ""}` : "";
  const files = Array.isArray(finding.files) && finding.files.length > 0 ? ` files=${finding.files.slice(0, 3).join(",")}${finding.files.length > 3 ? ",..." : ""}` : "";
  const duplicateHash = finding.duplicateHash ? ` hash=${finding.duplicateHash}` : "";
  return `- [${finding.level}] ${finding.code}${classification}: ${finding.message}${duplicateHash}${products}${files}`;
}

export async function runPhotoAudit(args: { runId: string; exitOnError?: boolean }): Promise<AuditReport> {
  const { runId, exitOnError = true } = args;

  const sourceProductsPath = path.join("tmp", "source-datasets", runId, "products.json");
  const curationPath = path.join("tmp", "curation", `${runId}.curation.json`);
  const stagingPath = path.join("tmp", "agent-manifests", `${runId}.staging.json`);
  const gatePath = path.join("tmp", "publish-gates", `${runId}.publish-gate.json`);
  const publishPath = path.join("tmp", "publish-reports", `${runId}.publish.json`);

  const findings: Finding[] = [];
  const outputDir = path.join("tmp", "photo-audits");
  await fs.promises.mkdir(outputDir, { recursive: true });

  const sourceRaw = readJsonIfPresent(sourceProductsPath, SOURCE_ARTIFACT_LABEL, findings, true);
  const curationRaw = readJsonIfPresent(curationPath, "tmp/curation/<runId>.curation.json", findings);
  const stagingRaw = readJsonIfPresent(stagingPath, "tmp/agent-manifests/<runId>.staging.json", findings);
  const gateRaw = readJsonIfPresent(gatePath, "tmp/publish-gates/<runId>.publish-gate.json", findings);
  const publishRaw = readJsonIfPresent(publishPath, "tmp/publish-reports/<runId>.publish.json", findings);
  void curationRaw;
  void gateRaw;

  let checkedSourceImages = 0;
  let sourceProductsCount = 0;

  const sourceProducts = Array.isArray(sourceRaw) ? sourceRaw : null;
  if (!sourceProducts && sourceRaw !== null) {
    findings.push({
      level: "error",
      code: "invalid_required_source_json",
      message: "Required source products artifact must be a JSON array.",
      suggestedAction: "Regenerate tmp/source-datasets/<runId>/products.json with valid product records.",
      artifact: SOURCE_ARTIFACT_LABEL,
    });
  }

  const hashOwners = new Map<string, Set<string>>();
  const hashFolders = new Map<string, Set<string>>();
  const hashOccurrences = new Map<string, DuplicateOccurrence[]>();

  if (sourceProducts) {
    sourceProductsCount = sourceProducts.length;
    for (const item of sourceProducts) {
      const product = (item && typeof item === "object" ? item : {}) as SourceProduct;
      const sourceProductKey = typeof product.sourceProductKey === "string" ? product.sourceProductKey.trim() : "";
      const title = typeof product.title === "string" ? product.title.trim() : "";

      if (!sourceProductKey) {
        findings.push({
          level: "error",
          code: "missing_source_product_key",
          message: "Source product is missing sourceProductKey.",
          suggestedAction: "Ensure every source product record includes non-empty sourceProductKey.",
          artifact: SOURCE_ARTIFACT_LABEL,
        });
        continue;
      }

      if (!title) {
        findings.push({
          level: "warning",
          code: "missing_source_title",
          message: `Source product is missing title: ${sourceProductKey}`,
          suggestedAction: "Populate title for source product records to improve audit traceability.",
          sourceProductKey,
          artifact: SOURCE_ARTIFACT_LABEL,
        });
      }

      const localSourceImagePathEntries = extractLocalSourceImagePathEntries(product);
      if (localSourceImagePathEntries.length < 1) {
        findings.push({
          level: "error",
          code: "source_product_without_downloaded_images",
          message: `Source product has no local source image paths: ${sourceProductKey}`,
          suggestedAction: "Re-run source ingest and verify at least one local source image path per source product.",
          sourceProductKey,
          artifact: SOURCE_ARTIFACT_LABEL,
        });
      }

      for (const localPathEntry of localSourceImagePathEntries) {
        checkedSourceImages += 1;
        const resolvedPath = resolveSourceLocalImagePath(runId, localPathEntry);
        if (!resolvedPath.ok) {
          findings.push({
            level: "error",
            code: resolvedPath.code,
            message: resolvedPath.message,
            suggestedAction: "Reject any path containing '..' or that escapes the source run directory.",
            sourceProductKey,
            artifact: `${SOURCE_ARTIFACT_LABEL}#${localPathEntry.field}`,
            path: localPathEntry.rawPath,
          });
          continue;
        }
        if (!fs.existsSync(resolvedPath.resolved)) {
          findings.push({
            level: "error",
            code: "missing_source_image_file",
            message: `Referenced source image file is missing (${localPathEntry.field}): ${localPathEntry.rawPath}`,
            suggestedAction: "Ensure every local source image path entry points to an existing file.",
            sourceProductKey,
            artifact: `${SOURCE_ARTIFACT_LABEL}#${localPathEntry.field}`,
            path: localPathEntry.rawPath,
          });
        }
      }

      if (Array.isArray(product.downloadedImageHashes)) {
        const hashes = product.downloadedImageHashes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        for (let hashIndex = 0; hashIndex < hashes.length; hashIndex += 1) {
          const hash = hashes[hashIndex]!;
          const localPathEntry = localSourceImagePathEntries[hashIndex];
          const resolved = localPathEntry ? resolveSourceLocalImagePath(runId, localPathEntry) : null;
          const normalizedPath = resolved && resolved.ok ? resolved.normalized : localPathEntry?.rawPath;
          const folder = normalizedPath ? path.posix.dirname(normalizedPath) : undefined;
          const slot = normalizedPath ? classifySlotFromPath(normalizedPath).slot : undefined;
          const isPrimary = normalizedPath
            ? classifySlotFromPath(normalizedPath).isPrimary
            : hashIndex === 0;
          const sourceUrl = extractStringArray(product.imageUrls)[hashIndex];

          if (!hashOwners.has(hash)) hashOwners.set(hash, new Set());
          hashOwners.get(hash)?.add(sourceProductKey);
          if (!hashFolders.has(hash)) hashFolders.set(hash, new Set());
          if (folder && folder !== ".") hashFolders.get(hash)?.add(folder);
          if (!hashOccurrences.has(hash)) hashOccurrences.set(hash, []);
          hashOccurrences.get(hash)?.push({
            sourceProductKey,
            sourceSlug: typeof product.sourceSlug === "string" ? product.sourceSlug : undefined,
            folder,
            filePath: normalizedPath,
            slot,
            sourceUrl,
            isPrimary,
          });
        }
      }
    }
  }

  for (const [hash, owners] of Array.from(hashOwners.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (owners.size > 1) {
      const folders = hashFolders.get(hash) ?? new Set<string>();
      const sharedAcrossFolders = folders.size > 1;
      findings.push({
        level: sharedAcrossFolders ? "warning" : "info",
        code: "duplicate_source_image_hash_cross_product",
        message: `Hash ${hash} appears in multiple source products (${owners.size}).`,
        suggestedAction: sharedAcrossFolders
          ? "Review potential duplicate photos reused across different folders/products."
          : "Informational: shared hash appears within one folder context.",
        sourceProductKey: Array.from(owners).sort((a, b) => a.localeCompare(b)).join(","),
        artifact: SOURCE_ARTIFACT_LABEL,
      });

      if (sharedAcrossFolders) {
        const occurrences = hashOccurrences.get(hash) ?? [];
        const products = Array.from(new Set(occurrences.map((entry) => entry.sourceProductKey))).sort((a, b) => a.localeCompare(b));
        const files = Array.from(
          new Set(
            occurrences
              .map((entry) => entry.filePath)
              .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
          ),
        ).sort((a, b) => a.localeCompare(b));
        const primaryProducts = new Set(occurrences.filter((entry) => entry.isPrimary).map((entry) => entry.sourceProductKey));
        const sameFamily = occurrences.length > 1 && isLikelySameFamily(occurrences);
        const isBenign = sameFamily && primaryProducts.size === 0;
        const classification = isBenign ? "benign_shared_family_image" : "suspicious_cross_product_duplicate";
        const riskLevel: FindingLevel = isBenign ? "warning" : "risk";
        findings.push({
          level: riskLevel,
          code: "duplicate_hash_cross_product_folder_risk",
          message: isBenign
            ? `Hash ${hash} is shared across same-family variants and appears non-primary for at least one variant.`
            : `Hash ${hash} is shared across products in different folders and includes primary image reuse.`,
          suggestedAction: isBenign
            ? "Review once, then keep as known benign shared family image if intentional."
            : "Validate source ownership/variant mapping before stage/publish to avoid cross-product contamination.",
          sourceProductKey: products.join(","),
          artifact: SOURCE_ARTIFACT_LABEL,
          classification,
          duplicateHash: hash,
          products,
          files,
          evidence: {
            hash,
            productCount: products.length,
            fileCount: files.length,
            folders: Array.from(new Set(occurrences.map((entry) => entry.folder).filter((entry): entry is string => Boolean(entry)))).sort((a, b) => a.localeCompare(b)),
            files: occurrences.map((entry) => ({
              sourceProductKey: entry.sourceProductKey,
              sourceSlug: entry.sourceSlug,
              filePath: entry.filePath ?? null,
              slot: entry.slot ?? null,
              sourceUrl: entry.sourceUrl ?? null,
              isPrimary: entry.isPrimary,
            })),
          },
        });
      }
    }
  }

  const liveRefs = collectLiveImageRefs(stagingRaw, publishRaw);
  let checkedLiveImages = 0;
  const validJpgPerItem = new Map<string, number>();
  const managedOutputSeenPerItem = new Map<string, number>();
  const referencedFolders = new Set<string>();

  for (const ref of liveRefs) {
    if (!ref.path) {
      auditLiveImagePath(ref, findings);
      continue;
    }
    checkedLiveImages += 1;
    const pathAudit = auditLiveImagePath(ref, findings);
    if (pathAudit.isManaged && pathAudit.managedWebPath) {
      const rel = pathAudit.managedWebPath.startsWith("/") ? pathAudit.managedWebPath.slice(1) : pathAudit.managedWebPath;
      const segments = rel.split("/");
      if (segments.length === 4 && segments[0] === "images" && segments[1] === "products") {
        referencedFolders.add(segments[2]);
        const key = `${ref.artifact}::${ref.sourceProductKey ?? "unknown"}`;
        managedOutputSeenPerItem.set(key, (managedOutputSeenPerItem.get(key) ?? 0) + 1);
        if (pathAudit.validManagedJpg) {
          validJpgPerItem.set(key, (validJpgPerItem.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const checkItemJpg = (artifact: string, root: unknown, field: string) => {
    if (!root || typeof root !== "object") return;
    const items = (root as JsonMap).items;
    if (!Array.isArray(items)) return;
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as JsonMap;
      const sourceProductKey = typeof item.sourceProductKey === "string" ? item.sourceProductKey : undefined;
      const outputs = extractStringArray(item[field]);
      if (outputs.length < 1) continue;
      const key = `${artifact}::${sourceProductKey ?? "unknown"}`;
      if ((managedOutputSeenPerItem.get(key) ?? 0) < 1) continue;
      if ((validJpgPerItem.get(key) ?? 0) < 1) {
        findings.push({
          level: "risk",
          code: "missing_valid_jpg_slot",
          message: "Item has image outputs but no valid managed JPG slot.",
          suggestedAction: "Ensure at least one managed JPG file (cover.jpg or 01-04.jpg) is present.",
          sourceProductKey,
          artifact,
        });
      }
    }
  };

  checkItemJpg("tmp/publish-reports/<runId>.publish.json", publishRaw, "publishedOutputs");

  if (fs.existsSync(LIVE_ROOT) && fs.statSync(LIVE_ROOT).isDirectory()) {
    const dirs = fs.readdirSync(LIVE_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    for (const folder of dirs) {
      if (!referencedFolders.has(folder)) {
        findings.push({
          level: referencedFolders.size > 0 ? "warning" : "info",
          code: "orphan_live_product_folder",
          message: `Live product folder is not referenced by current staging/publish artifacts: ${folder}`,
          suggestedAction: referencedFolders.size > 0
            ? "Review whether this folder is legacy or should be referenced by current publish artifacts."
            : "Informational: no current staging/publish references were available for orphan comparison.",
          path: `/images/products/${folder}`,
          artifact: "client/public/images/products",
        });
      }
    }
  }

  const sortedFindings = normalizeFindings(findings);
  const counts = {
    sourceProducts: sourceProductsCount,
    checkedSourceImages,
    checkedLiveImages,
    info: sortedFindings.filter((f) => f.level === "info").length,
    warnings: sortedFindings.filter((f) => f.level === "warning").length,
    risks: sortedFindings.filter((f) => f.level === "risk").length,
    errors: sortedFindings.filter((f) => f.level === "error").length,
  };

  const confidence = calculateConfidence(sortedFindings);

  const report: AuditReport = {
    runId,
    createdAt: new Date().toISOString(),
    status: counts.errors > 0 ? "failed" : "passed",
    confidence,
    counts,
    findings: sortedFindings,
  };

  const reportPath = path.join(outputDir, `${runId}.photo-audit.json`);
  const summaryPath = path.join(outputDir, `${runId}.summary.md`);
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const topCritical = sortedFindings.filter((f) => f.level === "error" || f.level === "risk").slice(0, 10);
  const nextSteps = [
    counts.errors > 0 ? "Resolve all error findings first; rerun the audit until status=passed." : "No hard errors detected; proceed with manual review of risks/warnings.",
    "Investigate ownership and path-sanity findings before staging/publish promotion.",
    "Review duplicate-hash and orphan-folder warnings to reduce accidental cross-product contamination.",
  ];

  const summaryLines = [
    `# TotalBoardShop/ZLE Photo Audit`,
    "",
    `- runId: ${runId}`,
    `- status: ${report.status}`,
    `- confidence: ${report.confidence}`,
    `- createdAt: ${report.createdAt}`,
    "",
    "## Counts",
    `- sourceProducts: ${counts.sourceProducts}`,
    `- checkedSourceImages: ${counts.checkedSourceImages}`,
    `- checkedLiveImages: ${counts.checkedLiveImages}`,
    `- info: ${counts.info}`,
    `- warnings: ${counts.warnings}`,
    `- risks: ${counts.risks}`,
    `- errors: ${counts.errors}`,
    "",
    "## Top risks/errors",
    ...(topCritical.length > 0
      ? topCritical.map((f) => findingDetailsLine(f))
      : ["- None"]),
    "",
    "## Actionable next steps",
    ...nextSteps.map((step) => `- ${step}`),
    "",
    "This audit is read-only. No files, DB records, product images, or existing pipeline artifacts were modified.",
    "",
  ];

  await fs.promises.writeFile(summaryPath, summaryLines.join("\n"), "utf8");

  if (counts.errors > 0 && exitOnError) process.exit(1);
  return report;
}

async function main(): Promise<void> {
  const { runId } = parseArgs(process.argv.slice(2));
  await runPhotoAudit({ runId, exitOnError: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
