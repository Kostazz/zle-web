import { Layout } from "@/components/layout/Layout";
import { ProductGrid } from "@/components/shop/ProductGrid";

export default function Shop() {
  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 md:mb-16">
            <h1 
              className="font-display text-4xl md:text-6xl text-white tracking-tight mb-4 opacity-0 animate-fade-in"
              data-testid="text-shop-title"
            >
              SHOP
            </h1>
            <p className="font-sans text-lg text-white/60 opacity-0 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              Originální ZLE merch. Raw kvalita. Žádný kompromis.
            </p>
          </div>

          <ProductGrid />
        </div>
      </section>
    </Layout>
  );
}
