import { useState, useMemo } from "react";
import { useProducts } from "@/hooks/use-products";
import { ProductCard } from "./ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const categories = [
  { id: "all", label: "VŠE" },
  { id: "hoodie", label: "HOODIES" },
  { id: "tee", label: "TRIKA" },
  { id: "cap", label: "ČEPICE" },
  { id: "crewneck", label: "CREWNECKS" },
  { id: "beanie", label: "BEANIES" },
];

function ProductSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="aspect-square bg-white/10" />
      <Skeleton className="h-4 w-3/4 bg-white/10" />
      <Skeleton className="h-5 w-1/2 bg-white/10" />
    </div>
  );
}

export function ProductGrid() {
  const [activeCategory, setActiveCategory] = useState("all");
  const { data: products, isLoading, error } = useProducts();

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (activeCategory === "all") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="font-sans text-white/60">
          Nepodařilo se načíst produkty. Zkus to znovu později.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-8 md:mb-12">
        {categories.map((category) => (
          <Button
            key={category.id}
            variant={activeCategory === category.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory(category.id)}
            className={`font-heading text-xs tracking-wider ${
              activeCategory === category.id
                ? "bg-white text-black hover:bg-white/90"
                : "border-white/30 text-white hover:bg-white hover:text-black"
            }`}
            data-testid={`button-category-${category.id}`}
          >
            {category.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {Array.from({ length: 8 }).map((_, index) => (
            <ProductSkeleton key={index} />
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-sans text-white/60">
            V této kategorii zatím nemáme žádné produkty.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {filteredProducts.map((product, index) => (
            <div
              key={product.id}
              className="opacity-0 animate-fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
