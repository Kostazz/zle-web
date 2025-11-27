import { useEffect, useState } from "react";
import bgCollage from "@assets/generated_images/background_collage_texture.png";

export function BackgroundCollage() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat grayscale"
        style={{
          backgroundImage: `url(${bgCollage})`,
          transform: `translateY(${scrollY * 0.3}px)`,
          opacity: 0.12,
          filter: "grayscale(100%) contrast(1.1)",
        }}
      />
      <div 
        className="absolute inset-0 bg-black opacity-90"
        aria-hidden="true"
      />
    </div>
  );
}
