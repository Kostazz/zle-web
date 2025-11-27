import { useState } from "react";
import type { Product } from "@shared/schema";
import { ProductModal } from "./ProductModal";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isSoldOut = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;

  return (
    <>
      <div 
        className={`group cursor-pointer ${isSoldOut ? "opacity-60" : ""}`}
        onClick={() => setIsModalOpen(true)}
        data-testid={`card-product-${product.id}`}
      >
        <div className="relative aspect-square bg-white mb-4 overflow-hidden">
          <img
            src={product.image}
            alt={product.name}
            className={`w-full h-full object-cover transition-transform duration-500 ${
              isSoldOut ? "" : "group-hover:scale-105"
            }`}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
          
          {isSoldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="font-heading text-lg tracking-wider text-white bg-black px-4 py-2 border border-white">
                VYPRODÁNO
              </span>
            </div>
          )}
          
          {isLowStock && (
            <div className="absolute top-2 right-2">
              <span className="font-heading text-xs tracking-wider text-black bg-white px-2 py-1">
                POSLEDNÍ KUSY
              </span>
            </div>
          )}
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
            {product.price} Kc
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
