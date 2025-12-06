import { useTodaysLogo } from "@/lib/logoContext";

interface ZleLogoProps {
  className?: string;
}

export default function ZleLogo({ className = "" }: ZleLogoProps) {
  const logoSrc = useTodaysLogo();

  if (!logoSrc) return null;

  return (
    <div className="relative flex items-center">
      <img
        src={logoSrc}
        alt="ZLE – Live Style Culture Brand"
        className={`zle-logo-safe zle-logo-polish max-h-10 md:max-h-14 w-auto object-contain object-center ${className}`.trim()}
        loading="lazy"
        data-testid="img-zle-logo"
      />
    </div>
  );
}
