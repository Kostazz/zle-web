import { productCatalog } from "../../shared/catalog/product-catalog.ts";

export type ToolingCatalogProduct = {
  id: string;
  name: string;
  category: string;
  sizes: string[];
  imageHints: string[];
};

const IMAGE_HINT_BY_CATEGORY: Record<string, string[]> = {
  cap: ["cover", "hat"],
  hoodie: ["cover", "hoodie"],
  tee: ["cover", "tee"],
};

export const toolingCatalogProducts: ToolingCatalogProduct[] = productCatalog.map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: entry.category,
  sizes: [...entry.sizes],
  imageHints: IMAGE_HINT_BY_CATEGORY[entry.category] ?? ["cover"],
}));
