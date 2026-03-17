import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { products } from "../../client/src/data/products.ts";
import type {
  IngestFileCandidate,
  IngestOptions,
  IngestProductTrace,
  IngestReport,
  IngestRunResult,
  LockConflict,
  MatchLevel,
  MatchResult,
  ProductAliasMap,
  ProductDescriptor,
  SourceItemTrace,
} from "./product-photo-ingest.types.ts";

const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SLOT_SCAN_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SKIP_DIR_NAMES = new Set([".git", ".github", "node_modules"]);
const MAX_WIDTH = 2000;
const JPEG_QUALITY = 86;
const WEBP_QUALITY = 82;

const PRODUCT_DESCRIPTORS: ProductDescriptor[] = products.map((product) => ({
  id: product.id,
  name: product.name,
}));

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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
  return normalizeName(value)
    .split(" ")
    .filter(Boolean);
}

function walkInput(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkInput(fullPath));
      continue;
    }

    out.push(fullPath);
  }

  return out;
}

export function scanInputFiles(inputDir: string): {
  scanned: number;
  accepted: IngestFileCandidate[];
  ignored: string[];
} {
  const allFiles = walkInput(inputDir).sort((left, right) => left.localeCompare(right));
  const accepted: IngestFileCandidate[] = [];
  const ignored: string[] = [];

  for (const absolutePath of allFiles) {
    const ext = path.extname(absolutePath).toLowerCase();
    const relativePath = toPortablePath(path.relative(inputDir, absolutePath));

    if (!INPUT_EXTENSIONS.has(ext)) {
      ignored.push(relativePath);
      continue;
    }

    accepted.push({
      absolutePath,
      relativePath,
      baseName: path.basename(absolutePath, path.extname(absolutePath)),
      ext,
      parentDir: toPortablePath(path.dirname(relativePath)),
    });
  }

  accepted.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    scanned: allFiles.length,
    accepted,
    ignored,
  };
}

function addAlias(aliasMap: ProductAliasMap, productId: string, alias: string): void {
  const normalized = normalizeName(alias);
  if (!normalized) {
    return;
  }

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
      if (idTokens[0] === "zle") {
        addAlias(aliases, product.id, idTokens.slice(1).join(" "));
      }
      if (idTokens.length >= 2) {
        addAlias(aliases, product.id, [...idTokens].reverse().join(" "));
      }
    }

    if (nameTokens.length > 0) {
      addAlias(aliases, product.id, nameTokens.join(" "));
      if (nameTokens[0] === "zle") {
        addAlias(aliases, product.id, nameTokens.slice(1).join(" "));
      }
      if (nameTokens.length >= 2) {
        addAlias(aliases, product.id, [...nameTokens].reverse().join(" "));
      }
    }
  }

  return aliases;
}

function evaluateMatchLevel(context: string, alias: string): MatchLevel | null {
  if (context === alias) {
    return "exact";
  }

  if (context.startsWith(`${alias} `) || context.endsWith(` ${alias}`) || context.startsWith(alias)) {
    return "prefix";
  }

  if (context.includes(alias)) {
    return "contains";
  }

  return null;
}

export function matchProduct(candidate: IngestFileCandidate, aliases: ProductAliasMap): MatchResult {
  const contexts = [candidate.baseName, candidate.parentDir, candidate.relativePath]
    .map((value) => normalizeName(value))
    .filter(Boolean);

  const rank: Record<MatchLevel, number> = {
    exact: 3,
    prefix: 2,
    contains: 1,
  };

  const hits = new Map<string, { level: MatchLevel; alias: string }>();

  for (const context of contexts) {
    for (const [productId, aliasSet] of Array.from(aliases.entries())) {
      for (const alias of Array.from(aliasSet.values())) {
        const level = evaluateMatchLevel(context, alias);
        if (!level) {
          continue;
        }

        const current = hits.get(productId);
        if (!current || rank[level] > rank[current.level]) {
          hits.set(productId, { level, alias });
        }
      }
    }
  }

  if (hits.size === 0) {
    return null;
  }

  const ranked = Array.from(hits.entries()).sort((left, right) => {
    const scoreDiff = rank[right[1].level] - rank[left[1].level];
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left[0].localeCompare(right[0]);
  });

  if (ranked.length > 1) {
    const first = ranked[0];
    const second = ranked[1];
    if (rank[first[1].level] === rank[second[1].level]) {
      return null;
    }
  }

  return {
    productId: ranked[0][0],
    level: ranked[0][1].level,
    alias: ranked[0][1].alias,
  };
}

