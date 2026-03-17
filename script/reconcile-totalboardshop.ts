import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CATALOG_INDEX_PATH, loadLocalCatalog, readCatalogIndex, upsertCatalogEntries, writeCatalogIndex } from "./lib/catalog-index.ts";
import { reconcileSourceProducts } from "./lib/reconciliation-agent.ts";
import type { ReconciliationFilters, ReconciliationLimits, ReconciliationMode } from "./lib/reconciliation-types.ts";
import type { SourceDatasetManifest, SourceProductRecord } from "./lib/source-dataset.ts";

type CliArgs = {
  runId: string;
  mode: ReconciliationMode;
  category?: string;
  limit?: number;
  indexPath: string;
  outputDir: string;
  limits: ReconciliationLimits;
};

function parseIntFlag(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires value`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const defaults: CliArgs = {
    runId: "",
    mode: "incremental-sync",
    indexPath: DEFAULT_CATALOG_INDEX_PATH,
    outputDir: path.join("tmp", "reconciliation"),
    limits: {
      maxCandidatesPerRun: 200,
      maxNewPerRun: 100,
      maxChangedPerRun: 100,
      maxReviewPerRun: 50,
      maxUnchangedToInspectPerRun: 20,
    },
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        defaults.runId = next ?? "";
        i++;
        break;
      case "--mode":
        if (next === "bootstrap-replacement" || next === "incremental-sync") {
          defaults.mode = next;
        } else {
          throw new Error("--mode must be bootstrap-replacement|incremental-sync");
        }
        i++;
        break;
      case "--category":
        defaults.category = next;
        i++;
        break;
      case "--limit":
        defaults.limit = parseIntFlag(next, "--limit");
        i++;
        break;
      case "--index-path":
        defaults.indexPath = next ?? defaults.indexPath;
        i++;
        break;
      case "--output-dir":
        defaults.outputDir = next ?? defaults.outputDir;
        i++;
        break;
      case "--max-candidates-per-run":
        defaults.limits.maxCandidatesPerRun = parseIntFlag(next, token);
        i++;
        break;
      case "--max-new-per-run":
        defaults.limits.maxNewPerRun = parseIntFlag(next, token);
        i++;
        break;
      case "--max-changed-per-run":
        defaults.limits.maxChangedPerRun = parseIntFlag(next, token);
        i++;
        break;
      case "--max-review-per-run":
        defaults.limits.maxReviewPerRun = parseIntFlag(next, token);
        i++;
        break;
      case "--max-unchanged-to-inspect-per-run":
        defaults.limits.maxUnchangedToInspectPerRun = parseIntFlag(next, token);
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!defaults.runId) throw new Error("Missing --run-id");
  return defaults;
}

function readJson<T>(targetPath: string): T {
  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = path.join("tmp", "source-datasets", args.runId, "dataset.json");
  const productsPath = path.join("tmp", "source-datasets", args.runId, "products.json");
  const decisionPath = path.join("tmp", "agent-decisions", `${args.runId}.decision.json`);

  if (!fs.existsSync(datasetPath) || !fs.existsSync(productsPath)) {
    throw new Error("Missing KROK 1 source dataset artifacts for given runId");
  }

  const dataset = readJson<SourceDatasetManifest>(datasetPath);
  const products = readJson<SourceProductRecord[]>(productsPath);
  if (dataset.runId !== args.runId) throw new Error("runId mismatch in dataset artifact");
  if (!Array.isArray(products)) throw new Error("Invalid products.json content");

  const lastDecision = fs.existsSync(decisionPath)
    ? (readJson<{ decision: "AUTO_APPROVE" | "REVIEW" | "REJECT" }>(decisionPath).decision ?? null)
    : null;

  const filters: ReconciliationFilters = {
    category: args.category,
    limit: args.limit,
  };

  const index = await readCatalogIndex(args.indexPath);
  const localCatalog = loadLocalCatalog();

  const { report, updatedEntries } = reconcileSourceProducts({
    runId: args.runId,
    mode: args.mode,
    sourceProducts: products,
    localCatalog,
    index,
    limits: args.limits,
    filters,
    lastDecision,
  });

  const updatedIndex = upsertCatalogEntries(index, updatedEntries);

  await fs.promises.mkdir(args.outputDir, { recursive: true });
  const outPath = path.join(args.outputDir, `${args.runId}.reconciliation.json`);
  await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  await writeCatalogIndex(updatedIndex, args.indexPath);

  console.log(`run ${args.runId}`);
  console.log(`mode ${args.mode}`);
  console.log(`source_products ${report.summary.totalSourceProducts}`);
  console.log(`create ${report.summary.create}`);
  console.log(`update ${report.summary.update}`);
  console.log(`keep ${report.summary.keep}`);
  console.log(`review ${report.summary.review}`);
  console.log(`archive_candidates ${report.summary.archiveCandidate}`);
  console.log(`output ${outPath}`);
  console.log(`index ${args.indexPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
