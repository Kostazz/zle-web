import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { getCanonicalPath } from "@/components/seo/seoConfig";

/**
 * ZLE SEO: Canonical + OG URL
 * - Always absolute
 * - Keeps canonical in sync with SPA routing
 */
export function Canonical() {
  const [location] = useLocation();
  const { data: products } = useProducts();

  useEffect(() => {
    const base = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");
    const path = getCanonicalPath(window.location?.pathname || location || "/", products);
    const canonicalUrl = `${base}${path}`;

    // <link rel="canonical" />
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", canonicalUrl);

    // <meta property="og:url" />
    let og = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!og) {
      og = document.createElement("meta");
      og.setAttribute("property", "og:url");
      document.head.appendChild(og);
    }
    og.setAttribute("content", canonicalUrl);
  }, [location, products]);

  return null;
}
