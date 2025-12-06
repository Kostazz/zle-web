import { useTodaysLogo } from "@/lib/logoContext";

interface ZleLogoProps {
  className?: string;
}

export default function ZleLogo({ className = "" }: ZleLogoProps) {
  const logoSrc = useTodaysLogo();

  if (!logoSrc) return null;

  return (
    <img
      src={logoSrc}
      alt="ZLE – Live Style Culture Brand"
      className={`zle-logo-polish h-8 md:h-10 w-auto object-contain ${className}`.trim()}
      loading="lazy"
      data-testid="img-zle-logo"
    />
  );
}
