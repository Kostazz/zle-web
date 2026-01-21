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

/**
 * 🔒 JEDINÝ ZDROJ PRAVDY PRO LOGO
 * – bere se výhradně z /images/logo/daily
 * – výběr je deterministický (Praha)
 * – header / hero / footer = VŽDY STEJNÉ LOGO
 * – variant řeší POUZE velikost (CSS)
 */
export function ZleLogo({
  variant = "header",
  className = "",
  alt = "ZLE",
}: ZleLogoProps) {
  const logo = React.useMemo(() => getTodaysLogoVariants(), []);
  const priority = variant === "hero";

  return (
    <SafeImage
      src={logo.fallbackSrc}
      avifSrc={logo.avifSrc}
      webpSrc={logo.webpSrc}
      alt={alt}
      className={`${VARIANT_CLASS[variant]} ${className}`.trim()}
      priority={priority}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
