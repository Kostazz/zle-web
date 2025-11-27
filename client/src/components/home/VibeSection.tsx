import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

import urbanImg from "@assets/generated_images/urban_skate_scene_grain.png";
import crewImg from "@assets/generated_images/crew_silhouettes_grain.png";
import streetImg from "@assets/generated_images/street_corner_urban.png";

const vibePhotos = [
  { id: 1, src: urbanImg, alt: "Urban scene" },
  { id: 2, src: crewImg, alt: "Crew vibes" },
  { id: 3, src: streetImg, alt: "Street life" },
];

export function VibeSection() {
  return (
    <section className="py-20 md:py-32 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 md:mb-16">
            <h2 
              className="font-display text-3xl md:text-5xl text-white tracking-tight mb-6"
              data-testid="text-vibe-title"
            >
              ZLE VIBE
            </h2>
            <p className="font-sans text-lg text-white/70 leading-relaxed max-w-2xl">
              Značka, která vznikla na ulici. Žádný marketing, žádné bullshit. 
              Jenom crew, desky a real shit. ZLE není módní značka - je to lifestyle.
              Nosíme to, protože to cítíme.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-6 mb-12 md:mb-16">
            {vibePhotos.map((photo) => (
              <div
                key={photo.id}
                className="aspect-square overflow-hidden bg-white/5"
                data-testid={`image-vibe-${photo.id}`}
              >
                <img
                  src={photo.src}
                  alt={photo.alt}
                  className="w-full h-full object-cover grayscale hover:scale-105 transition-transform duration-500"
                  style={{ filter: "grayscale(100%) contrast(1.1)" }}
                  loading="lazy"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/story">
              <Button 
                variant="outline"
                size="lg"
                className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black transition-all px-8 group"
                data-testid="button-vibe-story"
              >
                NAŠE STORY
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/crew">
              <Button 
                variant="outline"
                size="lg"
                className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black transition-all px-8 group"
                data-testid="button-vibe-crew"
              >
                POZNEJ CREW
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
