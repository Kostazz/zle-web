import { useEffect } from "react";
import { useLocation } from "wouter";
import { getDailyLogoPath } from "@/lib/imageLoader";

const HERO_LOGO_PRELOAD_SELECTOR = 'link[data-zle="home-hero-logo-preload"]';

export function HomeHeroLogoPreload() {
  const [location] = useLocation();

  useEffect(() => {
    const existing = document.head.querySelector<HTMLLinkElement>(HERO_LOGO_PRELOAD_SELECTOR);

    if (location !== "/") {
      existing?.remove();
      return;
    }

    const preload = existing ?? document.createElement("link");
    preload.setAttribute("data-zle", "home-hero-logo-preload");
    preload.setAttribute("rel", "preload");
    preload.setAttribute("as", "image");
    preload.setAttribute("href", getDailyLogoPath());

    if (!existing) {
      document.head.appendChild(preload);
    }
  }, [location]);

  return null;
}
