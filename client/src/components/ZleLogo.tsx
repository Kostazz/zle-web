import * as React from "react";
import { SafeImage } from "./SafeImage";
import { getTodaysLogoVariants } from "@/lib/imageLoader";

type ZleLogoProps = {
  variant?: "header" | "hero" | "footer";
  className?: string;
  alt?: string;
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
}: ZleLogoProps) {
  const logo = React.useMemo(() => getTodaysLogoVariants(), []);
  const priority = variant === "hero";

  // kompatibilní napříč staršími i novými variantami
  const src =
    (logo as any).src ??
    (logo as any).jpg ??
    "/images/logo/daily/01.jpg";

  return (
    <SafeImage
      src={src}
      alt={alt}
      className={`${VARIANT_CLASS[variant]} ${className}`.trim()}
      priority={priority}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      preferModernFormats
    />
  );
}
