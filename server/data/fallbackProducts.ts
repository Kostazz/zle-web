// server/data/fallbackProducts.ts

type FallbackProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;      // URL string (ne import)
  images?: string[];  // optional
  inStock?: boolean;
};

export const fallbackProducts: FallbackProduct[] = [
  {
    id: "hoodie-black",
    name: "ZLE Hoodie — Black",
    description: "Raw crew hoodie. Žádný kompromis.",
    price: 1490,
    category: "hoodies",
    image: "/assets/generated_images/black_hoodie_product.png",
    inStock: true,
  },
  {
    id: "tee-black",
    name: "ZLE Tee — Black",
    description: "Černý tričko, čistý statement.",
    price: 690,
    category: "tees",
    image: "/assets/generated_images/black_tee_product.png",
    inStock: true,
  },
  {
    id: "cap-black",
    name: "ZLE Cap — Black",
    description: "Kšiltovka pro crew režim.",
    price: 490,
    category: "caps",
    image: "/assets/generated_images/black_cap_product.png",
    inStock: true,
  },
  {
    id: "crewneck-black",
    name: "ZLE Crewneck — Black",
    description: "Crewneck, co drží tvar i styl.",
    price: 1190,
    category: "crewnecks",
    image: "/assets/generated_images/black_crewneck_product.png",
    inStock: true,
  },
  {
    id: "beanie-black",
    name: "ZLE Beanie — Black",
    description: "Beanie. Jednoduchý. Tvrdý.",
    price: 390,
    category: "beanies",
    image: "/assets/generated_images/black_beanie_product.png",
    inStock: true,
  },
];
