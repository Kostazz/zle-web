import { useState } from "react";

const photos = [
  { id: 1, src: "/zle-photos/hero/482962260_672715478670567_9138744049105169252_n.jpg", alt: "ZLE crew action" },
  { id: 2, src: "/zle-photos/hero/490969493_9465249883567716_45085364111691781_n.jpg", alt: "Street skating" },
  { id: 3, src: "/zle-photos/hero/566224854_841810661761047_3308462119001091558_n.jpg", alt: "ZLE event" },
  { id: 4, src: "/zle-photos/events/465887700_562845979664892_2375756772027174848_n.jpg", alt: "Crew session" },
  { id: 5, src: "/zle-photos/events/466398027_562848076331349_5013157104235974205_n.jpg", alt: "Street life" },
  { id: 6, src: "/zle-photos/events/472313581_597125122903644_2724985617026038877_n.jpg", alt: "Urban scene" },
];

export function PhotoGrid() {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 max-w-5xl mx-auto">
      {photos.map((photo, index) => (
        <div
          key={photo.id}
          className="relative aspect-[4/3] overflow-hidden opacity-0 animate-fade-in border border-white/10 rounded-sm"
          style={{ 
            animationDelay: `${0.7 + index * 0.1}s`,
            boxShadow: hoveredId === photo.id 
              ? "0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.1)" 
              : "0 4px 16px rgba(0,0,0,0.4)"
          }}
          onMouseEnter={() => setHoveredId(photo.id)}
          onMouseLeave={() => setHoveredId(null)}
          data-testid={`image-grid-${photo.id}`}
        >
          <img
            src={photo.src}
            alt={photo.alt}
            className={`w-full h-full object-cover transition-all duration-500 ${
              hoveredId === photo.id
                ? "scale-105 brightness-110"
                : "scale-100 brightness-100"
            }`}
            style={{
              filter: `grayscale(100%) contrast(1.1) ${
                hoveredId === photo.id ? "brightness(1.15)" : "brightness(1)"
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
            className={`absolute inset-0 transition-all duration-300 ${
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
