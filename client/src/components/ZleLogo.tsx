import { useState, useEffect } from "react";
import { getTodaysLogo } from "@/lib/imageLoader";

interface ZleLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function ZleLogo({ className = "", size = "md" }: ZleLogoProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);

  useEffect(() => {
    const logo = getTodaysLogo();
    setLogoSrc(logo);
  }, []);

  if (!logoSrc) {
    return null;
  }

  const sizeClasses = {
    sm: "h-8 md:h-10",
    md: "h-12 md:h-16",
    lg: "h-16 md:h-24",
    xl: "h-24 md:h-32",
  };

  return (
    <img
      src={logoSrc}
      alt="ZLE logo"
      className={`zle-logo-polish ${sizeClasses[size]} ${className}`}
      data-testid="img-zle-logo"
    />
  );
}

export function ZleLogoStatic({ src, className = "", size = "md" }: { src: string; className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizeClasses = {
    sm: "h-8 md:h-10",
    md: "h-12 md:h-16",
    lg: "h-16 md:h-24",
    xl: "h-24 md:h-32",
  };

  return (
    <img
      src={src}
      alt="ZLE logo"
      className={`zle-logo-polish ${sizeClasses[size]} ${className}`}
      data-testid="img-zle-logo-static"
    />
  );
}
