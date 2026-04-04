import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

type Category =
  | 'managed_slot_file'
  | 'invalid_name'
  | 'invalid_extension'
  | 'non_product_residue'
  | 'overflow_candidate'
  | 'exact_duplicate_same_product'
  | 'exact_duplicate_cross_product_candidate'
  | 'manual_review_required';

type Action = 'keep' | 'review' | 'candidate_move_to_backup';
type Confidence = 'high' | 'medium' | 'low';
type DuplicateScope = 'none' | 'same_product' | 'cross_product';
type OverflowStatus = 'none' | 'within_limit' | 'overflow';

interface CliOptions {
  mode: 'scan' | 'apply';
}

interface ScanCliOptions extends CliOptions {
  mode: 'scan';
  root: string;
  out: string;
  maxLogicalImages: number;
}

interface ApplyCliOptions extends CliOptions {
  mode: 'apply';
  plan: string;
  backup: string;
  yes: boolean;
  dryRun: boolean;
}

interface FileAuditEntry {
  productId: string;
  relativePath: string;
  filename: string;
  ext: string;
  stem: string;
  sizeBytes: number;
  sha256: string;
  logicalSlot: string | null;
  isManagedSlotFile: boolean;
  isCanonicalKeepCandidate: boolean;
  canonicalReason: string | null;
  canonicalEligibilityReason: string | null;
  reviewReasonHint: string | null;
  hashClusterId: string;
  duplicateScope: DuplicateScope;
  overflowStatus: OverflowStatus;
  categories: Category[];
  notes: string[];
}

interface ProductGroupSummary {
  productId: string;
  logicalSlotOrder: string[];
  overflowSlots: string[];
}

interface HashClusterSummary {
  hashClusterId: string;
  sha256: string;
  fileCount: number;
  productIds: string[];
  duplicateScope: DuplicateScope;
}

interface PlanEntry {
  action: Action;
  reason: string;
  confidence: Confidence;
  relativePath: string;
  productId: string;
  category: Category;
  logicalSlot: string | null;
  canonicalTarget: string | null;
  hashClusterId: string;
  overflowStatus: OverflowStatus;
}

interface ApplyManifestEntry {
  sourcePath: string;
  backupPath: string;
  relativePath: string;
  category: Category;
  action: Action;
  confidence: Confidence;
  status: 'moved' | 'simulated';
  method: 'rename' | 'copy_unlink' | 'dry_run';
}

interface ApplySkippedEntry {
  relativePath: string | null;
  category: string | null;
  action: string | null;
  confidence: string | null;
  reason: string;
}

interface ApplyFailedEntry {
  relativePath: string | null;
  reason: string;
}

interface AuditReport {
  generatedAt: string;
  root: string;
  outDir: string;
  maxLogicalImages: number;
  productFolderCount: number;
  totalFileCount: number;
  files: FileAuditEntry[];
  products: ProductGroupSummary[];
  hashClusters: HashClusterSummary[];
  summary: Record<Category, number>;
  decisionSummary: {
    canonicalKeepCandidatesCount: number;
    duplicateAlternativesCount: number;
    overflowSlotsCount: number;
    crossProductReviewCount: number;
    residueHighConfidenceBackupCandidatesCount: number;
    slotsWithNoEligibleCanonicalCount: number;
    slotsBlockedByCrossProductCount: number;
    canonicalTieCasesCount: number;
  };
}

const MANAGED_SLOTS = new Set(['cover', '01', '02', '03', '04', '05']);
const VALID_EXTENSIONS = new Set(['jpg', 'webp']);
const RESIDUE_FILENAMES = new Set(['.DS_Store', 'Thumbs.db']);
const APPLY_ALLOWED_CATEGORIES = new Set<Category>(['non_product_residue', 'exact_duplicate_same_product']);
const PRODUCT_ASSET_ROOT_RELATIVE = path.join('client', 'public', 'images', 'products');

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): ScanCliOptions | ApplyCliOptions {
  const [mode, ...rest] = argv;
  if (mode === 'scan') {
    return parseScanArgs(rest);
  }
  if (mode === 'apply') {
    return parseApplyArgs(rest);
  }
  fail(`Unsupported mode: ${mode ?? '(missing)'}. Supported modes are 'scan' and 'apply'.`);
}

function parseScanArgs(argv: string[]): ScanCliOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--')) {
      fail(`Unexpected argument '${key}'. Expected --root, --out, --max-logical-images.`);
    }
    if (!value || value.startsWith('--')) {
      fail(`Missing value for argument '${key}'.`);
    }
    args.set(key, value);
    i += 1;
  }

  const root = args.get('--root');
  const out = args.get('--out');
  const maxLogicalImagesRaw = args.get('--max-logical-images');

  if (!root) fail('Missing required argument --root <path>.');
  if (!out) fail('Missing required argument --out <path>.');
  if (!maxLogicalImagesRaw) fail('Missing required argument --max-logical-images <number>.');

  const maxLogicalImages = Number.parseInt(maxLogicalImagesRaw, 10);
  if (!Number.isInteger(maxLogicalImages) || maxLogicalImages <= 0) {
    fail(`Invalid --max-logical-images value '${maxLogicalImagesRaw}'. Must be a positive integer.`);
  }

  return {
    mode: 'scan',
    root,
    out,
    maxLogicalImages,
  };
}

