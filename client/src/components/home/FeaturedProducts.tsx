import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useProducts } from "@/hooks/use-products";
import { ProductCard } from "@/components/shop/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";

function ProductSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="aspect-square bg-white/10" />
      <Skeleton className="h-4 w-3/4 bg-white/10" />
      <Skeleton className="h-5 w-1/2 bg-white/10" />
    </div>
  );
}

export function FeaturedProducts() {
  const { data: products, isLoading } = useProducts();
  const featured = products?.slice(0, 4) ?? [];

  return (
    <section className="py-20 md:py-32 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-12">
          <div>
            <h2 
              className="font-display text-3xl md:text-5xl text-white tracking-tight mb-2"
              data-testid="text-featured-title"
            >
              MERCH
            </h2>
            <p className="font-sans text-white/60">
              Nejnovější kousky ze shopu
            </p>
          </div>
          <Link href="/shop">
            <Button 
              variant="outline"
              className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black transition-all group"
              data-testid="button-featured-all"
            >
              CELÝ SHOP
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <ProductSkeleton key={index} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
