import { useState, useEffect, useCallback } from "react";
import { zlePhotos } from "@/data/zlePhotos";

const initialPhotos = [
  { id: 1, src: zlePhotos.hero[0], alt: "ZLE crew action" },
  { id: 2, src: zlePhotos.hero[1], alt: "Street skating" },
  { id: 3, src: zlePhotos.hero[2], alt: "ZLE event" },
  { id: 4, src: zlePhotos.hero[3], alt: "Crew session" },
  { id: 5, src: zlePhotos.hero[4], alt: "Street life" },
  { id: 6, src: zlePhotos.hero[5], alt: "Urban scene" },
];

export function PhotoGrid() {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [fadingIndex, setFadingIndex] = useState<number | null>(null);
  const [photoPoolIndex, setPhotoPoolIndex] = useState(6);

  const rotatePhoto = useCallback(() => {
    const indexToReplace = Math.floor(Math.random() * 6);
    const nextPhotoSrc = zlePhotos.hero[photoPoolIndex % zlePhotos.hero.length];
    
    setFadingIndex(indexToReplace);
    
    setTimeout(() => {
      setPhotos(prev => prev.map((photo, i) => 
        i === indexToReplace 
          ? { ...photo, src: nextPhotoSrc }
          : photo
      ));
      setFadingIndex(null);
    }, 500);
    
    setPhotoPoolIndex(prev => prev + 1);
  }, [photoPoolIndex]);

  useEffect(() => {
    const interval = setInterval(rotatePhoto, 5000);
    return () => clearInterval(interval);
  }, [rotatePhoto]);

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
              fadingIndex === index ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
            } ${
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
