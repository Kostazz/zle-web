import { useState } from "react";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ProductModal } from "./ProductModal";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div 
        className="group cursor-pointer"
        onClick={() => setIsModalOpen(true)}
        data-testid={`card-product-${product.id}`}
      >
        <div className="relative aspect-square bg-white mb-4 overflow-hidden">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
        </div>
        
        <div className="space-y-2">
          <h3 
            className="font-heading text-sm md:text-base font-bold text-white tracking-wider"
            data-testid={`text-product-name-${product.id}`}
          >
            {product.name}
          </h3>
          <p 
            className="font-sans text-lg md:text-xl font-semibold text-white"
            data-testid={`text-product-price-${product.id}`}
          >
            {product.price} Kč
          </p>
          <div className="flex flex-wrap gap-1">
            {product.sizes.map((size) => (
              <span
                key={size}
                className="text-xs text-white/50 border border-white/20 px-2 py-0.5"
              >
                {size}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ProductModal
        product={product}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
