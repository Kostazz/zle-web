import { useEffect } from "react";
import { useLocation } from "wouter";
import { getCanonicalPath } from "@/components/seo/seoConfig";

/**
 * ZLE SEO: Canonical + OG URL
 * - Always absolute
 * - Canonical path is derived from the current route only
 */
export function Canonical() {
  const [location] = useLocation();

  useEffect(() => {
    const base = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");
    const path = getCanonicalPath(window.location?.pathname || location || "/");
    const canonicalUrl = `${base}${path}`;

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", canonicalUrl);

    let og = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!og) {
      og = document.createElement("meta");
      og.setAttribute("property", "og:url");
      document.head.appendChild(og);
    }
    og.setAttribute("content", canonicalUrl);
  }, [location]);

  return null;
}
