import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { products } from "../../client/src/data/products.ts";
import {
  createRunId,
  type AssetManifest,
  type IngestSourceType,
  type ProductDraftPayload,
  type PublishState,
  type RunManifest,
} from "./ingest-manifest.ts";
import { computeAssetFingerprint, loadAssetIndex, saveAssetIndex, upsertAssetFingerprint } from "./asset-fingerprint.ts";
import type {
  IngestFileCandidate,
  IngestOptions,
  IngestProductTrace,
  IngestReport,
  IngestRunResult,
  LockConflict,
  MatchDecision,
  MatchLevel,
  MatchResult,
  ProductAliasMap,
  ProductDescriptor,
  ReviewItem,
  SourceItemTrace,
} from "./product-photo-ingest.types.ts";

const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SLOT_SCAN_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SKIP_DIR_NAMES = new Set([".git", ".github", "node_modules"]);
const MAX_WIDTH = 2000;
const JPEG_QUALITY = 86;
const WEBP_QUALITY = 82;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const LIVE_OUTPUT_ROOT = path.resolve(process.cwd(), "client", "public", "images", "products");

const PRODUCT_DESCRIPTORS: ProductDescriptor[] = products.map((product) => ({ id: product.id, name: product.name }));

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeForReport(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "?")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "?");
}


function isPathInside(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertSafeWritePath(pathToWrite: string, allowedRoots: string[]): void {
  const resolved = path.resolve(pathToWrite);
  if (!allowedRoots.some((root) => isPathInside(root, resolved))) {
    throw new Error(`Unsafe write path blocked: ${sanitizeForReport(resolved)}`);
  }
}

async function assertNoSymlinkInPathChain(targetPath: string, stopAtRoot: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(stopAtRoot);
  if (!isPathInside(normalizedRoot, normalizedTarget)) {
    throw new Error(`Path escape blocked: ${sanitizeForReport(normalizedTarget)}`);
  }

  const stack: string[] = [];
  let current = normalizedTarget;
  while (true) {
    stack.push(current);
    if (current === normalizedRoot) break;
    const next = path.dirname(current);
    if (next === current) {
      throw new Error(`Unsafe root boundary for path: ${sanitizeForReport(normalizedTarget)}`);
    }
    current = next;
  }

  for (const candidate of stack) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const stat = await fs.promises.lstat(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink path blocked: ${sanitizeForReport(candidate)}`);
    }
  }
}

async function ensureSafeDir(targetDir: string, rootDir: string): Promise<void> {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(targetDir);
  assertSafeWritePath(normalizedTarget, [normalizedRoot]);
  await fs.promises.mkdir(normalizedTarget, { recursive: true });
  await assertNoSymlinkInPathChain(normalizedTarget, normalizedRoot);
}

async function safeWriteFile(targetPath: string, content: Buffer | string, rootDir: string): Promise<void> {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(targetPath);
  assertSafeWritePath(normalizedTarget, [normalizedRoot]);
  await ensureSafeDir(path.dirname(normalizedTarget), normalizedRoot);
  await assertNoSymlinkInPathChain(path.dirname(normalizedTarget), normalizedRoot);

  if (fs.existsSync(normalizedTarget)) {
    const stat = await fs.promises.lstat(normalizedTarget);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink target blocked: ${sanitizeForReport(normalizedTarget)}`);
    }
  }

  await fs.promises.writeFile(normalizedTarget, content);
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalizeName(value).split(" ").filter(Boolean);
}

function detectSuspiciousInput(relativePath: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(relativePath)) return "control chars in path";
  if (relativePath.includes("..") || relativePath.includes("\\") || relativePath.startsWith("/")) return "traversal-like path";
  if (/\.(txt|md|json)$/i.test(relativePath) && /(ignore|override|prompt|approved|manifest|upload)/i.test(relativePath)) {
    return "instruction-like sidecar file";
  }
  return null;
}

