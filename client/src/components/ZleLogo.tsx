import { useState } from "react";
import { getTodaysLogo } from "@/lib/imageLoader";

interface ZleLogoProps {
  className?: string;
}

export default function ZleLogo({ className = "" }: ZleLogoProps) {
  const [src, setSrc] = useState<string>(() => getTodaysLogo());

  const fallbackSrc = `${import.meta.env.BASE_URL}images/logo/daily/01.jpg`;

  return (
    <img
      src={src}
      alt="ZLE – Live Style Culture Brand"
      loading="lazy"
      data-testid="img-zle-logo"
      className={`zle-logo h-8 md:h-10 w-auto object-contain ${className}`.trim()}
      onError={() => {
        if (src !== fallbackSrc) {
          setSrc(fallbackSrc);
        }
      }}
    />
  );
}
