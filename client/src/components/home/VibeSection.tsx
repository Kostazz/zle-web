import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { zlePhotos } from "@/data/zlePhotos";

const vibeAlts = ["ZLE session", "Crew vibes", "Street life"];

export function VibeSection() {
  const [currentPhotos, setCurrentPhotos] = useState([
    zlePhotos.vibe[0],
    zlePhotos.vibe[1],
    zlePhotos.vibe[2],
  ]);
  const [fadingIndex, setFadingIndex] = useState<number | null>(null);
  const [photoPoolIndex, setPhotoPoolIndex] = useState(3);

  const rotatePhoto = useCallback(() => {
    const indexToReplace = Math.floor(Math.random() * 3);
    const nextPhotoSrc = zlePhotos.vibe[photoPoolIndex % zlePhotos.vibe.length];
    
    setFadingIndex(indexToReplace);
    
    setTimeout(() => {
      setCurrentPhotos(prev => prev.map((photo, i) => 
        i === indexToReplace ? nextPhotoSrc : photo
      ));
      setFadingIndex(null);
    }, 600);
    
    setPhotoPoolIndex(prev => prev + 1);
  }, [photoPoolIndex]);

  useEffect(() => {
    const interval = setInterval(rotatePhoto, 7000);
    return () => clearInterval(interval);
  }, [rotatePhoto]);

  return (
    <section className="py-20 md:py-32 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 md:mb-16">
            <h2 
              className="font-display text-3xl md:text-5xl text-white tracking-tight mb-6 zle-text-3d"
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
            {currentPhotos.map((photo, index) => (
              <div
                key={index}
                className="aspect-square overflow-hidden zle-photo-frame"
                data-testid={`image-vibe-${index + 1}`}
              >
                <img
                  src={photo}
                  alt={vibeAlts[index]}
                  className={`w-full h-full object-cover zle-bw-photo hover:scale-105 transition-all duration-600 ${
                    fadingIndex === index 
                      ? "opacity-0 translate-y-2" 
                      : "opacity-100 translate-y-0"
                  }`}
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
                className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black transition-all px-8 group zle-button-3d"
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
                className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black transition-all px-8 group zle-button-3d"
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