export function scanInputFiles(inputDir: string): {
  scanned: number;
  accepted: IngestFileCandidate[];
  ignored: string[];
  suspicious: string[];
  symlinked: string[];
} {
  const accepted: IngestFileCandidate[] = [];
  const ignored: string[] = [];
  const suspicious: string[] = [];
  const symlinked: string[] = [];
  let scanned = 0;

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const stat = fs.lstatSync(fullPath);
      const relativePath = sanitizeForReport(toPortablePath(path.relative(inputDir, fullPath)));
      scanned += 1;

      if (stat.isSymbolicLink()) {
        symlinked.push(relativePath);
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const suspiciousReason = detectSuspiciousInput(relativePath);
      if (suspiciousReason) suspicious.push(`${relativePath} (${suspiciousReason})`);

      const ext = path.extname(fullPath).toLowerCase();
      if (!INPUT_EXTENSIONS.has(ext)) {
        ignored.push(relativePath);
        continue;
      }

      accepted.push({
        absolutePath: fullPath,
        relativePath,
        baseName: path.basename(fullPath, path.extname(fullPath)),
        ext,
        parentDir: toPortablePath(path.dirname(relativePath)),
      });
    }
  };

  walk(inputDir);
  accepted.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { scanned, accepted, ignored, suspicious, symlinked };
}

function addAlias(aliasMap: ProductAliasMap, productId: string, alias: string): void {
  const normalized = normalizeName(alias);
  if (!normalized) return;
  const current = aliasMap.get(productId) ?? new Set<string>();
  current.add(normalized);
  aliasMap.set(productId, current);
}

export function buildProductAliases(list: ProductDescriptor[]): ProductAliasMap {
  const aliases: ProductAliasMap = new Map();
  for (const product of list) {
    const idTokens = tokenize(product.id);
    const nameTokens = tokenize(product.name);
    addAlias(aliases, product.id, product.id);
    addAlias(aliases, product.id, product.name);
    if (idTokens.length > 0) {
      addAlias(aliases, product.id, idTokens.join(" "));
      if (idTokens[0] === "zle") addAlias(aliases, product.id, idTokens.slice(1).join(" "));
    }
    if (nameTokens.length > 0) {
      addAlias(aliases, product.id, nameTokens.join(" "));
      if (nameTokens[0] === "zle") addAlias(aliases, product.id, nameTokens.slice(1).join(" "));
    }
  }
  return aliases;
}

function evaluateMatchLevel(context: string, alias: string): MatchLevel | null {
  if (context === alias) return "exact";
  if (context.startsWith(`${alias} `) || context.endsWith(` ${alias}`) || context.startsWith(alias)) return "prefix";
  if (context.includes(alias)) return "contains";
  return null;
}

export function matchProduct(candidate: IngestFileCandidate, aliases: ProductAliasMap): MatchResult {
  const contexts = [candidate.baseName, candidate.parentDir, candidate.relativePath].map((v) => normalizeName(v)).filter(Boolean);
  const rank: Record<MatchLevel, number> = { exact: 3, prefix: 2, contains: 1 };
  const hits = new Map<string, { level: MatchLevel; alias: string }>();

  for (const context of contexts) {
    for (const [productId, aliasSet] of Array.from(aliases.entries())) {
      for (const alias of Array.from(aliasSet.values())) {
        const level = evaluateMatchLevel(context, alias);
        if (!level) continue;
        const current = hits.get(productId);
        if (!current || rank[level] > rank[current.level]) hits.set(productId, { level, alias });
      }
    }
  }

  if (hits.size === 0) return null;
  const ranked = Array.from(hits.entries()).sort((a, b) => rank[b[1].level] - rank[a[1].level]);
  if (ranked.length > 1 && rank[ranked[0][1].level] === rank[ranked[1][1].level]) return null;
  return { productId: ranked[0][0], level: ranked[0][1].level, alias: ranked[0][1].alias };
}

export async function ensureDir(targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
}

function isSlotName(baseName: string): boolean {
  return baseName === "cover" || /^\d{2}$/.test(baseName);
}

