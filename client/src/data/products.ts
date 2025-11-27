import type { Product } from "@shared/schema";

import hoodieImg from "@assets/generated_images/black_hoodie_product.png";
import teeImg from "@assets/generated_images/black_tee_product.png";
import capImg from "@assets/generated_images/black_cap_product.png";
import crewneckImg from "@assets/generated_images/black_crewneck_product.png";
import beanieImg from "@assets/generated_images/black_beanie_product.png";

export const products: Product[] = [
  {
    id: "zle-hoodie-alpha",
    name: "ZLE HOODIE ALPHA",
    price: 1290,
    sizes: ["S", "M", "L", "XL", "XXL"],
    image: hoodieImg,
    images: [hoodieImg],
    category: "hoodie",
    description: "Černá hoodie s bílým ZLE logem. Raw print. 100% bavlna, heavy weight.",
  },
  {
    id: "zle-hoodie-crew",
    name: "ZLE CREW HOODIE",
    price: 1390,
    sizes: ["S", "M", "L", "XL"],
    image: hoodieImg,
    images: [hoodieImg],
    category: "hoodie",
    description: "Limitovaná crew edice. Bílé logo + crew list na zádech. Premium quality.",
  },
  {
    id: "zle-tee-classic",
    name: "ZLE TEE CLASSIC",
    price: 590,
    sizes: ["S", "M", "L", "XL", "XXL"],
    image: teeImg,
    images: [teeImg],
    category: "tee",
    description: "Klasické černé tričko s bílým ZLE logem. 100% bavlna.",
  },
  {
    id: "zle-tee-underground",
    name: "ZLE UNDERGROUND TEE",
    price: 690,
    sizes: ["S", "M", "L", "XL"],
    image: teeImg,
    images: [teeImg],
    category: "tee",
    description: "Underground edice s velkým grafickým potiskem. Street vibe.",
  },
  {
    id: "zle-cap-og",
    name: "ZLE CAP OG",
    price: 490,
    sizes: ["ONE SIZE"],
    image: capImg,
    images: [capImg],
    category: "cap",
    description: "Černá kšiltovka s vyšitým ZLE logem. Nastavitelná velikost.",
  },
  {
    id: "zle-crewneck-heavy",
    name: "ZLE CREWNECK HEAVY",
    price: 1090,
    sizes: ["S", "M", "L", "XL"],
    image: crewneckImg,
    images: [crewneckImg],
    category: "crewneck",
    description: "Heavy weight crewneck. Minimalistický design. Raw print.",
  },
  {
    id: "zle-beanie-winter",
    name: "ZLE BEANIE",
    price: 390,
    sizes: ["ONE SIZE"],
    image: beanieImg,
    images: [beanieImg],
    category: "beanie",
    description: "Černá beanie s vyšitým ZLE logem. Acryl/vlna mix.",
  },
  {
    id: "zle-tee-fire",
    name: "ZLE FIRE TEE",
    price: 650,
    sizes: ["S", "M", "L", "XL", "XXL"],
    image: teeImg,
    images: [teeImg],
    category: "tee",
    description: "Limitovaná edice s retro fire logem. Sběratelský kus.",
  },
];

export const getProductById = (id: string): Product | undefined => {
  return products.find((p) => p.id === id);
};

export const getProductsByCategory = (category: string): Product[] => {
  return products.filter((p) => p.category === category);
};
