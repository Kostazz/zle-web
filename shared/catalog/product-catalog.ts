import type { Product } from "../schema";

export type ProductCatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  defaultDriveFolder: string;
  expectedKeywords: string[];
  sizes: string[];
  status: "draft" | "review" | "approved" | "published";
  sourceUrl?: string;
  externalSource?: "totalboardshop" | string;
};

export const productCatalog: ProductCatalogEntry[] = [
  {
    id: "zle-hoodie-alpha",
    name: "ZLE HOODIE ALPHA",
    aliases: ["hoodie alpha", "zle alpha hoodie"],
    category: "hoodie",
    defaultDriveFolder: "30_APPROVED/zle-hoodie-alpha",
    expectedKeywords: ["hoodie", "alpha", "zle"],
    sizes: ["S", "M", "L", "XL", "XXL"],
    status: "published",
  },
  {
    id: "zle-hoodie-crew",
    name: "ZLE CREW HOODIE",
    aliases: ["crew hoodie", "zle crew hoodie"],
    category: "hoodie",
    defaultDriveFolder: "30_APPROVED/zle-hoodie-crew",
    expectedKeywords: ["hoodie", "crew", "zle"],
    sizes: ["S", "M", "L", "XL"],
    status: "published",
  },
  {
    id: "zle-tee-classic",
    name: "ZLE TEE CLASSIC",
    aliases: ["tee classic", "classic tee", "zle classic"],
    category: "tee",
    defaultDriveFolder: "30_APPROVED/zle-tee-classic",
    expectedKeywords: ["tee", "classic", "zle"],
    sizes: ["S", "M", "L", "XL", "XXL"],
    status: "published",
  },
  {
    id: "zle-tee-underground",
    name: "ZLE UNDERGROUND TEE",
    aliases: ["underground tee", "zle underground"],
    category: "tee",
    defaultDriveFolder: "30_APPROVED/zle-tee-underground",
    expectedKeywords: ["tee", "underground", "zle"],
    sizes: ["S", "M", "L", "XL"],
    status: "published",
  },
  {
    id: "zle-cap-og",
    name: "ZLE CAP OG",
    aliases: ["cap og", "zle cap", "og cap"],
    category: "cap",
    defaultDriveFolder: "30_APPROVED/zle-cap-og",
    expectedKeywords: ["cap", "hat", "og", "zle"],
    sizes: ["ONE SIZE"],
    status: "published",
  },
  {
    id: "zle-crewneck-heavy",
    name: "ZLE CREWNECK HEAVY",
    aliases: ["crewneck heavy", "zle crewneck"],
    category: "crewneck",
    defaultDriveFolder: "30_APPROVED/zle-crewneck-heavy",
    expectedKeywords: ["crewneck", "heavy", "zle"],
    sizes: ["S", "M", "L", "XL"],
    status: "published",
  },
  {
    id: "zle-beanie-winter",
    name: "ZLE BEANIE",
    aliases: ["beanie", "winter beanie", "zle beanie"],
    category: "beanie",
    defaultDriveFolder: "30_APPROVED/zle-beanie-winter",
    expectedKeywords: ["beanie", "winter", "zle"],
    sizes: ["ONE SIZE"],
    status: "published",
  },
  {
    id: "zle-tee-fire",
    name: "ZLE FIRE TEE",
    aliases: ["fire tee", "zle fire"],
    category: "tee",
    defaultDriveFolder: "30_APPROVED/zle-tee-fire",
    expectedKeywords: ["tee", "fire", "retro", "zle"],
    sizes: ["S", "M", "L", "XL", "XXL"],
    status: "published",
  },
];

export function getCatalogEntryById(productId: string): ProductCatalogEntry | undefined {
  return productCatalog.find((entry) => entry.id === productId);
}

export function mapCatalogEntryToProduct(entry: ProductCatalogEntry): Product {
  const image = entry.category === "cap"
    ? "/assets/generated_images/black_cap_product.png"
    : entry.category === "crewneck"
      ? "/assets/generated_images/black_crewneck_product.png"
      : entry.category === "beanie"
        ? "/assets/generated_images/black_beanie_product.png"
        : entry.category === "hoodie"
          ? "/assets/generated_images/black_hoodie_product.png"
          : "/assets/generated_images/black_tee_product.png";

  return {
    id: entry.id,
    name: entry.name,
    price: 0,
    sizes: entry.sizes,
    image,
    images: [image],
    category: entry.category,
    description: "",
    stock: 0,
    isActive: true,
    productModel: "legacy",
    unitCost: null,
    stockOwner: null,
    pricingMode: null,
    pricingPercent: null,
  };
}
