import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { products } from "../../client/src/data/products.ts";
import type {
  IngestFileCandidate,
  IngestGroup,
  IngestOptions,
  IngestReport,
  IngestRunResult,
  MatchLevel,
  MatchResult,
  ProductAliasMap,
  ProductDescriptor,
} from "./product-photo-ingest.types.ts";

const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".github"]);
const MAX_WIDTH = 2000;
const JPEG_QUALITY = 86;
const WEBP_QUALITY = 82;

const PRODUCT_DESCRIPTORS: ProductDescriptor[] = products.map((product) => ({
  id: product.id,
  name: product.name,
}));

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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;

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
  skipped: string[];
} {
  const allFiles = walkInput(inputDir);
  const accepted: IngestFileCandidate[] = [];
  const skipped: string[] = [];

  for (const absolutePath of allFiles) {
    const ext = path.extname(absolutePath).toLowerCase();
    if (!INPUT_EXTENSIONS.has(ext)) {
      skipped.push(absolutePath);
      continue;
    }

    const relativePath = path.relative(inputDir, absolutePath);
    accepted.push({
      absolutePath,
      relativePath,
      baseName: path.basename(absolutePath, path.extname(absolutePath)),
      ext,
      groupKey: path.dirname(relativePath),
    });
  }

  return {
    scanned: allFiles.length,
    accepted,
    skipped,
  };
}

export function groupCandidates(candidates: IngestFileCandidate[]): IngestGroup[] {
  const grouped = new Map<string, IngestFileCandidate[]>();

  for (const candidate of candidates) {
    const key = candidate.groupKey === "." ? candidate.baseName : candidate.groupKey;
    const current = grouped.get(key) ?? [];
    current.push(candidate);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, files]) => ({
      key,
      files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    }));
}

function toKey(tokens: string[]): string {
  return tokens.join(" ");
}

function addAlias(aliasMap: ProductAliasMap, productId: string, alias: string) {
  const normalized = normalizeName(alias);
  if (!normalized) return;

  const existing = aliasMap.get(productId) ?? new Set<string>();
  existing.add(normalized);
  aliasMap.set(productId, existing);
}

export function buildProductAliases(list: ProductDescriptor[]): ProductAliasMap {
  const aliases: ProductAliasMap = new Map();

  for (const product of list) {
    const idTokens = tokenize(product.id);
    const nameTokens = tokenize(product.name);

    const tokenSources = [idTokens, nameTokens].filter((tokens) => tokens.length > 0);

    for (const tokens of tokenSources) {
      addAlias(aliases, product.id, toKey(tokens));
      if (tokens[0] === "zle") {
        addAlias(aliases, product.id, toKey(tokens.slice(1)));
      }

      if (tokens.length >= 2) {
        addAlias(aliases, product.id, toKey([...tokens].reverse()));
      }
    }

    const merged = Array.from(new Set([...idTokens, ...nameTokens])).filter(
      (token) => token !== "zle",
    );
    if (merged.length >= 2) {
      addAlias(aliases, product.id, merged.join(" "));
      addAlias(aliases, product.id, [...merged].reverse().join(" "));
    }
  }

  return aliases;
}

function evaluateMatchLevel(context: string, alias: string): MatchLevel | null {
  if (context === alias) return "exact";
  if (context.startsWith(`${alias} `) || context.endsWith(` ${alias}`) || context.startsWith(alias)) {
    return "prefix";
  }
  if (context.includes(alias)) return "contains";
  return null;
}

export function matchProduct(contexts: string[], aliases: ProductAliasMap): MatchResult {
  const scoreRank: Record<MatchLevel, number> = {
    exact: 3,
    prefix: 2,
    contains: 1,
  };

  const bestPerProduct = new Map<string, { level: MatchLevel; alias: string }>();

  for (const context of contexts.map((entry) => normalizeName(entry)).filter(Boolean)) {
    for (const [productId, aliasSet] of Array.from(aliases.entries())) {
      for (const alias of Array.from(aliasSet.values())) {
        const level = evaluateMatchLevel(context, alias);
        if (!level) continue;

        const existing = bestPerProduct.get(productId);
        if (!existing || scoreRank[level] > scoreRank[existing.level]) {
          bestPerProduct.set(productId, { level, alias });
        }
      }
    }
  }

  if (bestPerProduct.size === 0) {
    return null;
  }

  const ranked = Array.from(bestPerProduct.entries()).sort((left, right) => {
    const leftScore = scoreRank[left[1].level];
    const rightScore = scoreRank[right[1].level];
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left[0].localeCompare(right[0]);
  });

  if (ranked.length > 1) {
    const [best, second] = ranked;
    if (scoreRank[best[1].level] === scoreRank[second[1].level]) {
      return null;
    }
  }

  const [productId, choice] = ranked[0];
  return {
    productId,
    level: choice.level,
    alias: choice.alias,
  };
}

