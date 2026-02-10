import { useEffect } from "react";
import { useLocation } from "wouter";
import { getRouteMeta } from "@/components/seo/seoConfig";

const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

function toAbsoluteUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function upsertJsonLd(id: string, payload: unknown) {
  let script = document.getElementById(id) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.text = JSON.stringify(payload);
}

function removeJsonLd(id: string) {
  const script = document.getElementById(id);
  if (script) script.remove();
}

export function StructuredData() {
  const [location] = useLocation();

  useEffect(() => {
    const route = getRouteMeta(location);

    upsertJsonLd("zle-org-schema", {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ZLE",
      url: baseUrl,
      logo: `${baseUrl}/favicon.png`,
      sameAs: [],
    });

    if (location === "/") {
      upsertJsonLd("zle-website-schema", {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "ZLE",
        url: `${baseUrl}/`,
        inLanguage: "cs-CZ",
      });
    } else {
      removeJsonLd("zle-website-schema");
    }

    if (route?.breadcrumb && !route.noindex) {
      upsertJsonLd("zle-breadcrumb-schema", {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: route.breadcrumb.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.label,
          item: toAbsoluteUrl(item.path),
        })),
      });
    } else {
      removeJsonLd("zle-breadcrumb-schema");
    }
  }, [location]);

  return null;
}
