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
};

type SourceProduct = {
  sourceProductKey?: unknown;
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
  return { runId: runId.trim() };
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

function isUnsafeRelativePath(candidate: string): { unsafe: boolean; normalized: string } {
  const normalized = path.posix.normalize(candidate);
  if (path.isAbsolute(candidate)) return { unsafe: true, normalized };
  if (normalized === ".." || normalized.startsWith("../")) return { unsafe: true, normalized };
  if (normalized.includes("..")) return { unsafe: true, normalized };
  return { unsafe: false, normalized };
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function extractLocalSourceImagePaths(product: SourceProduct): string[] {
  const downloadedImages = extractStringArray(product.downloadedImages).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (downloadedImages.length > 0) return downloadedImages;

  const ingestedImagePaths = extractStringArray(product.ingestedImagePaths).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (ingestedImagePaths.length > 0) return ingestedImagePaths;

  // imageUrls represent remote URLs and must not be treated as local filesystem paths.
  return [];
}

function toPortablePath(value: string): string {
  return value.replaceAll("\\", "/");
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

async function main(): Promise<void> {
  const { runId } = parseArgs(process.argv.slice(2));

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

      const localSourceImagePaths = extractLocalSourceImagePaths(product);
      if (localSourceImagePaths.length < 1) {
        findings.push({
          level: "error",
          code: "source_product_without_downloaded_images",
          message: `Source product has no local source image paths: ${sourceProductKey}`,
          suggestedAction: "Re-run source ingest and verify at least one local source image path per source product.",
          sourceProductKey,
          artifact: SOURCE_ARTIFACT_LABEL,
        });
      }

      for (const rawRelativePath of localSourceImagePaths) {
        checkedSourceImages += 1;
        const pathCheck = isUnsafeRelativePath(rawRelativePath);
        if (path.isAbsolute(rawRelativePath)) {
          findings.push({
            level: "error",
            code: "unsafe_absolute_source_path",
            message: `Source image path is absolute: ${rawRelativePath}`,
            suggestedAction: "Store only relative image paths inside source dataset artifacts.",
            sourceProductKey,
            artifact: SOURCE_ARTIFACT_LABEL,
            path: rawRelativePath,
          });
          continue;
        }
        if (pathCheck.unsafe) {
          findings.push({
            level: "error",
            code: "unsafe_source_path_traversal",
            message: `Unsafe traversal in source image path: ${rawRelativePath}`,
            suggestedAction: "Reject any path containing '..' or that escapes the source run directory.",
            sourceProductKey,
            artifact: SOURCE_ARTIFACT_LABEL,
            path: rawRelativePath,
          });
          continue;
        }

        const resolved = path.resolve("tmp", "source-datasets", runId, pathCheck.normalized);
        const sourceRoot = path.resolve("tmp", "source-datasets", runId);
        const relativeToRoot = path.relative(sourceRoot, resolved);
        if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
          findings.push({
            level: "error",
            code: "unsafe_source_path_traversal",
            message: `Source image path escapes source run root: ${rawRelativePath}`,
            suggestedAction: "Keep source image references inside tmp/source-datasets/<runId>/.",
            sourceProductKey,
            artifact: SOURCE_ARTIFACT_LABEL,
            path: rawRelativePath,
          });
          continue;
        }
        if (!fs.existsSync(resolved)) {
          findings.push({
            level: "error",
            code: "missing_source_image_file",
            message: `Referenced source image file is missing: ${rawRelativePath}`,
            suggestedAction: "Ensure every local source image path entry points to an existing file.",
            sourceProductKey,
            artifact: SOURCE_ARTIFACT_LABEL,
            path: rawRelativePath,
          });
        }
      }

      if (Array.isArray(product.downloadedImageHashes)) {
        const hashes = product.downloadedImageHashes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        const foldersForProduct = new Set(
          localSourceImagePaths
            .map((relativePath) => path.posix.dirname(path.posix.normalize(relativePath)))
            .filter((dir) => dir && dir !== "."),
        );
        for (const hash of hashes) {
          if (!hashOwners.has(hash)) hashOwners.set(hash, new Set());
          hashOwners.get(hash)?.add(sourceProductKey);
          if (!hashFolders.has(hash)) hashFolders.set(hash, new Set());
          for (const folder of Array.from(foldersForProduct)) {
            hashFolders.get(hash)?.add(folder);
          }
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
        findings.push({
          level: "risk",
          code: "duplicate_hash_cross_product_folder_risk",
          message: `Hash ${hash} is shared across products in different folders, which can indicate ownership conflicts.`,
          suggestedAction: "Validate image ownership before stage/publish to avoid cross-product contamination.",
          sourceProductKey: Array.from(owners).sort((a, b) => a.localeCompare(b)).join(","),
          artifact: SOURCE_ARTIFACT_LABEL,
        });
      }
    }
  }

  const liveRefs = collectLiveImageRefs(stagingRaw, publishRaw);
  let checkedLiveImages = 0;
  const validJpgPerItem = new Map<string, number>();
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
        if (pathAudit.validManagedJpg) {
          const key = `${ref.artifact}::${ref.sourceProductKey ?? "unknown"}`;
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

  checkItemJpg("tmp/agent-manifests/<runId>.staging.json", stagingRaw, "producedOutputs");
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

  const confidence = Math.max(0, Math.min(100, 100 - counts.errors * 40 - counts.risks * 15 - counts.warnings * 3));

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
      ? topCritical.map((f) => `- [${f.level}] ${f.code}: ${f.message}`)
      : ["- None"]),
    "",
    "## Actionable next steps",
    ...nextSteps.map((step) => `- ${step}`),
    "",
    "This audit is read-only. No files, DB records, product images, or existing pipeline artifacts were modified.",
    "",
  ];

  await fs.promises.writeFile(summaryPath, summaryLines.join("\n"), "utf8");

  if (counts.errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
