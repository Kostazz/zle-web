import { SafeImage } from "@/components/SafeImage";
import { useTodaysLogo } from "@/lib/logoContext";

type ZleLogoVariant = "header" | "heroInline";

interface ZleLogoProps {
  className?: string;
  variant?: ZleLogoVariant;
}

export default function ZleLogo({ className = "", variant = "header" }: ZleLogoProps) {
  const logoSrc = useTodaysLogo();

  // fallback musí fungovat všude (lokál/Codespaces/produkce)
  const fallbackSrc = "/zle/logo/daily/01.jpg";

  const base =
    variant === "header"
      ? "zle-logo-safe h-8 md:h-10 w-auto"
      : "hero-logo-inline zle-logo-safe";

  return (
    <SafeImage
      src={logoSrc || fallbackSrc}
      alt="ZLE – Live Style Culture Brand"
      className={`${base} ${className}`.trim()}
      loading={variant === "header" ? "lazy" : "eager"}
      fallbackSrc={fallbackSrc}
    />
  );
}
