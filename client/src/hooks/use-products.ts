import { useQuery } from "@tanstack/react-query";
import type { ProductPublic } from "@shared/product-public";

export function useProducts() {
  return useQuery<ProductPublic[]>({
    queryKey: ["/api/products"],
  });
}

export function useProduct(id: string) {
  return useQuery<ProductPublic>({
    queryKey: ["/api/products", id],
    enabled: !!id,
  });
}

export function useProductsByCategory(category: string) {
  return useQuery<ProductPublic[]>({
    queryKey: ["/api/products/category", category],
    enabled: !!category && category !== "all",
  });
}
