import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH,
  DEFAULT_LIVE_PRODUCTS_ROOT,
  DEFAULT_PRODUCT_VERSIONS_ROOT,
  MANAGED_ASSET_FILE_RE,
  assertNoSymlinkInPathChain,
  isPathInside,
} from "../../script/lib/remigration-asset-roots.ts";

export type ProductAssetsResolverMode = "v2-root-switch" | "v3-versioned-assets";

export function shouldBypassGenericImagesStatic(reqPath: string, mode: ProductAssetsResolverMode): boolean {
  if (mode !== "v3-versioned-assets") return false;
  return /^\/products(?:\/|$)/.test(reqPath);
}

type ActivePointer = {
  mode: "v3-versioned-assets";
  versionId: string;
  sourceRunId: string;
  activatedAt: string;
};

function parsePointer(raw: string): ActivePointer {
  const parsed = JSON.parse(raw) as Partial<ActivePointer>;
  if (!parsed || typeof parsed !== "object") throw new Error("pointer is not object");
  if (parsed.mode !== "v3-versioned-assets") throw new Error("pointer mode invalid");
  if (typeof parsed.versionId !== "string" || !parsed.versionId) throw new Error("pointer versionId missing");
  if (typeof parsed.sourceRunId !== "string" || !parsed.sourceRunId) throw new Error("pointer sourceRunId missing");
  if (typeof parsed.activatedAt !== "string" || !parsed.activatedAt) throw new Error("pointer activatedAt missing");
  return parsed as ActivePointer;
}

function sanitizeAssetPath(productId: string, fileName: string): { productId: string; fileName: string } {
  const normalizedProduct = productId.trim();
  const normalizedFileName = fileName.trim();
  if (!normalizedProduct || normalizedProduct.includes("/") || normalizedProduct.includes("..")) {
    throw new Error("invalid product id");
  }
  if (!MANAGED_ASSET_FILE_RE.test(normalizedFileName)) {
    throw new Error("invalid managed asset file");
  }
  return { productId: normalizedProduct, fileName: normalizedFileName };
}

export async function resolveProductAssetAbsolutePath(
  productId: string,
  fileName: string,
  mode: ProductAssetsResolverMode,
): Promise<string | null> {
  const safe = sanitizeAssetPath(productId, fileName);

  if (mode === "v2-root-switch") {
    const candidate = path.join(DEFAULT_LIVE_PRODUCTS_ROOT, safe.productId, safe.fileName);
    const resolved = path.resolve(candidate);
    if (!isPathInside(DEFAULT_LIVE_PRODUCTS_ROOT, resolved)) throw new Error("path traversal blocked");
    await assertNoSymlinkInPathChain(resolved, DEFAULT_LIVE_PRODUCTS_ROOT);
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  }

  if (!fs.existsSync(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH)) return null;

  let pointer: ActivePointer;
  try {
    pointer = parsePointer(await fs.promises.readFile(DEFAULT_ACTIVE_PRODUCT_ASSETS_PATH, "utf8"));
  } catch {
    return null;
  }

  const candidate = path.join(DEFAULT_PRODUCT_VERSIONS_ROOT, pointer.versionId, safe.productId, safe.fileName);
  const resolved = path.resolve(candidate);
  if (!isPathInside(DEFAULT_PRODUCT_VERSIONS_ROOT, resolved)) throw new Error("path traversal blocked");
  await assertNoSymlinkInPathChain(resolved, DEFAULT_PRODUCT_VERSIONS_ROOT);
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