export function readExistingProductSlots(targetDir: string): Set<string> {
  if (!fs.existsSync(targetDir)) return new Set<string>();
  const slots = new Set<string>();
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SLOT_SCAN_EXTENSIONS.has(ext)) continue;
    const baseName = path.basename(entry.name, path.extname(entry.name));
    if (isSlotName(baseName)) slots.add(baseName);
  }
  return slots;
}

function peekNextSlot(existingSlots: Set<string>, inMemoryReservations: Set<string>, maxSlots: number): string | null {
  const used = new Set<string>([...Array.from(existingSlots.values()), ...Array.from(inMemoryReservations.values())]);
  if (used.size >= maxSlots) return null;
  if (!used.has("cover")) {
    return "cover";
  }
  for (let i = 1; i < maxSlots; i++) {
    const slot = String(i).padStart(2, "0");
    if (!used.has(slot)) {
      return slot;
    }
  }
  return null;
}

export function reserveNextSlot(existingSlots: Set<string>, inMemoryReservations: Set<string>, maxSlots: number): string | null {
  const slot = peekNextSlot(existingSlots, inMemoryReservations, maxSlots);
  if (!slot) {
    return null;
  }
  inMemoryReservations.add(slot);
  return slot;
}

async function renderOutputsWithSharp(sourcePath: string): Promise<{ jpg: Buffer; webp: Buffer }> {
  const meta = await sharp(sourcePath, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if ((meta.size ?? 0) > MAX_INPUT_BYTES) throw new Error(`input_too_large:${meta.size}`);
  const base = sharp(sourcePath, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({
    width: MAX_WIDTH,
    fit: "inside",
    withoutEnlargement: true,
  });
  const [jpg, webp] = await Promise.all([
    base.clone().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
    base.clone().webp({ quality: WEBP_QUALITY }).toBuffer(),
  ]);
  return { jpg, webp };
}

async function compareExisting(targetPath: string, content: Buffer, rootDir: string): Promise<boolean> {
  const normalizedTarget = path.resolve(targetPath);
  assertSafeWritePath(normalizedTarget, [path.resolve(rootDir)]);
  if (!fs.existsSync(targetPath)) return false;
  const stat = await fs.promises.lstat(normalizedTarget);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink compare target blocked: ${sanitizeForReport(normalizedTarget)}`);
  }
  const existing = await fs.promises.readFile(targetPath);
  return sha256(existing) === sha256(content);
}

function safeRelativeToCwd(targetPath: string): string {
  return toPortablePath(path.relative(process.cwd(), targetPath));
}

function createProductTrace(productId: string, existingSlotsAtStart: Set<string>, lockPath: string): IngestProductTrace {
  return {
    productId,
    lockPath: safeRelativeToCwd(lockPath),
    existingSlotsAtStart: Array.from(existingSlotsAtStart).sort(),
    reservedSlots: [],
    sources: [],
  };
}

function buildLockPath(lockDir: string, productId: string): string {
  return path.join(lockDir, `photo-ingest-${productId}.lock`);
}

function tryAcquireLock(lockPath: string): number | null {
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
    return fd;
  } catch {
    return null;
  }
}

async function releaseLock(lockPath: string, fd: number | null): Promise<void> {
  if (fd !== null) fs.closeSync(fd);
  if (fs.existsSync(lockPath)) await fs.promises.unlink(lockPath);
}

async function writeReport(reportPath: string, report: IngestReport): Promise<void> {
  await safeWriteFile(reportPath, JSON.stringify(report, null, 2), path.dirname(reportPath));
}

async function writeSummary(summaryPath: string, report: IngestReport): Promise<void> {
  const lines = [
    `# Photo ingest summary`,
    `- runId: ${report.runId}`,
    `- sourceType: ${report.sourceType}`,
    `- mode: ${report.mode}`,
    `- input path: ${report.inputDir}`,
    `- effective output path: ${report.outputDir}`,
    `- total scanned: ${report.totalFilesScanned}`,
    `- accepted images: ${report.imageFilesAccepted}`,
    `- matched products count: ${report.matchedProducts.length}`,
    `- matched files count: ${report.matchedFiles.length}`,
    `- unmatched files count: ${report.unmatchedFiles.length}`,
    `- skipped unchanged count: ${report.skippedUnchangedFiles.length}`,
    `- lock conflicts: ${report.lockConflicts.length}`,
    `- suspicious/skipped inputs: ${report.suspiciousInputs.length}`,
    `- errors: ${report.errors.length}`,
    `- final verdict: ${report.verdict}`,
    "",
    "## Matched products with assigned slots",
    ...report.products.map((p) => `- ${p.productId}: ${p.reservedSlots.join(", ") || "none"}`),
    "",
    "## Unmatched files",
    ...(report.unmatchedFiles.length ? report.unmatchedFiles.map((f) => `- ${f}`) : ["- none"]),
    "",
    "## Review-required",
    ...(report.reviewItems.length ? report.reviewItems.map((i) => `- ${i.sourceRelativePath}: ${i.reason}`) : ["- none"]),
  ];
  await safeWriteFile(summaryPath, `${lines.join("\n")}\n`, path.dirname(summaryPath));
}

async function writeProductMetadata(targetDir: string, trace: IngestProductTrace, dryRun: boolean, report: IngestReport): Promise<void> {
  const metaPath = path.join(targetDir, ".ingest-meta.json");
  const body = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      dryRun,
      productId: trace.productId,
      existingSlotsAtStart: trace.existingSlotsAtStart,
      reservedSlots: trace.reservedSlots,
      sources: trace.sources,
    },
    null,
    2,
  );
  if (dryRun) {
    report.simulatedFiles.push(safeRelativeToCwd(metaPath));
    return;
  }
  await safeWriteFile(metaPath, body, targetDir);
  report.writtenFiles.push(safeRelativeToCwd(metaPath));
}