export async function ensureDir(targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
}

function isSlotName(baseName: string): boolean {
  return baseName === "cover" || /^\d{2}$/.test(baseName);
}

export function readExistingProductSlots(targetDir: string): Set<string> {
  if (!fs.existsSync(targetDir)) {
    return new Set<string>();
  }

  const slots = new Set<string>();
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!SLOT_SCAN_EXTENSIONS.has(ext)) {
      continue;
    }

    const baseName = path.basename(entry.name, path.extname(entry.name));
    if (isSlotName(baseName)) {
      slots.add(baseName);
    }
  }

  return slots;
}

export function reserveNextSlot(existingSlots: Set<string>, inMemoryReservations: Set<string>, maxSlots: number): string | null {
  const used = new Set<string>([...Array.from(existingSlots.values()), ...Array.from(inMemoryReservations.values())]);

  if (used.size >= maxSlots) {
    return null;
  }

  if (!used.has("cover")) {
    inMemoryReservations.add("cover");
    return "cover";
  }

  for (let index = 1; index < maxSlots; index++) {
    const slot = String(index).padStart(2, "0");
    if (!used.has(slot)) {
      inMemoryReservations.add(slot);
      return slot;
    }
  }

  return null;
}

async function renderOutputsWithSharp(sourcePath: string): Promise<{ jpg: Buffer; webp: Buffer }> {
  const base = sharp(sourcePath, { failOn: "error" }).rotate().resize({
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

async function compareExisting(targetPath: string, content: Buffer): Promise<boolean> {
  if (!fs.existsSync(targetPath)) {
    return false;
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
    existingSlotsAtStart: Array.from(existingSlotsAtStart.values()).sort((a, b) => a.localeCompare(b)),
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
  if (fd !== null) {
    fs.closeSync(fd);
  }

  if (fs.existsSync(lockPath)) {
    await fs.promises.unlink(lockPath);
  }
}

async function writeReport(reportPath: string, report: IngestReport): Promise<void> {
  await ensureDir(path.dirname(reportPath));
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

async function writeProductMetadata(
  targetDir: string,
  trace: IngestProductTrace,
  dryRun: boolean,
  report: IngestReport,
): Promise<void> {
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

  await ensureDir(targetDir);
  await fs.promises.writeFile(metaPath, body, "utf8");
  report.writtenFiles.push(safeRelativeToCwd(metaPath));
}

export async function runProductPhotoIngest(options: IngestOptions): Promise<IngestRunResult> {
  const now = new Date().toISOString();
  const report: IngestReport = {
    startedAt: now,
    finishedAt: now,
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    dryRun: options.dryRun,
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
    errors: [],
    products: [],
  };

  const normalizedInput = path.resolve(process.cwd(), options.inputDir);
  const normalizedOutput = path.resolve(process.cwd(), options.outputDir);
  const normalizedReportPath = path.resolve(process.cwd(), options.reportPath);
  const normalizedLockDir = path.resolve(process.cwd(), options.lockDir);

  if (!fs.existsSync(normalizedInput)) {
    throw new Error(`Input directory does not exist: ${normalizedInput}`);
  }

  if (options.maxImagesPerProduct < 1) {
    throw new Error("--max-images-per-product must be >= 1");
  }

  const knownProducts = new Set(PRODUCT_DESCRIPTORS.map((item) => item.id));
  if (options.productOverride && !knownProducts.has(options.productOverride)) {
    throw new Error(`Unknown product override: ${options.productOverride}`);
  }

  await ensureDir(normalizedLockDir);

  const aliasMap = buildProductAliases(PRODUCT_DESCRIPTORS);
  const scan = scanInputFiles(normalizedInput);
  report.totalFilesScanned = scan.scanned;
  report.imageFilesAccepted = scan.accepted.length;
  report.ignoredFiles = scan.ignored;

  const reservationByProduct = new Map<string, Set<string>>();
  const existingSlotsByProduct = new Map<string, Set<string>>();
  const traceByProduct = new Map<string, IngestProductTrace>();
  const locksHeld = new Map<string, { fd: number; path: string }>();
  const matchedProductSet = new Set<string>();
  const lockBlockedProducts = new Set<string>();

  try {
    for (const candidate of scan.accepted) {
      const match = options.productOverride
        ? ({ productId: options.productOverride, level: "exact", alias: options.productOverride } satisfies NonNullable<MatchResult>)
        : matchProduct(candidate, aliasMap);

      if (!match) {
        report.unmatchedFiles.push(candidate.relativePath);
        continue;
      }

      const productId = match.productId;
      matchedProductSet.add(productId);
      report.matchedFiles.push(candidate.relativePath);
      const targetDir = path.join(normalizedOutput, productId);

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
          lockBlockedProducts.add(productId);
          report.skippedFiles.push(candidate.relativePath);
          continue;
        }

        locksHeld.set(productId, { fd: lockFd, path: lockPath });
        const existingSlots = readExistingProductSlots(targetDir);
        existingSlotsByProduct.set(productId, existingSlots);
        reservationByProduct.set(productId, new Set<string>());

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

      const slot = reserveNextSlot(existingSlots, reservations, options.maxImagesPerProduct);
      if (!slot) {
        const limitTrace: SourceItemTrace = {
          sourceRelativePath: candidate.relativePath,
          productId,
          slot: "",
          outputs: [],
          outputHashes: {
            jpgSha256: "",
            webpSha256: "",
          },
          mode: "limit-reached",
          reason: `max images per product (${options.maxImagesPerProduct}) reached`,
        };
        trace.sources.push(limitTrace);
        report.skippedFiles.push(candidate.relativePath);
        continue;
      }

      trace.reservedSlots = Array.from(reservations.values()).sort((a, b) => a.localeCompare(b));

      const jpgOutputPath = path.join(targetDir, `${slot}.jpg`);
      const webpOutputPath = path.join(targetDir, `${slot}.webp`);

      try {
        const rendered = await renderOutputsWithSharp(candidate.absolutePath);
        const jpgSame = await compareExisting(jpgOutputPath, rendered.jpg);
        const webpSame = await compareExisting(webpOutputPath, rendered.webp);

        const outputPaths = [safeRelativeToCwd(jpgOutputPath), safeRelativeToCwd(webpOutputPath)];
        const sourceTrace: SourceItemTrace = {
          sourceRelativePath: candidate.relativePath,
          productId,
          slot,
          outputs: outputPaths,
          outputHashes: {
            jpgSha256: sha256(rendered.jpg),
            webpSha256: sha256(rendered.webp),
          },
          mode: "written",
        };

        if (jpgSame && webpSame) {
          sourceTrace.mode = "skipped-unchanged";
          report.skippedUnchangedFiles.push(...outputPaths);
          trace.sources.push(sourceTrace);
          continue;
        }

        if (options.dryRun) {
          sourceTrace.mode = "would-write";
          report.simulatedFiles.push(...outputPaths.filter((item, idx) => (idx === 0 ? !jpgSame : !webpSame)));
          trace.sources.push(sourceTrace);
          continue;
        }

        await ensureDir(targetDir);

        if (!jpgSame) {
          await fs.promises.writeFile(jpgOutputPath, rendered.jpg);
          report.writtenFiles.push(safeRelativeToCwd(jpgOutputPath));
        } else {
          report.skippedUnchangedFiles.push(safeRelativeToCwd(jpgOutputPath));
        }

        if (!webpSame) {
          await fs.promises.writeFile(webpOutputPath, rendered.webp);
          report.writtenFiles.push(safeRelativeToCwd(webpOutputPath));
        } else {
          report.skippedUnchangedFiles.push(safeRelativeToCwd(webpOutputPath));
        }

        trace.sources.push(sourceTrace);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`Failed to process ${candidate.relativePath}: ${message}`);
        trace.sources.push({
          sourceRelativePath: candidate.relativePath,
          productId,
          slot,
          outputs: [safeRelativeToCwd(jpgOutputPath), safeRelativeToCwd(webpOutputPath)],
          outputHashes: {
            jpgSha256: "",
            webpSha256: "",
          },
          mode: "error",
          reason: message,
        });
      }
    }

    for (const [productId, trace] of Array.from(traceByProduct.entries())) {
      const hasWritesOrSimulation = trace.sources.some((source) =>
        source.mode === "written" || source.mode === "would-write" || source.mode === "skipped-unchanged",
      );

      if (!hasWritesOrSimulation) {
        continue;
      }

      const targetDir = path.join(normalizedOutput, productId);
      await writeProductMetadata(targetDir, trace, options.dryRun, report);
    }
  } finally {
    for (const lock of Array.from(locksHeld.values())) {
      await releaseLock(lock.path, lock.fd);
    }
  }

  report.matchedProducts = Array.from(matchedProductSet.values()).sort((a, b) => a.localeCompare(b));

  report.finishedAt = new Date().toISOString();
  await writeReport(normalizedReportPath, report);

  return { report };
}
