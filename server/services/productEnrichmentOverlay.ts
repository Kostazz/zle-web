import fs from "node:fs/promises";
import path from "node:path";

import type { Product } from "@shared/schema";
import type { ProductPublic } from "@shared/product-public";
import {
  parseProductEnrichmentManifest,
  type ProductEnrichmentEntry,
  type ProductEnrichmentManifest,
} from "../../script/lib/product-enrichment";

const PRODUCT_ENRICHMENT_MANIFEST_PATH = path.join(
  process.cwd(),
  "data",
  "product-enrichment",
  "zle-product-enrichment.json",
);

type ManifestCache = {
  filePath: string;
  mtimeMs: number;
  manifest: ProductEnrichmentManifest;
};

let manifestCache: ManifestCache | null = null;
let lastWarningKey: string | null = null;

function warnOnce(key: string, error: unknown) {
  if (lastWarningKey === key) {
    return;
  }

  lastWarningKey = key;
  console.warn("[product-enrichment] fail-soft: using empty manifest", {
    key,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function loadProductEnrichmentManifest(
  filePath = PRODUCT_ENRICHMENT_MANIFEST_PATH,
): Promise<ProductEnrichmentManifest> {
  try {
    const stat = await fs.stat(filePath);

    if (
      manifestCache &&
      manifestCache.filePath === filePath &&
      manifestCache.mtimeMs === stat.mtimeMs
    ) {
      return manifestCache.manifest;
    }

    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsedJson = JSON.parse(content) as unknown;
      const manifest = parseProductEnrichmentManifest(parsedJson);

      manifestCache = {
        filePath,
        mtimeMs: stat.mtimeMs,
        manifest,
      };

      return manifest;
    } catch (error) {
      const key = `${filePath}:${stat.mtimeMs}:${error instanceof Error ? error.message : String(error)}`;
      warnOnce(key, error);
      manifestCache = {
        filePath,
        mtimeMs: stat.mtimeMs,
        manifest: {},
      };
      return {};
    }
  } catch (error) {
    const key = `${filePath}:missing:${error instanceof Error ? error.message : String(error)}`;
    warnOnce(key, error);
    manifestCache = {
      filePath,
      mtimeMs: -1,
      manifest: {},
    };
    return {};
  }
}

export function toPublicProduct(product: Product, enrichment?: ProductEnrichmentEntry): ProductPublic {
  const publicProduct: ProductPublic = {
    id: product.id,
    name: enrichment?.displayName ?? product.name,
    price: product.price,
    sizes: product.sizes,
    image: product.image,
    images: product.images,
    category: product.category,
    description: enrichment?.description ?? product.description,
    stock: product.stock,
    isActive: product.isActive,
    productModel: product.productModel,
  };

  if (enrichment?.material) publicProduct.material = enrichment.material;
  if (enrichment?.dimensions) publicProduct.dimensions = enrichment.dimensions;
  if (enrichment?.seoTitle) publicProduct.seoTitle = enrichment.seoTitle;
  if (enrichment?.seoDescription) publicProduct.seoDescription = enrichment.seoDescription;
  if (enrichment?.badges) publicProduct.badges = enrichment.badges;
  if (enrichment?.tags) publicProduct.tags = enrichment.tags;

  return publicProduct;
}

export function toPublicProducts(
  products: Product[],
  manifest: ProductEnrichmentManifest,
): ProductPublic[] {
  return products.map((product) => toPublicProduct(product, manifest[product.id]));
}

export function __resetProductEnrichmentManifestCacheForTests() {
  manifestCache = null;
  lastWarningKey = null;
}
