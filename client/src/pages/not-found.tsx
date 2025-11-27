import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <Layout>
      <section className="py-24 md:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center">
            <span className="font-display text-8xl md:text-9xl text-white/20 block mb-4">
              404
            </span>
            <h1 className="font-display text-3xl md:text-4xl text-white tracking-tight mb-4">
              ZLE CESTA
            </h1>
            <p className="font-sans text-white/60 mb-8">
              Tahle stránka neexistuje. Vrať se zpátky.
            </p>
            <Button
              asChild
              className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 group"
            >
              <Link href="/" data-testid="link-404-home">
                <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                ZPĚT NA HLAVNÍ
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
