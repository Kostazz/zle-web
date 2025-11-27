import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PhotoGrid } from "./PhotoGrid";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="min-h-screen flex flex-col justify-center py-16 md:py-24">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 md:mb-16">
          <h1 
            className="font-display text-5xl sm:text-6xl md:text-8xl lg:text-9xl text-white tracking-tight mb-6 opacity-0 animate-fade-in"
            style={{ animationDelay: "0.2s" }}
            data-testid="text-hero-title"
          >
            JEĎ TO ZLE
          </h1>
          <p 
            className="font-heading text-lg md:text-xl text-white/70 tracking-wide max-w-xl mx-auto opacity-0 animate-fade-in"
            style={{ animationDelay: "0.4s" }}
            data-testid="text-hero-subtitle"
          >
            ZLE = český underground, crew, humor, real life.
          </p>
        </div>

        <div 
          className="opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.6s" }}
        >
          <PhotoGrid />
        </div>

        <div 
          className="flex justify-center mt-12 md:mt-16 opacity-0 animate-fade-in"
          style={{ animationDelay: "1s" }}
        >
          <Link href="/shop">
            <Button 
              size="lg"
              className="font-heading text-base md:text-lg tracking-wider bg-white text-black hover:bg-white/90 px-8 md:px-12 py-6 md:py-7 group"
              data-testid="button-hero-shop"
            >
              JDU DO SHOPU
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
