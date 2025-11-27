import { useState, useEffect, useCallback } from "react";
import { zlePhotos } from "@/data/zlePhotos";

export function CrewRotator() {
  const [currentPhotos, setCurrentPhotos] = useState([
    zlePhotos.crew[0],
    zlePhotos.crew[1],
    zlePhotos.crew[2],
  ]);
  const [fadingIndex, setFadingIndex] = useState<number | null>(null);
  const [photoPoolIndex, setPhotoPoolIndex] = useState(3);

  const rotatePhoto = useCallback(() => {
    const indexToReplace = Math.floor(Math.random() * 3);
    const nextPhotoSrc = zlePhotos.crew[photoPoolIndex % zlePhotos.crew.length];
    
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
    const interval = setInterval(rotatePhoto, 6000);
    return () => clearInterval(interval);
  }, [rotatePhoto]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
      {currentPhotos.map((photo, index) => (
        <div
          key={index}
          className="relative aspect-square overflow-hidden zle-photo-frame"
          data-testid={`crew-rotator-${index + 1}`}
        >
          <img
            src={photo}
            alt={`ZLE crew member ${index + 1}`}
            className={`w-full h-full object-cover zle-bw-photo transition-all duration-600 ${
              fadingIndex === index 
                ? "opacity-0 translate-y-2" 
                : "opacity-100 translate-y-0"
            }`}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      ))}
    </div>
  );
}
