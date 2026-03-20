import { eq } from "drizzle-orm";
import { db } from "../server/db.ts";
import { products } from "../shared/schema.ts";
import { runImportTotalboardshopProducts } from "./lib/import-totalboardshop-products.ts";
import type { Product } from "@shared/schema";

function parseArgs(argv: string[]): { runId: string } {
  const args = [...argv];
  let runId = "";
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--run-id") {
      runId = String(args.shift() ?? "").trim();
      continue;
    }
    throw new Error(`Unknown argument: ${token ?? "<empty>"}`);
  }
  if (!runId) throw new Error("Missing required --run-id <runId>");
  return { runId };
}

async function main(): Promise<void> {
  const { runId } = parseArgs(process.argv.slice(2));
  await runImportTotalboardshopProducts({
    runId,
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
