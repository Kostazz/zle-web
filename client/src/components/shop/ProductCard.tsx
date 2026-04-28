import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useOverlay } from "@/lib/overlay-context";
import type { ProductPublic } from "@shared/product-public";
import { ProductModal } from "./ProductModal";
import { ImageOff } from "lucide-react";
import {
  formatSizeLabel,
  getOwnedDeclaredProductImages,
  getSelectableSizes,
  isImageOwnedByProduct,
} from "@/lib/product-ui";

function ImagePlaceholder({ name }: { name: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/5 border border-white/10">
      <ImageOff className="w-12 h-12 text-white/30 mb-2" />
      <span className="font-heading text-xs text-white/40 tracking-wider text-center px-4">
        {name}
      </span>
    </div>
  );
}

interface ProductCardProps {
  product: ProductPublic;
}

export function ProductCard({ product }: ProductCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0);
  const [secondaryImageIndex, setSecondaryImageIndex] = useState(0);
  const { openOverlay } = useOverlay();
  const isSoldOut = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;

  const declaredImages = useMemo(() => getOwnedDeclaredProductImages(product), [product]);

  const localPrimaryCandidates = useMemo(
    () => [`/images/products/${product.id}/cover.jpg`, `/images/products/${product.id}/cover.webp`],
    [product.id],
  );

  const localSecondaryCandidates = useMemo(
    () => [`/images/products/${product.id}/01.jpg`, `/images/products/${product.id}/01.webp`],
    [product.id],
  );

  const primaryCandidates = useMemo(() => {
    const unique = new Set<string>();

    for (const image of localPrimaryCandidates) {
      unique.add(image);
    }

    for (const image of declaredImages) {
      if (isImageOwnedByProduct(product, image)) {
        unique.add(image);
      }
    }

    return Array.from(unique);
  }, [declaredImages, localPrimaryCandidates, product]);

  const hasPrimaryImage = primaryImageIndex < primaryCandidates.length;
  const primaryImage = hasPrimaryImage ? primaryCandidates[primaryImageIndex] : null;

  const secondaryCandidates = useMemo(() => {
    const unique = new Set<string>();

    for (const image of localSecondaryCandidates) {
      unique.add(image);
    }

    for (const image of declaredImages) {
      if (isImageOwnedByProduct(product, image)) {
        unique.add(image);
      }
    }

    return Array.from(unique).filter((image) => image !== primaryImage);
  }, [declaredImages, localSecondaryCandidates, primaryImage, product]);

  const secondaryCandidate = secondaryCandidates[secondaryImageIndex] ?? null;
  const secondaryImage =
    secondaryCandidate && isImageOwnedByProduct(product, secondaryCandidate) ? secondaryCandidate : null;

  const selectableSizes = getSelectableSizes(product);

  return (
    <>
      <div
        id={`product-${product.id}`}
        className={`group zle-card p-3 ${isSoldOut ? "opacity-60" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-testid={`card-product-${product.id}`}
      >
        <Link href={`/p/${product.id}`} className="block cursor-pointer">
          <div className="relative aspect-square mb-4 overflow-hidden rounded-sm zle-photo-frame">
            {!primaryImage ? (
              <ImagePlaceholder name={product.name} />
            ) : (
              <>
                <img
                  src={primaryImage}
                  alt={product.name}
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 zle-bw-photo ${
                    isSoldOut
                      ? ""
                      : isHovered && secondaryImage
                        ? "opacity-0"
                        : isHovered
                          ? "scale-105 brightness-110"
                          : ""
                  }`}
                  loading="lazy"
                  onError={() => setPrimaryImageIndex((index) => index + 1)}
                />
                {secondaryImage && (
                  <img
                    src={secondaryImage}
                    alt={`${product.name} - alternate view`}
                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 zle-bw-photo ${
                      isHovered ? "opacity-100 scale-105 brightness-110" : "opacity-0"
                    }`}
                    loading="lazy"
                    onError={() => setSecondaryImageIndex((index) => index + 1)}
                  />
                )}
              </>
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
              {selectableSizes.map((size) => (
                <span
                  key={size}
                  className="text-xs text-white/50 border border-white/20 px-2 py-0.5 rounded-sm"
                >
                  {formatSizeLabel(size)}
                </span>
              ))}
            </div>
          </div>
        </Link>

        <button
          type="button"
          className="mt-3 text-xs text-white/70 underline hover:text-white"
          onClick={() => openOverlay({ type: "product", productId: product.id })}
          data-testid={`button-quick-view-${product.id}`}
        >
          Rychlý náhled
        </button>
      </div>

      <ProductModal product={product} />
    </>
  );
}
