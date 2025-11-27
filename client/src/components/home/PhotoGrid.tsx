import { useState } from "react";

import urbanImg from "@assets/generated_images/urban_skate_scene_grain.png";
import streetImg from "@assets/generated_images/street_corner_urban.png";
import crewImg from "@assets/generated_images/crew_silhouettes_grain.png";
import skateImg from "@assets/generated_images/skateboard_detail_grain.png";
import sneakersImg from "@assets/generated_images/sneakers_skateboard_detail.png";
import collageImg from "@assets/generated_images/background_collage_texture.png";

const photos = [
  { id: 1, src: urbanImg, alt: "Urban skate scene" },
  { id: 2, src: streetImg, alt: "Street corner" },
  { id: 3, src: crewImg, alt: "Crew silhouettes" },
  { id: 4, src: skateImg, alt: "Skateboard detail" },
  { id: 5, src: sneakersImg, alt: "Sneakers and board" },
  { id: 6, src: collageImg, alt: "Street collage" },
];

export function PhotoGrid() {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 max-w-5xl mx-auto">
      {photos.map((photo, index) => (
        <div
          key={photo.id}
          className="relative aspect-[4/3] overflow-hidden bg-white/5 opacity-0 animate-fade-in"
          style={{ animationDelay: `${0.7 + index * 0.1}s` }}
          onMouseEnter={() => setHoveredId(photo.id)}
          onMouseLeave={() => setHoveredId(null)}
          data-testid={`image-grid-${photo.id}`}
        >
          <img
            src={photo.src}
            alt={photo.alt}
            className={`w-full h-full object-cover grayscale transition-all duration-500 ${
              hoveredId === photo.id
                ? "scale-105 brightness-110"
                : "scale-100 brightness-100"
            }`}
            style={{
              filter: `grayscale(100%) contrast(1.1) ${
                hoveredId === photo.id ? "brightness(1.1)" : "brightness(1)"
              }`,
            }}
            loading="lazy"
          />
          <div 
            className={`absolute inset-0 bg-black/20 transition-opacity duration-300 ${
              hoveredId === photo.id ? "opacity-0" : "opacity-100"
            }`}
          />
          <div 
            className={`absolute inset-0 shadow-inner transition-all duration-300 ${
              hoveredId === photo.id
                ? "shadow-[inset_0_0_30px_rgba(255,255,255,0.1)]"
                : "shadow-none"
            }`}
          />
        </div>
      ))}
    </div>
  );
}
