import fs from "node:fs";
import path from "node:path";

import { pool } from "../server/db";
import { storage } from "../server/storage";

type SnapshotProduct = {
  id: string;
  assetDir: string;
  image?: string;
  images?: string[];
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

function normalizeIdentity(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Cannot safely derive ${label}: expected string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`Cannot safely derive ${label}: empty value`);
  if (/[\r\n]/.test(normalized)) throw new Error(`Cannot safely derive ${label}: contains line breaks`);
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toOwnedImagePath(productId: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const ownedPrefixPattern = new RegExp(`^/images/products/${escapeRegExp(productId)}/.+`);
  return ownedPrefixPattern.test(normalized) ? normalized : null;
}

function buildSnapshotProduct(product: { id: string; image: string; images: string[] | null }): SnapshotProduct {
  const id = normalizeIdentity(product.id, "product id");
  const assetDir = id;

  const ownedCandidates: string[] = [];
  const primaryOwned = toOwnedImagePath(id, product.image);
  if (primaryOwned) ownedCandidates.push(primaryOwned);

  if (Array.isArray(product.images)) {
    for (const image of product.images) {
      const owned = toOwnedImagePath(id, image);
      if (owned) ownedCandidates.push(owned);
    }
  }

  const ownedUniqueSorted = Array.from(new Set(ownedCandidates)).sort((a, b) => a.localeCompare(b));
  const firstOwned = ownedUniqueSorted[0];

  const snapshot: SnapshotProduct = {
    id,
    assetDir,
  };

  if (firstOwned) snapshot.image = firstOwned;
  if (ownedUniqueSorted.length > 0) snapshot.images = ownedUniqueSorted;

  return snapshot;
}

async function main(): Promise<void> {
  const safeRunId = validateRunId(parseRunId(process.argv));
  const sanitizeRoot = path.resolve("tmp", "catalog-sanitize");
  const liveProductsPath = path.join(sanitizeRoot, `live-products.${safeRunId}.json`);
  const liveProductIdsPath = path.join(sanitizeRoot, `live-product-ids.${safeRunId}.txt`);
  const liveAssetDirsPath = path.join(sanitizeRoot, `live-asset-dirs.${safeRunId}.txt`);

  const products = await storage.getProducts();
  if (!Array.isArray(products)) throw new Error("Live products could not be loaded from DB.");

  const snapshotProducts = products
    .map((product) => buildSnapshotProduct({ id: product.id, image: product.image, images: product.images ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const liveProductIds = snapshotProducts.map((product) => product.id);
  const liveAssetDirs = Array.from(new Set(snapshotProducts.map((product) => product.assetDir))).sort((a, b) => a.localeCompare(b));

  const liveProductsPayload = {
    products: snapshotProducts,
  };

  await fs.promises.mkdir(sanitizeRoot, { recursive: true });

  await Promise.all([
    fs.promises.writeFile(liveProductsPath, `${JSON.stringify(liveProductsPayload, null, 2)}\n`, "utf8"),
    fs.promises.writeFile(liveProductIdsPath, liveProductIds.join("\n"), "utf8"),
    fs.promises.writeFile(liveAssetDirsPath, liveAssetDirs.join("\n"), "utf8"),
  ]);

  console.log(`runId: ${safeRunId}`);
  console.log(`live products: ${snapshotProducts.length}`);
  console.log(`created: ${liveProductsPath}`);
  console.log(`created: ${liveProductIdsPath}`);
  console.log(`created: ${liveAssetDirsPath}`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
