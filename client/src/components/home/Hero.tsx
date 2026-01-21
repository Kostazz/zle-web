// client/src/components/home/Hero.tsx
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PhotoGrid } from "./PhotoGrid";
import { ZleLogo } from "@/components/ZleLogo";

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14 md:mb-20">
          {/* HEADLINE: JED TO + logo side by side */}
          <div className="flex items-center justify-center gap-6 md:gap-10">
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight uppercase leading-none text-white">
              JEĎ TO
            </h1>

            {/* Hero uses the same stable logo as header (no drift) */}
            <ZleLogo variant="hero" className="zle-hero-logo" alt="ZLE" />
          </div>

          {/* subtitle */}
          <div className="mt-4 flex items-center justify-center">
            <p className="text-base md:text-lg text-white/70">
              ZLE = český underground, crew, humor, real life.
            </p>
          </div>

          {/* CTA */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/shop">
              <Button className="rounded-2xl">
                Shop <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>

            <Link href="/story">
              <Button variant="outline" className="rounded-2xl">
                Story
              </Button>
            </Link>
          </div>
        </div>

        {/* photos */}
        <PhotoGrid />
      </div>
    </section>
  );
}
