import { eq } from "drizzle-orm";
import path from "node:path";
import { db } from "../server/db.ts";
import { products } from "../shared/schema.ts";
import { runImportTotalboardshopProducts } from "./lib/import-totalboardshop-products.ts";
import type { Product } from "@shared/schema";

type CliArgs = {
  runId: string;
  reportRoot?: string;
  sourceRoot?: string;
  liveImageRoot?: string;
};

const ALLOWED_REPORT_ROOT = path.resolve("tmp", "publish-reports");
const ALLOWED_SOURCE_ROOT = path.resolve("tmp", "source-datasets");
const ALLOWED_LIVE_IMAGE_ROOT = path.resolve("client", "public", "images", "products");

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let reportRoot: string | undefined;
  let sourceRoot: string | undefined;
  let liveImageRoot: string | undefined;
  let runId = "";
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--run-id") {
      runId = String(args.shift() ?? "").trim();
      continue;
    }
    if (token === "--report-root") {
      reportRoot = String(args.shift() ?? "").trim();
      continue;
    }
    if (token === "--source-root") {
      sourceRoot = String(args.shift() ?? "").trim();
      continue;
    }
    if (token === "--live-image-root") {
      liveImageRoot = String(args.shift() ?? "").trim();
      continue;
    }
    throw new Error(`Unknown argument: ${token ?? "<empty>"}`);
  }
  if (!runId) throw new Error("Missing required --run-id <runId>");
  return { runId, reportRoot, sourceRoot, liveImageRoot };
}

function resolveAllowlistedPath(value: string | undefined, allowedRoot: string, label: string): string | undefined {
  if (!value) return undefined;
  const resolved = path.resolve(value);
  if (!isPathInside(allowedRoot, resolved)) {
    throw new Error(`${label} must stay inside ${allowedRoot}: ${value}`);
  }
  return resolved;
}

async function main(): Promise<void> {
  const { runId, reportRoot, sourceRoot, liveImageRoot } = parseArgs(process.argv.slice(2));
  await runImportTotalboardshopProducts({
    runId,
    reportRoot: resolveAllowlistedPath(reportRoot, ALLOWED_REPORT_ROOT, "report root"),
    sourceRoot: resolveAllowlistedPath(sourceRoot, ALLOWED_SOURCE_ROOT, "source root"),
    liveImageRoot: resolveAllowlistedPath(liveImageRoot, ALLOWED_LIVE_IMAGE_ROOT, "live image root"),
    productWriter: {
      async upsertProduct(product: Product) {
        const existing = await db.select().from(products).where(eq(products.id, product.id)).limit(1);
        const [saved] = await db
          .insert(products)
          .values(product)
          .onConflictDoUpdate({
            target: products.id,
            set: {
              name: product.name,
              price: product.price,
              sizes: product.sizes,
              image: product.image,
              images: product.images,
              category: product.category,
              description: product.description,
              stock: product.stock,
              isActive: product.isActive,
              productModel: product.productModel,
              unitCost: product.unitCost,
              stockOwner: product.stockOwner,
              pricingMode: product.pricingMode,
              pricingPercent: product.pricingPercent,
            },
          })
          .returning();
        return { action: existing.length > 0 ? "updated" as const : "inserted" as const, product: saved };
      },
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
