export type ProductPublic = {
  id: string;
  name: string;
  price: number;
  sizes: string[];
  image: string;
  images: string[] | null;
  category: string;
  description: string;
  stock: number;
  isActive: boolean | null;
  productModel: string | null;

  material?: string;
  dimensions?: string;
  seoTitle?: string;
  seoDescription?: string;
  badges?: string[];
  tags?: string[];
};
