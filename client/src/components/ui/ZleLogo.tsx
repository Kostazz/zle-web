import { cn } from "@/lib/utils";
import { useTodaysLogo } from "@/lib/logoContext";

interface ZleLogoProps {
  className?: string;
  alt?: string;
  "data-testid"?: string;
}

export function ZleLogo({ 
  className = "", 
  alt = "ZLE – Live Style Culture Brand",
  "data-testid": testId = "img-zle-logo"
}: ZleLogoProps) {
  const src = useTodaysLogo();
  
  if (!src) return null;
  
  return (
    <img
      src={src}
      alt={alt}
      className={cn(
        "h-8 md:h-10 lg:h-12 w-auto zle-logo-polish",
        className
      )}
      data-testid={testId}
    />
  );
}
