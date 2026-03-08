import * as React from "react";
import { SafeImage } from "./SafeImage";
import { getTodaysLogoVariants } from "@/lib/imageLoader";

type ZleLogoProps = {
  variant?: "header" | "hero" | "footer";
  className?: string;
  alt?: string;
  priority?: boolean;
};

const VARIANT_CLASS: Record<NonNullable<ZleLogoProps["variant"]>, string> = {
  header: "zle-header-logo",
  hero: "zle-hero-logo",
  footer: "zle-footer-logo",
};

export function ZleLogo({
  variant = "header",
  className = "",
  alt = "ZLE",
  priority = false,
}: ZleLogoProps) {
  const logo = React.useMemo(() => getTodaysLogoVariants(), []);

  const src =
    (logo as any).src ??
    (logo as any).jpg ??
    "/zle/logo/daily/01.png";

  const webpSrc = (logo as any).webpSrc ?? (logo as any).webp;
  const avifSrc = (logo as any).avifSrc ?? (logo as any).avif;

  return (
    <SafeImage
      src={src}
      alt={alt}
      className={`${VARIANT_CLASS[variant]} ${className}`.trim()}
      priority={priority}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      webpSrc={webpSrc}
      avifSrc={avifSrc}
      preferModernFormats={false}
    />
  );
}
