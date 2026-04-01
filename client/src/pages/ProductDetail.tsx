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
  getOwnedProductGalleryImages,
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

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const { addItem } = useCart();
  const { toast } = useToast();

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

  const images = getOwnedProductGalleryImages(product, 8);
  const mainImage = images[selectedImageIndex] ?? images[0] ?? "";
  const selectableSizes = getSelectableSizes(product);
  const defaultSelectedSize = getDefaultSelectedSize(product);
  const sizeSelectionRequired = requiresExplicitSizeSelection(product);
  const resolvedSize = selectedSize ?? defaultSelectedSize;
  const isSoldOut = product.stock <= 0;

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
                    onError={() => setSelectedImageIndex((current) => current + 1)}
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
                      onClick={() => setSelectedImageIndex(index)}
                      className={`aspect-square border overflow-hidden ${
                        selectedImageIndex === index ? "border-white" : "border-white/20"
                      }`}
                    >
                      <img
                        src={image}
                        alt={`${product.name} ZLE streetwear ${index + 1}`}
                        className="w-full h-full object-cover"
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
