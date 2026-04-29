import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { Layout } from "@/components/layout/Layout";
import NotFound from "@/pages/not-found";
import { useProducts } from "@/hooks/use-products";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/lib/cart-context";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import {
  formatSizeLabel,
  getDefaultSelectedSize,
  getProductImageCandidates,
  getSelectableSizes,
  requiresExplicitSizeSelection,
} from "@/lib/product-ui";

export default function ProductDetail() {
  const [, params] = useRoute("/p/:id");
  const productId = params?.id ?? "";
  const { data: products, isLoading, error } = useProducts();
  const product = useMemo(() => products?.find((item) => item.id === productId), [products, productId]);
  const relatedProducts = useMemo(() => {
    if (!products || !product) {
      return [];
    }

    return products
      .filter((item) => item.isActive && item.id !== product.id)
      .sort((a, b) => Number(b.category === product.category) - Number(a.category === product.category))
      .slice(0, 4);
  }, [products, product]);

  const [selectedImageSrc, setSelectedImageSrc] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [hiddenImageSet, setHiddenImageSet] = useState<Set<string>>(new Set());
  const { addItem } = useCart();
  const { toast } = useToast();
  const imageCandidates = useMemo(() => (product ? getProductImageCandidates(product) : []), [product]);
  const images = useMemo(
    () => imageCandidates.filter((image) => !hiddenImageSet.has(image)).slice(0, 8),
    [imageCandidates, hiddenImageSet]
  );
  const mainImage =
    selectedImageSrc && images.includes(selectedImageSrc) ? selectedImageSrc : images[0] ?? "";
  const selectedImageIndex = mainImage ? images.indexOf(mainImage) : -1;
  const selectableSizes = product ? getSelectableSizes(product) : [];
  const defaultSelectedSize = product ? getDefaultSelectedSize(product) : null;
  const sizeSelectionRequired = product ? requiresExplicitSizeSelection(product) : false;
  const resolvedSize = selectedSize ?? defaultSelectedSize;
  const isSoldOut = product ? product.stock <= 0 : true;

  const productState = isLoading ? "loading" : error || !product ? "NOT_FOUND" : "found";

  useEffect(() => {
    let robotsTag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');

    if (productState === "NOT_FOUND") {
      if (!robotsTag) {
        robotsTag = document.createElement("meta");
        robotsTag.setAttribute("name", "robots");
        document.head.appendChild(robotsTag);
      }
      robotsTag.setAttribute("content", "noindex");
      return;
    }

    if (robotsTag?.getAttribute("content") === "noindex") {
      robotsTag.remove();
    }
  }, [productState]);

  useEffect(() => {
    setSelectedImageSrc(null);
    setHiddenImageSet(new Set());
  }, [product?.id]);

  const hideImage = (image: string) => {
    setHiddenImageSet((current) => {
      if (current.has(image)) {
        return current;
      }

      const next = new Set(current);
      next.add(image);
      return next;
    });
  };

  if (productState === "loading") {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Skeleton className="aspect-square bg-white/10" />
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3 bg-white/10" />
              <Skeleton className="h-6 w-1/3 bg-white/10" />
              <Skeleton className="h-20 w-full bg-white/10" />
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  if (productState === "NOT_FOUND") {
    return <NotFound />;
  }

  if (!product) {
    return <NotFound />;
  }

  const handleAddToCart = () => {
    if (isSoldOut) {
      return;
    }

    if (sizeSelectionRequired && !resolvedSize) {
      toast({
        title: "Vyber velikost",
        description: "Před přidáním do košíku musíš vybrat velikost.",
        variant: "destructive",
      });
      return;
    }

    if (!resolvedSize) {
      return;
    }

    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      size: resolvedSize,
      quantity: 1,
      image: mainImage,
    });

    toast({
      title: "Přidáno do košíku",
      description: `${product.name} (${formatSizeLabel(resolvedSize)}) je v košíku.`,
    });
  };

  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <Link
            href="/shop"
            className="mb-6 inline-flex items-center gap-2 font-heading text-sm tracking-wider text-white/85 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            ZPĚT DO SHOPU
          </Link>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            <div>
              <div className="relative aspect-square bg-black/20 border border-white/10 overflow-hidden">
                {mainImage ? (
                  <img
                    src={mainImage}
                    alt={`${product.name} ZLE streetwear`}
                    className="w-full h-full object-cover"
                    onError={() => {
                      if (mainImage) {
                        hideImage(mainImage);
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/50">Bez obrázku</div>
                )}
              </div>
              {images.length > 1 && (
                <div className="grid grid-cols-4 md:grid-cols-5 gap-2 mt-3">
                  {images.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      onClick={() => setSelectedImageSrc(image)}
                      className={`aspect-square border overflow-hidden ${
                        selectedImageIndex === index ? "border-white" : "border-white/20"
                      }`}
                    >
                      <img
                        src={image}
                        alt={`${product.name} ZLE streetwear ${index + 1}`}
                        className="w-full h-full object-cover"
                        onError={() => hideImage(image)}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <h1 className="font-display text-4xl text-white tracking-tight">{product.name}</h1>
              <p className="font-sans text-2xl font-semibold text-white">{product.price} Kč</p>
              <p className="text-white/70 leading-relaxed">{product.description}</p>

              {(product.material || product.dimensions || (product.badges?.length ?? 0) > 0 || (product.tags?.length ?? 0) > 0) && (
                <div className="space-y-4 rounded-sm border border-white/10 bg-white/[0.02] p-4">
                  <p className="font-heading text-xs tracking-wider text-white/55">DETAILY</p>
                  {(product.badges?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(product.badges ?? []).map((badge) => (
                        <span key={badge} className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}
                  {product.material && (
                    <div>
                      <p className="font-heading text-xs tracking-wider text-white/55">MATERIÁL</p>
                      <p className="mt-1 text-sm text-white/85">{product.material}</p>
                    </div>
                  )}
                  {product.dimensions && (
                    <div>
                      <p className="font-heading text-xs tracking-wider text-white/55">ROZMĚRY</p>
                      <p className="mt-1 text-sm text-white/85">{product.dimensions}</p>
                    </div>
                  )}
                  {(product.tags?.length ?? 0) > 0 && (
                    <div>
                      <p className="font-heading text-xs tracking-wider text-white/55">TAGY</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(product.tags ?? []).map((tag) => (
                          <span key={tag} className="rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/70">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="font-heading text-xs tracking-wider text-white/60 mb-2">VELIKOSTI</p>
                <div className="flex flex-wrap gap-2">
                  {selectableSizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      className={`px-3 py-1.5 border text-sm ${
                        selectedSize === size ? "bg-white text-black border-white" : "border-white/30 text-white"
                      }`}
                    >
                      {formatSizeLabel(size)}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleAddToCart}
                disabled={isSoldOut}
                className="w-full md:w-auto bg-white text-black hover:bg-white/90"
                data-testid="button-product-detail-add-to-cart"
              >
                <ShoppingBag className="mr-2 h-4 w-4" />
                {isSoldOut ? "VYPRODÁNO" : "PŘIDAT DO KOŠÍKU"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {relatedProducts.length > 0 && (
        <section className="pb-16 md:pb-24">
          <div className="container mx-auto px-4">
            <h2 className="font-heading text-xl md:text-2xl text-white tracking-wider mb-6">
              SOUVISEJÍCÍ PRODUKTY
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedProducts.map((related) => (
                <Link
                  key={related.id}
                  href={`/p/${related.id}`}
                  className="block border border-white/15 p-3 hover:border-white/40 transition-colors"
                >
                  <p className="font-heading text-sm text-white tracking-wider">{related.name}</p>
                  <p className="text-white/70 text-sm mt-1">{related.price} Kč</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