export async function ensureDir(targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
}

async function maybeWriteFile(targetPath: string, content: Buffer, dryRun: boolean): Promise<boolean> {
  if (fs.existsSync(targetPath)) {
    const existing = await fs.promises.readFile(targetPath);
    const same =
      createHash("sha256").update(existing).digest("hex") ===
      createHash("sha256").update(content).digest("hex");
    if (same) {
      return false;
    }
  }

  if (!dryRun) {
    await ensureDir(path.dirname(targetPath));
    await fs.promises.writeFile(targetPath, content);
  }

  return true;
}

export async function renderOutputsWithSharp(sourcePath: string): Promise<{ jpg: Buffer; webp: Buffer }> {
  const base = sharp(sourcePath, { failOn: "error" }).rotate().resize({
    width: MAX_WIDTH,
    withoutEnlargement: true,
    fit: "inside",
  });

  const [jpg, webp] = await Promise.all([
    base.clone().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
    base.clone().webp({ quality: WEBP_QUALITY }).toBuffer(),
  ]);

  return { jpg, webp };
}

function formatIndexName(index: number): string {
  return String(index).padStart(2, "0");
}

export async function writeReport(reportPath: string, report: IngestReport): Promise<void> {
  await ensureDir(path.dirname(reportPath));
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

export async function runProductPhotoIngest(options: IngestOptions): Promise<IngestRunResult> {
  const startedAt = new Date().toISOString();
  const report: IngestReport = {
    startedAt,
    finishedAt: startedAt,
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    dryRun: options.dryRun,
    totalFilesScanned: 0,
    imageFilesAccepted: 0,
    matchedProducts: [],
    unmatchedFiles: [],
    skippedFiles: [],
    writtenFiles: [],
    errors: [],
  };

  const normalizedInput = path.resolve(process.cwd(), options.inputDir);
  const normalizedOutput = path.resolve(process.cwd(), options.outputDir);
  const normalizedReport = path.resolve(process.cwd(), options.reportPath);

  if (!fs.existsSync(normalizedInput)) {
    throw new Error(`Input directory does not exist: ${normalizedInput}`);
  }

  const allowedProducts = new Set(PRODUCT_DESCRIPTORS.map((item) => item.id));
  if (options.productOverride && !allowedProducts.has(options.productOverride)) {
    throw new Error(`Unknown product override: ${options.productOverride}`);
  }

  const aliases = buildProductAliases(PRODUCT_DESCRIPTORS);
  const scan = scanInputFiles(normalizedInput);
  report.totalFilesScanned = scan.scanned;
  report.imageFilesAccepted = scan.accepted.length;
  report.skippedFiles = scan.skipped.map((value) => path.relative(process.cwd(), value));

  const groups = groupCandidates(scan.accepted);
  const matchedProducts = new Set<string>();

  for (const group of groups) {
    const contexts = [group.key, ...group.files.map((item) => item.baseName), ...group.files.map((item) => item.relativePath)];
    const match = options.productOverride
      ? ({ productId: options.productOverride, level: "exact", alias: options.productOverride } satisfies NonNullable<MatchResult>)
      : matchProduct(contexts, aliases);

    if (!match) {
      report.unmatchedFiles.push(...group.files.map((item) => item.relativePath));
      continue;
    }

    matchedProducts.add(match.productId);
    const targetDir = path.join(normalizedOutput, match.productId);

    for (const [index, file] of Array.from(group.files.entries())) {
      try {
        const outputs = await renderOutputsWithSharp(file.absolutePath);
        const baseName = index === 0 ? "cover" : formatIndexName(index);
        const jpgPath = path.join(targetDir, `${baseName}.jpg`);
        const webpPath = path.join(targetDir, `${baseName}.webp`);

        const wroteJpg = await maybeWriteFile(jpgPath, outputs.jpg, options.dryRun);
        const wroteWebp = await maybeWriteFile(webpPath, outputs.webp, options.dryRun);

        if (wroteJpg) {
          report.writtenFiles.push(path.relative(process.cwd(), jpgPath));
        }
        if (wroteWebp) {
          report.writtenFiles.push(path.relative(process.cwd(), webpPath));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`Failed to process ${file.relativePath}: ${message}`);
      }
    }
  }

  report.matchedProducts = Array.from(matchedProducts.values()).sort((left, right) =>
    left.localeCompare(right),
  );
  report.finishedAt = new Date().toISOString();

  await writeReport(normalizedReport, report);

  return { report };
}