function parseApplyArgs(argv: string[]): ApplyCliOptions {
  const args = new Map<string, string>();
  let yes = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--yes') {
      yes = true;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!token?.startsWith('--')) {
      fail(`Unexpected argument '${token}'. Expected --plan, --backup, --yes, --dry-run.`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for argument '${token}'.`);
    }
    args.set(token, value);
    i += 1;
  }

  const plan = args.get('--plan');
  const backup = args.get('--backup');

  if (!plan) fail('Missing required argument --plan <path>.');
  if (!backup) fail('Missing required argument --backup <path>.');
  if (!yes) {
    fail("Apply mode requires explicit confirmation '--yes'. No files were moved.");
  }

  return {
    mode: 'apply',
    plan,
    backup,
    yes,
    dryRun,
  };
}

function normalizeExt(filename: string): string {
  const ext = path.extname(filename);
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase();
}

function getStem(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

function getLogicalSlotFromFilename(filename: string): string | null {
  const stem = getStem(filename).toLowerCase();
  if (stem === 'cover') return 'cover';
  if (/^\d{2}$/.test(stem)) return stem;
  return null;
}

function isManagedSlotFilename(filename: string): boolean {
  const ext = normalizeExt(filename);
  const slot = getLogicalSlotFromFilename(filename);
  if (!slot || !VALID_EXTENSIONS.has(ext) || !MANAGED_SLOTS.has(slot)) {
    return false;
  }

  return filename.toLowerCase() === `${slot}.${ext}`;
}

function getSlotSortKey(slot: string): number {
  if (slot === 'cover') return 0;
  if (/^\d{2}$/.test(slot)) return Number.parseInt(slot, 10);
  return Number.POSITIVE_INFINITY;
}

function orderSlots(slots: Iterable<string>): string[] {
  return Array.from(slots).sort((a, b) => {
    const diff = getSlotSortKey(a) - getSlotSortKey(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

function getFileNamePriority(entry: FileAuditEntry): number {
  const isCanonicalNamed =
    entry.logicalSlot !== null && entry.filename.toLowerCase() === `${entry.logicalSlot}.${entry.ext}`;
  const canonicalNameRank = isCanonicalNamed ? 0 : 1;
  const extRank = entry.ext === 'jpg' ? 0 : entry.ext === 'webp' ? 1 : 2;
  const pathRank = entry.relativePath.length;

  return canonicalNameRank * 1000 + extRank * 100 + pathRank;
}

function addCategory(entry: FileAuditEntry, category: Category, note?: string): void {
  if (!entry.categories.includes(category)) {
    entry.categories.push(category);
  }
  if (note) {
    entry.notes.push(note);
  }
}

async function computeSha256(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function listProductDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function classifyFileBase(entry: FileAuditEntry): void {
  if (RESIDUE_FILENAMES.has(entry.filename)) {
    addCategory(entry, 'non_product_residue', 'Known residue system file.');
  }

  if (!VALID_EXTENSIONS.has(entry.ext)) {
    addCategory(entry, 'invalid_extension', 'File extension is not one of allowed managed image extensions (jpg, webp).');
  }

  if (entry.isManagedSlotFile) {
    addCategory(entry, 'managed_slot_file');
  }

  if (entry.logicalSlot && /^\d{2}$/.test(entry.logicalSlot) && !MANAGED_SLOTS.has(entry.logicalSlot)) {
    addCategory(entry, 'overflow_candidate', 'Numeric slot filename outside canonical managed slot set.');
  }

  if (!entry.isManagedSlotFile && VALID_EXTENSIONS.has(entry.ext) && !RESIDUE_FILENAMES.has(entry.filename)) {
    addCategory(entry, 'invalid_name', 'Filename does not match expected managed naming pattern.');
  }
}

function summarizeByCategory(files: FileAuditEntry[]): Record<Category, number> {
  const summary: Record<Category, number> = {
    managed_slot_file: 0,
    invalid_name: 0,
    invalid_extension: 0,
    non_product_residue: 0,
    overflow_candidate: 0,
    exact_duplicate_same_product: 0,
    exact_duplicate_cross_product_candidate: 0,
    manual_review_required: 0,
  };

  for (const file of files) {
    for (const category of file.categories) {
      summary[category] += 1;
    }
  }

  return summary;
}

function determineOverflowSlots(slotOrder: string[], maxLogicalImages: number): Set<string> {
  if (slotOrder.length <= maxLogicalImages) {
    return new Set();
  }

  return new Set(slotOrder.slice(maxLogicalImages));
}

function getCanonicalExclusionReason(file: FileAuditEntry): string {
  if (file.logicalSlot === null) return 'Excluded from canonical selection because file has no logical slot.';
  if (!file.isManagedSlotFile) return 'Excluded from canonical selection because file is not a valid managed slot candidate.';
  if (!VALID_EXTENSIONS.has(file.ext)) return 'Excluded from canonical selection because extension is not allowed for managed slots.';
  if (RESIDUE_FILENAMES.has(file.filename)) return 'Excluded from canonical selection because file is known residue.';
  if (file.categories.includes('invalid_name') || file.categories.includes('invalid_extension')) {
    return 'Excluded from canonical selection because file is not a valid managed slot candidate.';
  }
  if (file.duplicateScope === 'cross_product') {
    return 'Cross-product duplicate prevents safe canonical decision under fail-closed policy.';
  }
  return 'Excluded from canonical selection because candidate did not pass strict canonical guard checks.';
}

function isEligibleCanonicalCandidate(file: FileAuditEntry): boolean {
  if (file.logicalSlot === null) return false;
  if (!file.isManagedSlotFile) return false;
  if (!VALID_EXTENSIONS.has(file.ext)) return false;
  if (RESIDUE_FILENAMES.has(file.filename)) return false;
  if (file.categories.includes('invalid_name') || file.categories.includes('invalid_extension')) return false;
  if (file.duplicateScope === 'cross_product') return false;
  return true;
}

function determineCanonicalByProductSlot(files: FileAuditEntry[]): {
  slotsWithNoEligibleCanonicalCount: number;
  slotsBlockedByCrossProductCount: number;
  canonicalTieCasesCount: number;
} {
  let slotsWithNoEligibleCanonicalCount = 0;
  let slotsBlockedByCrossProductCount = 0;
  let canonicalTieCasesCount = 0;
  const byProductAndSlot = new Map<string, FileAuditEntry[]>();

  for (const file of files) {
    if (!file.logicalSlot) continue;
    const key = `${file.productId}::${file.logicalSlot}`;
    const group = byProductAndSlot.get(key) ?? [];
    group.push(file);
    byProductAndSlot.set(key, group);
  }

  for (const group of Array.from(byProductAndSlot.values())) {
    for (const item of group) {
      if (isEligibleCanonicalCandidate(item)) {
        item.canonicalEligibilityReason = 'Eligible canonical candidate after strict validity filtering.';
      } else {
        item.canonicalEligibilityReason = getCanonicalExclusionReason(item);
      }
    }

    const eligibleCandidates = group.filter((item) => isEligibleCanonicalCandidate(item));
    if (eligibleCandidates.length === 0) {
      const hasCrossProduct = group.some((item) => item.duplicateScope === 'cross_product');
      const reason = hasCrossProduct
        ? 'Cross-product duplicate prevents safe canonical decision under fail-closed policy.'
        : 'No eligible canonical candidate for slot after strict validity filtering.';

      for (const item of group) {
        item.reviewReasonHint = reason;
        addCategory(item, 'manual_review_required', reason);
      }

      slotsWithNoEligibleCanonicalCount += 1;
      if (hasCrossProduct) {
        slotsBlockedByCrossProductCount += 1;
      }
      continue;
    }

    const sorted = [...eligibleCandidates].sort((a, b) => {
      const scoreDiff = getFileNamePriority(a) - getFileNamePriority(b);
      if (scoreDiff !== 0) return scoreDiff;
      return a.relativePath.localeCompare(b.relativePath);
    });

    const winner = sorted[0];
    if (!winner) continue;

    const winnerScore = getFileNamePriority(winner);
    const equallyRanked = sorted.filter((item) => getFileNamePriority(item) === winnerScore);

    if (equallyRanked.length > 1) {
      for (const item of equallyRanked) {
        const reason = 'Multiple eligible canonical candidates tie under deterministic priority rules.';
        item.reviewReasonHint = reason;
        addCategory(item, 'manual_review_required', reason);
      }
      canonicalTieCasesCount += 1;
      continue;
    }

    winner.isCanonicalKeepCandidate = true;
    winner.canonicalReason =
      'Canonical by deterministic naming priority: canonical slot name, extension preference (.jpg > .webp), then shortest path.';

    for (const nonWinner of sorted.slice(1)) {
      nonWinner.canonicalReason = `Alternative to canonical file ${winner.relativePath} within slot ${winner.logicalSlot}.`;
    }
  }

  return {
    slotsWithNoEligibleCanonicalCount,
    slotsBlockedByCrossProductCount,
    canonicalTieCasesCount,
  };
}

function buildPlan(files: FileAuditEntry[]): PlanEntry[] {
  const canonicalByProductSlot = new Map<string, FileAuditEntry>();

  for (const file of files) {
    if (file.logicalSlot && file.isCanonicalKeepCandidate) {
      canonicalByProductSlot.set(`${file.productId}::${file.logicalSlot}`, file);
    }
  }

  return files.map((file) => {
    const canonicalTarget =
      file.logicalSlot !== null
        ? (canonicalByProductSlot.get(`${file.productId}::${file.logicalSlot}`)?.relativePath ?? null)
        : null;

    const base = {
      relativePath: file.relativePath,
      productId: file.productId,
      logicalSlot: file.logicalSlot,
      canonicalTarget,
      hashClusterId: file.hashClusterId,
      overflowStatus: file.overflowStatus,
    };

    if (file.categories.includes('non_product_residue')) {
      return {
        ...base,
        action: 'candidate_move_to_backup' as const,
        reason: 'Known residue file that is not expected to be a managed product asset.',
        confidence: 'high' as const,
        category: 'non_product_residue' as const,
      };
    }

    if (file.duplicateScope === 'cross_product') {
      return {
        ...base,
        action: 'review' as const,
        reason: 'Cross-product duplicate prevents safe canonical decision under fail-closed policy.',
        confidence: 'low' as const,
        category: 'exact_duplicate_cross_product_candidate' as const,
      };
    }

    if (
      file.duplicateScope === 'same_product' &&
      file.logicalSlot &&
      canonicalTarget &&
      canonicalTarget !== file.relativePath
    ) {
      return {
        ...base,
        action: 'candidate_move_to_backup' as const,
        reason: `Same-product exact duplicate alternative to canonical slot target ${canonicalTarget}.`,
        confidence: 'high' as const,
        category: 'exact_duplicate_same_product' as const,
      };
    }

    if (file.overflowStatus === 'overflow') {
      return {
        ...base,
        action: 'review' as const,
        reason: 'Logical slot is beyond configured max-logical-images boundary.',
        confidence: 'medium' as const,
        category: 'overflow_candidate' as const,
      };
    }

    if (file.categories.includes('manual_review_required')) {
      return {
        ...base,
        action: 'review' as const,
        reason: file.reviewReasonHint ?? 'Manual review required due to unresolved canonical or ownership ambiguity.',
        confidence: 'low' as const,
        category: 'manual_review_required' as const,
      };
    }

    if (file.categories.includes('invalid_name') || file.categories.includes('invalid_extension')) {
      return {
        ...base,
        action: 'review' as const,
        reason: file.canonicalEligibilityReason ?? 'Excluded from canonical selection because file is not a valid managed slot candidate.',
        confidence: 'medium' as const,
        category: file.categories.includes('invalid_name') ? ('invalid_name' as const) : ('invalid_extension' as const),
      };
    }

    if (file.isCanonicalKeepCandidate) {
      return {
        ...base,
        action: 'keep' as const,
        reason: file.canonicalReason ?? 'Canonical keep candidate by naming priority.',
        confidence: 'high' as const,
        category: 'managed_slot_file' as const,
      };
    }

    return {
      ...base,
      action: 'review' as const,
      reason: 'Fallback fail-closed decision: insufficient certainty for automatic keep/backup candidate.',
      confidence: 'low' as const,
      category: 'manual_review_required' as const,
    };
  });
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function buildSummaryMarkdown(report: AuditReport): string {
  return [
    '# Photo Audit Summary',
    '',
    `Generated at: ${report.generatedAt}`,
    `Audit root: ${report.root}`,
    `Output dir: ${report.outDir}`,
    '',
    `- Product folders: ${report.productFolderCount}`,
    `- Total files: ${report.totalFileCount}`,
    `- Managed slot files: ${report.summary.managed_slot_file}`,
    `- invalid_name: ${report.summary.invalid_name}`,
    `- invalid_extension: ${report.summary.invalid_extension}`,
    `- non_product_residue: ${report.summary.non_product_residue}`,
    `- exact duplicate (same product): ${report.summary.exact_duplicate_same_product}`,
    `- exact duplicate (cross-product candidates): ${report.summary.exact_duplicate_cross_product_candidate}`,
    `- overflow candidates: ${report.summary.overflow_candidate}`,
    `- manual review required: ${report.summary.manual_review_required}`,
    '',
    '## Decision-layer counters',
    `- canonical keep candidates: ${report.decisionSummary.canonicalKeepCandidatesCount}`,
    `- duplicate alternatives: ${report.decisionSummary.duplicateAlternativesCount}`,
    `- overflow slots: ${report.decisionSummary.overflowSlotsCount}`,
    `- cross-product review count: ${report.decisionSummary.crossProductReviewCount}`,
    `- residue high-confidence backup candidates: ${report.decisionSummary.residueHighConfidenceBackupCandidatesCount}`,
    '',
    '## Decision warnings',
    `- slots with no eligible canonical candidate: ${report.decisionSummary.slotsWithNoEligibleCanonicalCount}`,
    `- slots blocked by cross-product duplicates: ${report.decisionSummary.slotsBlockedByCrossProductCount}`,
    `- tie cases in canonical selection: ${report.decisionSummary.canonicalTieCasesCount}`,
  ].join('\n');
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`Unable to create output directory '${dirPath}': ${msg}`);
  }
}

async function buildAuditReport(options: ScanCliOptions): Promise<{ report: AuditReport; plan: PlanEntry[]; outputDir: string }> {
  const rootResolved = path.resolve(options.root);
  const outResolved = path.resolve(options.out);
  const tmpResolved = path.resolve('tmp');

  if (!outResolved.startsWith(tmpResolved + path.sep) && outResolved !== tmpResolved) {
    fail(`Output path '${options.out}' must be inside 'tmp/'.`);
  }

  let rootStat;
  try {
    rootStat = await fs.stat(rootResolved);
  } catch {
    fail(`Audit root does not exist: '${options.root}'.`);
  }
  if (!rootStat.isDirectory()) {
    fail(`Audit root is not a directory: '${options.root}'.`);
  }

  await ensureDirectoryExists(outResolved);

  const timestamp = formatTimestamp(new Date());
  const outputDir = path.join(outResolved, timestamp);
  await fs.mkdir(outputDir, { recursive: false }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`Unable to create timestamped output directory '${outputDir}': ${msg}`);
  });

  const productIds = await listProductDirectories(rootResolved);
  const files: FileAuditEntry[] = [];

  for (const productId of productIds) {
    const productDir = path.join(rootResolved, productId);
    const productFiles = await walkFiles(productDir);

    for (const absolutePath of productFiles) {
      const relativeFromRoot = path.relative(rootResolved, absolutePath).split(path.sep).join('/');
      const filename = path.basename(absolutePath);
      const ext = normalizeExt(filename);
      const stem = getStem(filename);
      const stat = await fs.stat(absolutePath);
      const sha256 = await computeSha256(absolutePath);
      const logicalSlot = getLogicalSlotFromFilename(filename);

      const entry: FileAuditEntry = {
        productId,
        relativePath: relativeFromRoot,
        filename,
        ext,
        stem,
        sizeBytes: stat.size,
        sha256,
        logicalSlot,
        isManagedSlotFile: isManagedSlotFilename(filename),
        isCanonicalKeepCandidate: false,
        canonicalReason: null,
        canonicalEligibilityReason: null,
        reviewReasonHint: null,
        hashClusterId: `hash:${sha256.slice(0, 12)}`,
        duplicateScope: 'none',
        overflowStatus: logicalSlot ? 'within_limit' : 'none',
        categories: [],
        notes: [],
      };

      classifyFileBase(entry);
      files.push(entry);
    }
  }

  const byProductAndHash = new Map<string, FileAuditEntry[]>();
  const byHash = new Map<string, FileAuditEntry[]>();
  const productSlots = new Map<string, Set<string>>();

  for (const file of files) {
    const productHashKey = `${file.productId}::${file.sha256}`;
    const productHashGroup = byProductAndHash.get(productHashKey) ?? [];
    productHashGroup.push(file);
    byProductAndHash.set(productHashKey, productHashGroup);

    const hashGroup = byHash.get(file.sha256) ?? [];
    hashGroup.push(file);
    byHash.set(file.sha256, hashGroup);

    if (file.logicalSlot) {
      const slots = productSlots.get(file.productId) ?? new Set<string>();
      slots.add(file.logicalSlot);
      productSlots.set(file.productId, slots);
    }
  }

  for (const group of Array.from(byProductAndHash.values())) {
    if (group.length > 1) {
      for (const file of group) {
        file.duplicateScope = 'same_product';
        addCategory(file, 'exact_duplicate_same_product', 'Exact hash duplicate detected inside the same product folder.');
      }
    }
  }

  for (const group of Array.from(byHash.values())) {
    const distinctProducts = new Set(group.map((file) => file.productId));
    if (distinctProducts.size > 1) {
      for (const file of group) {
        file.duplicateScope = 'cross_product';
        addCategory(file, 'exact_duplicate_cross_product_candidate', 'Exact hash duplicate spans multiple products; requires manual review.');
        addCategory(file, 'manual_review_required', 'Cross-product duplicate ownership cannot be inferred safely.');
      }
    }
  }

  const products: ProductGroupSummary[] = [];
  for (const productId of productIds) {
    const slotSet = productSlots.get(productId) ?? new Set<string>();
    const slotOrder = orderSlots(slotSet);
    const overflowSlots = Array.from(determineOverflowSlots(slotOrder, options.maxLogicalImages));

    products.push({
      productId,
      logicalSlotOrder: slotOrder,
      overflowSlots,
    });

    const overflowSet = new Set(overflowSlots);
    for (const file of files) {
      if (file.productId !== productId || !file.logicalSlot) continue;
      if (overflowSet.has(file.logicalSlot)) {
        file.overflowStatus = 'overflow';
        addCategory(file, 'overflow_candidate', `Logical slot '${file.logicalSlot}' is beyond --max-logical-images=${options.maxLogicalImages}.`);
      } else {
        file.overflowStatus = 'within_limit';
      }
    }
  }

  const canonicalGuardSummary = determineCanonicalByProductSlot(files);

  for (const file of files) {
    if (!file.isCanonicalKeepCandidate && file.logicalSlot && file.canonicalReason === null) {
      const reason =
        file.reviewReasonHint ??
        file.canonicalEligibilityReason ??
        'No eligible canonical candidate for slot after strict validity filtering.';
      file.reviewReasonHint = reason;
      addCategory(file, 'manual_review_required', reason);
    }

    if (file.categories.length === 0) {
      addCategory(file, 'manual_review_required', 'No deterministic classification applied; fallback to manual review.');
    }
  }

  const hashClusters: HashClusterSummary[] = Array.from(byHash.entries()).map(([sha256, group]) => {
    const productSet = new Set(group.map((file) => file.productId));
    const duplicateScope: DuplicateScope = productSet.size > 1 ? 'cross_product' : group.length > 1 ? 'same_product' : 'none';

    return {
      hashClusterId: `hash:${sha256.slice(0, 12)}`,
      sha256,
      fileCount: group.length,
      productIds: Array.from(productSet).sort(),
      duplicateScope,
    };
  });

  const summary = summarizeByCategory(files);
  const decisionSummary = {
    canonicalKeepCandidatesCount: files.filter((file) => file.isCanonicalKeepCandidate).length,
    duplicateAlternativesCount: files.filter((file) => file.duplicateScope === 'same_product' && !file.isCanonicalKeepCandidate).length,
    overflowSlotsCount: products.reduce((acc, product) => acc + product.overflowSlots.length, 0),
    crossProductReviewCount: files.filter((file) => file.duplicateScope === 'cross_product').length,
    residueHighConfidenceBackupCandidatesCount: files.filter((file) => file.categories.includes('non_product_residue')).length,
    slotsWithNoEligibleCanonicalCount: canonicalGuardSummary.slotsWithNoEligibleCanonicalCount,
    slotsBlockedByCrossProductCount: canonicalGuardSummary.slotsBlockedByCrossProductCount,
    canonicalTieCasesCount: canonicalGuardSummary.canonicalTieCasesCount,
  };

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    root: options.root,
    outDir: outputDir,
    maxLogicalImages: options.maxLogicalImages,
    productFolderCount: productIds.length,
    totalFileCount: files.length,
    files,
    products,
    hashClusters,
    summary,
    decisionSummary,
  };

  const plan = buildPlan(files);
  return { report, plan, outputDir };
}

async function writeOutputs(outputDir: string, report: AuditReport, plan: PlanEntry[]): Promise<void> {
  const reportPath = path.join(outputDir, 'report.json');
  const summaryPath = path.join(outputDir, 'summary.md');
  const planPath = path.join(outputDir, 'plan.json');

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(summaryPath, `${buildSummaryMarkdown(report)}\n`, 'utf8');
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSubPath(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseCategory(value: unknown): Category | null {
  if (typeof value !== 'string') return null;
  const allowed: Category[] = [
    'managed_slot_file',
    'invalid_name',
    'invalid_extension',
    'non_product_residue',
    'overflow_candidate',
    'exact_duplicate_same_product',
    'exact_duplicate_cross_product_candidate',
    'manual_review_required',
  ];
  return allowed.includes(value as Category) ? (value as Category) : null;
}

function parseAction(value: unknown): Action | null {
  if (value === 'keep' || value === 'review' || value === 'candidate_move_to_backup') {
    return value;
  }
  return null;
}

function parseConfidence(value: unknown): Confidence | null {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return null;
}

function isApplyEligiblePlanEntry(entry: PlanEntry): boolean {
  return (
    entry.action === 'candidate_move_to_backup' &&
    entry.confidence === 'high' &&
    APPLY_ALLOWED_CATEGORIES.has(entry.category)
  );
}

async function validateApplyPlanEntry(
  entry: PlanEntry,
  sourceBasePath: string,
  backupBasePath: string,
): Promise<{ sourcePath: string; backupPath: string }> {
  if (!entry.relativePath || typeof entry.relativePath !== 'string') {
    fail('Plan entry is missing required string field relativePath.');
  }

  const sourcePath = path.resolve(sourceBasePath, entry.relativePath);
  if (!isSubPath(sourceBasePath, sourcePath)) {
    fail(`Plan entry '${entry.relativePath}' resolves outside '${PRODUCT_ASSET_ROOT_RELATIVE}'.`);
  }

  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStat || !sourceStat.isFile()) {
    fail(`Source file does not exist or is not a file: '${sourcePath}'.`);
  }

  const relativeFromRepo = path.join(PRODUCT_ASSET_ROOT_RELATIVE, entry.relativePath);
  const backupPath = path.resolve(backupBasePath, relativeFromRepo);
  const backupExists = await fs.stat(backupPath).then(() => true).catch(() => false);
  if (backupExists) {
    fail(`Backup target already exists. Refusing to overwrite: '${backupPath}'.`);
  }

  return { sourcePath, backupPath };
}

async function moveToBackup(sourcePath: string, backupPath: string): Promise<'rename' | 'copy_unlink'> {
  await fs.mkdir(path.dirname(backupPath), { recursive: true });

  try {
    await fs.rename(sourcePath, backupPath);
    return 'rename';
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'EXDEV') {
      throw error;
    }

    await fs.copyFile(sourcePath, backupPath);
    await fs.unlink(sourcePath);
    return 'copy_unlink';
  }
}

async function writeApplyOutputs(
  outputDir: string,
  totalPlanEntries: number,
  eligibleEntries: number,
  moved: ApplyManifestEntry[],
  skipped: ApplySkippedEntry[],
  failed: ApplyFailedEntry[],
  blockedEntries: number,
  dryRunSimulatedMoves: number,
): Promise<void> {
  const appliedPath = path.join(outputDir, 'applied.json');
  const skippedPath = path.join(outputDir, 'skipped.json');
  const failedPath = path.join(outputDir, 'failed.json');
  const summaryPath = path.join(outputDir, 'summary.md');
  const summary = [
    '# Photo Apply Summary',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `- Total plan entries: ${totalPlanEntries}`,
    `- Eligible apply entries: ${eligibleEntries}`,
    `- Moved entries: ${moved.length}`,
    `- Skipped entries: ${skipped.length}`,
    `- Blocked entries: ${blockedEntries}`,
    `- Failed entries: ${failed.length}`,
    `- Dry-run simulated moves: ${dryRunSimulatedMoves}`,
    '',
    `Allowed categories: ${Array.from(APPLY_ALLOWED_CATEGORIES).join(', ')}`,
  ].join('\n');

  await fs.writeFile(appliedPath, JSON.stringify(moved, null, 2), 'utf8');
  await fs.writeFile(skippedPath, JSON.stringify(skipped, null, 2), 'utf8');
  await fs.writeFile(failedPath, JSON.stringify(failed, null, 2), 'utf8');
  await fs.writeFile(summaryPath, `${summary}\n`, 'utf8');
}

async function runApply(options: ApplyCliOptions): Promise<void> {
  const planPath = path.resolve(options.plan);
  const planExists = await fs.stat(planPath).then((stat) => stat.isFile()).catch(() => false);
  if (!planExists) {
    fail(`Plan file does not exist: '${options.plan}'.`);
  }

  const rawPlan = await fs.readFile(planPath, 'utf8');
  let parsedPlan: unknown;
  try {
    parsedPlan = JSON.parse(rawPlan);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`Invalid JSON in plan '${options.plan}': ${msg}`);
  }
  if (!Array.isArray(parsedPlan)) {
    fail(`Plan '${options.plan}' must be a JSON array.`);
  }

  const eligiblePlanEntries: PlanEntry[] = [];
  const skipped: ApplySkippedEntry[] = [];
  const failed: ApplyFailedEntry[] = [];
  let blockedEntries = 0;
  for (const item of parsedPlan) {
    if (!isObjectRecord(item)) {
      skipped.push({
        relativePath: null,
        category: null,
        action: null,
        confidence: null,
        reason: 'Invalid plan entry object; ignored for apply.',
      });
      continue;
    }

    const action = parseAction(item.action);
    const confidence = parseConfidence(item.confidence);
    const category = parseCategory(item.category);
    const relativePath = typeof item.relativePath === 'string' ? item.relativePath : null;
    const reason = typeof item.reason === 'string' ? item.reason : '';
    const productId = typeof item.productId === 'string' ? item.productId : '';
    const logicalSlot = typeof item.logicalSlot === 'string' ? item.logicalSlot : null;
    const canonicalTarget = typeof item.canonicalTarget === 'string' ? item.canonicalTarget : null;
    const hashClusterId = typeof item.hashClusterId === 'string' ? item.hashClusterId : '';
    const overflowStatus: OverflowStatus =
      item.overflowStatus === 'none' || item.overflowStatus === 'within_limit' || item.overflowStatus === 'overflow'
        ? item.overflowStatus
        : 'none';

    if (!action) {
      skipped.push({
        relativePath,
        category: typeof item.category === 'string' ? item.category : null,
        action: null,
        confidence,
        reason: 'Missing or invalid action; ignored for apply.',
      });
      continue;
    }

    if (action !== 'candidate_move_to_backup') {
      skipped.push({ relativePath, category, action, confidence, reason: 'Entry action is not candidate_move_to_backup; ignored for apply.' });
      continue;
    }

    if (confidence !== 'high') {
      skipped.push({
        relativePath,
        category,
        action,
        confidence,
        reason: `Blocked for apply: confidence is '${confidence ?? 'missing'}', expected 'high'.`,
      });
      continue;
    }

    if (!category) {
      skipped.push({
        relativePath,
        category: null,
        action,
        confidence,
        reason: 'Blocked for apply: missing or invalid category.',
      });
      blockedEntries += 1;
      continue;
    }

    if (!APPLY_ALLOWED_CATEGORIES.has(category)) {
      skipped.push({
        relativePath,
        category,
        action,
        confidence,
        reason: 'Blocked for apply: category is not allowlisted.',
      });
      blockedEntries += 1;
      continue;
    }

    if (!relativePath) {
      fail('Plan entry missing required string field relativePath for eligible apply candidate.');
    }

    const entry: PlanEntry = {
      action,
      reason,
      confidence,
      relativePath,
      productId,
      category,
      logicalSlot,
      canonicalTarget,
      hashClusterId,
      overflowStatus,
    };

    eligiblePlanEntries.push(entry);
  }

  const sourceBasePath = path.resolve(PRODUCT_ASSET_ROOT_RELATIVE);
  const sourceBaseExists = await fs.stat(sourceBasePath).then((stat) => stat.isDirectory()).catch(() => false);
  if (!sourceBaseExists) {
    fail(`Expected product asset root does not exist: '${PRODUCT_ASSET_ROOT_RELATIVE}'.`);
  }

  const backupBasePath = path.resolve(options.backup);
  await ensureDirectoryExists(backupBasePath);

  const timestamp = formatTimestamp(new Date());
  const applyOutRoot = path.resolve('tmp', 'photo-apply');
  await ensureDirectoryExists(applyOutRoot);
  const applyOutputDir = path.join(applyOutRoot, timestamp);
  await fs.mkdir(applyOutputDir, { recursive: false });

  const prevalidated = await Promise.all(
    eligiblePlanEntries.map(async (entry) => ({
      entry,
      ...(await validateApplyPlanEntry(entry, sourceBasePath, backupBasePath)),
    })),
  );

  const moved: ApplyManifestEntry[] = [];
  const dryRunSimulatedMoves = options.dryRun ? prevalidated.length : 0;

  if (options.dryRun) {
    for (const candidate of prevalidated) {
      moved.push({
        sourcePath: candidate.sourcePath,
        backupPath: candidate.backupPath,
        relativePath: candidate.entry.relativePath,
        category: candidate.entry.category,
        action: candidate.entry.action,
        confidence: candidate.entry.confidence,
        status: 'simulated',
        method: 'dry_run',
      });
    }

    await writeApplyOutputs(
      applyOutputDir,
      parsedPlan.length,
      eligiblePlanEntries.length,
      moved,
      skipped,
      failed,
      blockedEntries,
      dryRunSimulatedMoves,
    );
    process.stdout.write(`Apply dry-run complete. Outputs written to: ${applyOutputDir}\n`);
    return;
  }

  for (const candidate of prevalidated) {
    try {
      const method = await moveToBackup(candidate.sourcePath, candidate.backupPath);
      moved.push({
        sourcePath: candidate.sourcePath,
        backupPath: candidate.backupPath,
        relativePath: candidate.entry.relativePath,
        category: candidate.entry.category,
        action: candidate.entry.action,
        confidence: candidate.entry.confidence,
        status: 'moved',
        method,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failed.push({
        relativePath: candidate.entry.relativePath,
        reason: msg,
      });
      await writeApplyOutputs(
        applyOutputDir,
        parsedPlan.length,
        eligiblePlanEntries.length,
        moved,
        skipped,
        failed,
        blockedEntries,
        0,
      );
      fail(`Apply failed while moving '${candidate.entry.relativePath}': ${msg}`);
    }
  }

  await writeApplyOutputs(
    applyOutputDir,
    parsedPlan.length,
    eligiblePlanEntries.length,
    moved,
    skipped,
    failed,
    blockedEntries,
    0,
  );
  process.stdout.write(`Apply complete. Outputs written to: ${applyOutputDir}\n`);
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === 'scan') {
      const { report, plan, outputDir } = await buildAuditReport(options);
      await writeOutputs(outputDir, report, plan);
      process.stdout.write(`Audit complete. Outputs written to: ${outputDir}\n`);
      return;
    }

    await runApply(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`photos-audit failed: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