function toConfidence(level: MatchLevel | null): number {
  if (!level) return 0;
  if (level === "exact") return 1;
  if (level === "prefix") return 0.75;
  return 0.5;
}

function toVerdict(report: IngestReport): IngestReport["verdict"] {
  if (report.errors.length > 0 && report.writtenFiles.length === 0 && report.simulatedFiles.length === 0) return "failed";
  if (report.errors.length > 0) return "partial-failure";
  if (report.unmatchedFiles.length > 0 || report.reviewItems.length > 0) return "success-with-review";
  return "success";
}

function resolveMode(options: IngestOptions): IngestReport["mode"] {
  if (options.dryRun) {
    return "dry-run";
  }

  if (options.staged === false && options.direct !== true) {
    throw new Error("Invalid mode: staged:false requires direct:true");
  }

  return options.direct === true ? "direct" : "staged";
}

function deriveRunPublishState(report: IngestReport): PublishState {
  if (report.mode !== "direct") {
    return "staged";
  }

  if (report.verdict === "failed") {
    return "failed";
  }

  if (report.verdict === "success") {
    return "published";
  }

  return "partial";
}

export async function runProductPhotoIngest(options: IngestOptions): Promise<IngestRunResult> {
  const runId = options.runId ?? createRunId("ingest");
  const sourceType: IngestSourceType = options.sourceType ?? "local";
  const mode = resolveMode(options);
  const direct = mode === "direct";
  const staged = mode !== "direct";

  const normalizedInput = path.resolve(process.cwd(), options.inputDir);
  const normalizedOutputBase = staged
    ? path.resolve(process.cwd(), options.stagingDir ?? path.join("tmp", "agent-staging", runId))
    : path.resolve(process.cwd(), options.outputDir);
  const normalizedReportPath = path.resolve(process.cwd(), options.reportPath);
  const summaryPath = path.resolve(process.cwd(), options.summaryPath ?? path.join("tmp", "agent-reports", `${runId}.summary.md`));
  const normalizedLockDir = path.resolve(process.cwd(), options.lockDir);
  const manifestDir = path.resolve(process.cwd(), options.manifestDir ?? path.join("tmp", "agent-manifests"));
  const reviewDir = path.resolve(process.cwd(), options.reviewDir ?? path.join("tmp", "agent-review"));

  if (!options.inputDir?.trim()) throw new Error("--input is required");
  if (!fs.existsSync(normalizedInput)) throw new Error(`Input directory does not exist: ${normalizedInput}`);
  const inputRealPath = await fs.promises.realpath(normalizedInput);
  const repoRoot = path.resolve(process.cwd());
  if (inputRealPath === repoRoot || inputRealPath === path.parse(inputRealPath).root) {
    throw new Error("Refusing dangerous broad input path");
  }
  if (options.maxImagesPerProduct < 1 || !Number.isInteger(options.maxImagesPerProduct)) {
    throw new Error("--max-images-per-product must be a positive integer");
  }

  if (direct) {
    if (!isPathInside(LIVE_OUTPUT_ROOT, normalizedOutputBase)) {
      throw new Error(`Direct mode output must stay inside ${toPortablePath(path.relative(process.cwd(), LIVE_OUTPUT_ROOT))}`);
    }
    await assertNoSymlinkInPathChain(normalizedOutputBase, LIVE_OUTPUT_ROOT);
  }

  if (!direct && isPathInside(LIVE_OUTPUT_ROOT, normalizedOutputBase)) {
    throw new Error("Live output path is forbidden unless mode is direct");
  }

  const knownProducts = new Set(PRODUCT_DESCRIPTORS.map((item) => item.id));
  if (options.productOverride && !knownProducts.has(options.productOverride)) {
    throw new Error(`Unknown product override: ${options.productOverride}`);
  }

  const allowedRoots = [normalizedOutputBase, path.dirname(normalizedReportPath), path.dirname(summaryPath), manifestDir, reviewDir].map((p) =>
    path.resolve(p),
  );
  assertSafeWritePath(normalizedReportPath, allowedRoots);
  assertSafeWritePath(summaryPath, allowedRoots);
  await assertNoSymlinkInPathChain(path.dirname(normalizedReportPath), path.dirname(normalizedReportPath));
  await assertNoSymlinkInPathChain(path.dirname(summaryPath), path.dirname(summaryPath));
  await ensureSafeDir(manifestDir, manifestDir);
  await ensureSafeDir(reviewDir, reviewDir);

  const report: IngestReport = {
    runId,
    sourceType,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    inputDir: options.inputDir,
    outputDir: safeRelativeToCwd(normalizedOutputBase),
    mode,
    dryRun: options.dryRun,
    staged,
    direct,
    maxImagesPerProduct: options.maxImagesPerProduct,
    totalFilesScanned: 0,
    imageFilesAccepted: 0,
    matchedProducts: [],
    matchedFiles: [],
    unmatchedFiles: [],
    ignoredFiles: [],
    skippedFiles: [],
    skippedUnchangedFiles: [],
    writtenFiles: [],
    simulatedFiles: [],
    lockConflicts: [],
    matchDecisions: [],
    suspiciousInputs: [],
    reviewItems: [],
    verdict: "success",
    errors: [],
    products: [],
  };

  await ensureDir(normalizedLockDir);
  const aliasMap = buildProductAliases(PRODUCT_DESCRIPTORS);
  const scan = scanInputFiles(normalizedInput);
  report.totalFilesScanned = scan.scanned;
  report.imageFilesAccepted = scan.accepted.length;
  report.ignoredFiles = scan.ignored;
  report.suspiciousInputs.push(...scan.suspicious, ...scan.symlinked.map((item) => `${item} (symlink skipped)`));

  const reservationByProduct = new Map<string, Set<string>>();
  const existingSlotsByProduct = new Map<string, Set<string>>();
  const traceByProduct = new Map<string, IngestProductTrace>();
  const locksHeld = new Map<string, { fd: number; path: string }>();
  const lockBlockedProducts = new Set<string>();
  const matchedProductSet = new Set<string>();
  const assetManifests: AssetManifest[] = [];
  let assetIndex;
  try {
    assetIndex = await loadAssetIndex();
  } catch (error) {
    throw new Error(`Asset index unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    for (const candidate of scan.accepted) {
      const match = options.productOverride
        ? ({ productId: options.productOverride, level: "exact", alias: options.productOverride } satisfies NonNullable<MatchResult>)
        : matchProduct(candidate, aliasMap);

      if (!match) {
        report.matchDecisions.push({
          sourceRelativePath: candidate.relativePath,
          productId: null,
          level: "none",
          alias: null,
          confidence: 0,
          reason: "no conservative alias match",
        } satisfies MatchDecision);
        report.unmatchedFiles.push(candidate.relativePath);
        report.reviewItems.push({
          sourceRelativePath: candidate.relativePath,
          reason: "unmatched product",
          issueType: "unmatched",
          humanActionRequired: true,
        } satisfies ReviewItem);
        assetManifests.push({
          assetId: `${runId}:${candidate.relativePath}`,
          runId,
          sourceType,
          sourceRelativePath: candidate.relativePath,
          productId: null,
          matchedConfidence: 0,
          requiresReview: true,
          approvalState: "pending",
          publishState: "staged",
          outputs: [],
          errors: ["unmatched_product"],
        });
        continue;
      }

      report.matchDecisions.push({
        sourceRelativePath: candidate.relativePath,
        productId: match.productId,
        level: match.level,
        alias: match.alias,
        confidence: toConfidence(match.level),
        reason: `matched by alias '${match.alias}'`,
      });

      const productId = match.productId;
      matchedProductSet.add(productId);
      report.matchedFiles.push(candidate.relativePath);
      const targetDir = path.join(normalizedOutputBase, productId);
      assertSafeWritePath(targetDir, [normalizedOutputBase]);

      if (lockBlockedProducts.has(productId)) {
        report.skippedFiles.push(candidate.relativePath);
        continue;
      }

      if (!locksHeld.has(productId)) {
        const lockPath = buildLockPath(normalizedLockDir, productId);
        const lockFd = tryAcquireLock(lockPath);
        if (lockFd === null) {
          const conflict: LockConflict = {
            productId,
            lockPath: safeRelativeToCwd(lockPath),
            reason: "lock already held by another ingest process",
          };
          report.lockConflicts.push(conflict);
          report.errors.push(`Lock conflict for ${productId}: ${conflict.lockPath}`);
          report.reviewItems.push({
            sourceRelativePath: candidate.relativePath,
            reason: `lock conflict for ${productId}`,
            issueType: "lock-conflict",
            proposedProductId: productId,
            confidence: 1,
            humanActionRequired: true,
          });
          lockBlockedProducts.add(productId);
          report.skippedFiles.push(candidate.relativePath);
          continue;
        }

        locksHeld.set(productId, { fd: lockFd, path: lockPath });
        const existingSlots = readExistingProductSlots(targetDir);
        existingSlotsByProduct.set(productId, existingSlots);
        reservationByProduct.set(productId, new Set());
        const trace = createProductTrace(productId, existingSlots, lockPath);
        traceByProduct.set(productId, trace);
        report.products.push(trace);
      }

      const existingSlots = existingSlotsByProduct.get(productId);
      const reservations = reservationByProduct.get(productId);
      const trace = traceByProduct.get(productId);
      if (!existingSlots || !reservations || !trace) {
        report.errors.push(`Internal state error for product ${productId}`);
        continue;
      }

      const slot = peekNextSlot(existingSlots, reservations, options.maxImagesPerProduct);
      if (!slot) {
        trace.sources.push({
          sourceRelativePath: candidate.relativePath,
          productId,
          slot: "",
          outputs: [],
          outputHashes: { jpgSha256: "", webpSha256: "" },
          mode: "limit-reached",
          reason: `max images per product (${options.maxImagesPerProduct}) reached`,
        });
        report.skippedFiles.push(candidate.relativePath);
        report.reviewItems.push({
          sourceRelativePath: candidate.relativePath,
          reason: `slot limit reached for ${productId}`,
          issueType: "unsupported",
          proposedProductId: productId,
          confidence: toConfidence(match.level),
          humanActionRequired: true,
        });
        continue;
      }

      const jpgOutputPath = path.join(targetDir, `${slot}.jpg`);
      const webpOutputPath = path.join(targetDir, `${slot}.webp`);
      assertSafeWritePath(jpgOutputPath, [normalizedOutputBase]);
      assertSafeWritePath(webpOutputPath, [normalizedOutputBase]);
      const draftPayload: ProductDraftPayload = { productId, category: products.find((p) => p.id === productId)?.category };

      try {
        const fingerprint = await computeAssetFingerprint(candidate.absolutePath);
        const dedupe = options.dryRun ? { duplicateCandidateOf: null } : upsertAssetFingerprint(assetIndex, fingerprint, candidate.relativePath, runId);

        if (dedupe.duplicateCandidateOf) {
          trace.sources.push({
            sourceRelativePath: candidate.relativePath,
            productId,
            slot,
            outputs: [],
            outputHashes: { jpgSha256: "", webpSha256: "" },
            mode: "skipped-unchanged",
            reason: `duplicate candidate of ${dedupe.duplicateCandidateOf}`,
          });
          report.skippedFiles.push(candidate.relativePath);
          report.reviewItems.push({
            sourceRelativePath: candidate.relativePath,
            reason: `duplicate candidate of ${dedupe.duplicateCandidateOf}`,
            issueType: "suspicious",
            proposedProductId: productId,
            confidence: toConfidence(match.level),
            humanActionRequired: true,
          });
          assetManifests.push({
            assetId: `${runId}:${candidate.relativePath}`,
            runId,
            sourceType,
            sourceRelativePath: candidate.relativePath,
            productId,
            matchedConfidence: toConfidence(match.level),
            requiresReview: true,
            approvalState: "pending",
            publishState: direct ? "published" : "staged",
            outputs: [],
            errors: [`duplicate_candidate_of:${dedupe.duplicateCandidateOf}`],
            duplicateCandidateOf: dedupe.duplicateCandidateOf,
            productDraft: draftPayload,
          });
          continue;
        }

        const rendered = await renderOutputsWithSharp(candidate.absolutePath);
        const jpgSame = await compareExisting(jpgOutputPath, rendered.jpg, normalizedOutputBase);
        const webpSame = await compareExisting(webpOutputPath, rendered.webp, normalizedOutputBase);
        const outputPaths = [safeRelativeToCwd(jpgOutputPath), safeRelativeToCwd(webpOutputPath)];

        const sourceTrace: SourceItemTrace = {
          sourceRelativePath: candidate.relativePath,
          productId,
          slot,
          outputs: outputPaths,
          outputHashes: { jpgSha256: sha256(rendered.jpg), webpSha256: sha256(rendered.webp) },
          mode: "written",
        };

        assetManifests.push({
          assetId: `${runId}:${candidate.relativePath}`,
          runId,
          sourceType,
          sourceRelativePath: candidate.relativePath,
          productId,
          matchedConfidence: toConfidence(match.level),
          requiresReview: Boolean(dedupe.duplicateCandidateOf),
          approvalState: "pending",
          publishState: direct ? "published" : "staged",
          outputs: outputPaths,
          errors: dedupe.duplicateCandidateOf ? [`duplicate_candidate_of:${dedupe.duplicateCandidateOf}`] : [],
          duplicateCandidateOf: dedupe.duplicateCandidateOf ?? undefined,
          detectedMetadata: {
            matchLevel: match.level,
            matchAlias: match.alias,
            width: fingerprint.width,
            height: fingerprint.height,
            bytes: fingerprint.bytes,
            sha256: fingerprint.sha256,
            ext: fingerprint.ext,
          },
          productDraft: draftPayload,
        });

        if (jpgSame && webpSame) {
          reserveNextSlot(existingSlots, reservations, options.maxImagesPerProduct);
          trace.reservedSlots = Array.from(reservations).sort();
          sourceTrace.mode = "skipped-unchanged";
          report.skippedUnchangedFiles.push(...outputPaths);
          trace.sources.push(sourceTrace);
          continue;
        }

        if (options.dryRun) {
          reserveNextSlot(existingSlots, reservations, options.maxImagesPerProduct);
          trace.reservedSlots = Array.from(reservations).sort();
          sourceTrace.mode = "would-write";
          report.simulatedFiles.push(...outputPaths.filter((_, idx) => (idx === 0 ? !jpgSame : !webpSame)));
          trace.sources.push(sourceTrace);
          continue;
        }

        reserveNextSlot(existingSlots, reservations, options.maxImagesPerProduct);
        trace.reservedSlots = Array.from(reservations).sort();
        await ensureSafeDir(targetDir, normalizedOutputBase);
        if (!jpgSame) {
          await safeWriteFile(jpgOutputPath, rendered.jpg, normalizedOutputBase);
          report.writtenFiles.push(safeRelativeToCwd(jpgOutputPath));
        } else {
          report.skippedUnchangedFiles.push(safeRelativeToCwd(jpgOutputPath));
        }
        if (!webpSame) {
          await safeWriteFile(webpOutputPath, rendered.webp, normalizedOutputBase);
          report.writtenFiles.push(safeRelativeToCwd(webpOutputPath));
        } else {
          report.skippedUnchangedFiles.push(safeRelativeToCwd(webpOutputPath));
        }
        trace.sources.push(sourceTrace);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`Failed to process ${candidate.relativePath}: ${message}`);
        report.reviewItems.push({
          sourceRelativePath: candidate.relativePath,
          reason: message,
          issueType: "malformed",
          proposedProductId: productId,
          confidence: toConfidence(match.level),
          humanActionRequired: true,
        });
      }
    }

    for (const [productId, trace] of Array.from(traceByProduct.entries())) {
      if (!trace.sources.some((source) => source.mode === "written" || source.mode === "would-write" || source.mode === "skipped-unchanged")) continue;
      await writeProductMetadata(path.join(normalizedOutputBase, productId), trace, options.dryRun, report);
    }
  } finally {
    for (const lock of Array.from(locksHeld.values())) {
      await releaseLock(lock.path, lock.fd);
    }
  }

  if (!options.dryRun) {
    try {
      await saveAssetIndex(assetIndex);
    } catch (error) {
      report.errors.push(`Failed to save asset index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const item of report.suspiciousInputs) {
    report.reviewItems.push({
      sourceRelativePath: item,
      reason: "suspicious input ignored",
      issueType: item.includes("symlink") ? "symlink" : "suspicious",
      humanActionRequired: true,
    });
  }

  report.matchedProducts = Array.from(matchedProductSet).sort();
  report.finishedAt = new Date().toISOString();
  report.verdict = toVerdict(report);
  report.summaryPath = safeRelativeToCwd(summaryPath);

  const reviewManifestPath = path.join(reviewDir, runId, "review.json");
  assertSafeWritePath(reviewManifestPath, [reviewDir]);
  await safeWriteFile(reviewManifestPath, JSON.stringify({ runId, items: report.reviewItems }, null, 2), reviewDir);
  report.reviewManifestPath = safeRelativeToCwd(reviewManifestPath);

  await writeReport(normalizedReportPath, report);
  await writeSummary(summaryPath, report);

  let runManifest: RunManifest | undefined;
  runManifest = {
    runId,
    sourceType,
    createdAt: report.startedAt,
    updatedAt: report.finishedAt,
    approvalState: "pending",
    publishState: deriveRunPublishState(report),
    requiresReview: report.reviewItems.length > 0 || report.unmatchedFiles.length > 0,
    inputDir: options.inputDir,
    outputDir: report.outputDir,
    reportPath: safeRelativeToCwd(normalizedReportPath),
    assets: assetManifests,
    errors: report.errors,
  };
  await safeWriteFile(path.join(manifestDir, `${runManifest.runId}.run.json`), JSON.stringify(runManifest, null, 2), manifestDir);

  return { report, runManifest, assetManifests };
}
