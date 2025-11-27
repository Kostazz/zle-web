import { useState } from "react";
import type { Product } from "@shared/schema";
import { ProductModal } from "./ProductModal";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isSoldOut = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;
  
  const hasMultipleImages = product.images && product.images.length > 1;
  const primaryImage = product.image;
  const secondaryImage = hasMultipleImages && product.images ? product.images[1] : null;

  return (
    <>
      <div 
        className={`group cursor-pointer zle-card p-3 ${isSoldOut ? "opacity-60" : ""}`}
        onClick={() => setIsModalOpen(true)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-testid={`card-product-${product.id}`}
      >
        <div className="relative aspect-square mb-4 overflow-hidden rounded-sm zle-photo-frame">
          <img
            src={primaryImage}
            alt={product.name}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 zle-bw-photo ${
              isSoldOut ? "" : isHovered && secondaryImage ? "opacity-0" : isHovered ? "scale-105 brightness-110" : ""
            }`}
            loading="lazy"
          />
          {secondaryImage && (
            <img
              src={secondaryImage}
              alt={`${product.name} - alternate view`}
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 zle-bw-photo ${
                isHovered ? "opacity-100 scale-105 brightness-110" : "opacity-0"
              }`}
              loading="lazy"
            />
          )}
          <div 
            className={`absolute inset-0 transition-opacity duration-300 ${
              isHovered ? "opacity-0" : "bg-black/10 opacity-100"
            }`}
          />
          
          {isSoldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="font-heading text-lg tracking-wider text-white bg-black px-4 py-2 border border-white">
                VYPRODÁNO
              </span>
            </div>
          )}
          
          {isLowStock && (
            <div className="absolute top-2 right-2">
              <span className="font-heading text-xs tracking-wider text-black bg-white px-2 py-1 shadow-lg">
                POSLEDNÍ KUSY
              </span>
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          <h3 
            className="font-heading text-sm md:text-base font-bold text-white tracking-wider zle-text-3d-subtle"
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
                className="text-xs text-white/50 border border-white/20 px-2 py-0.5 rounded-sm"
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
