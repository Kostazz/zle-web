import { useEffect } from "react";
import { useLocation } from "wouter";

const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

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

export function StructuredData() {
  const [location] = useLocation();

  useEffect(() => {
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
      return;
    }

    const website = document.getElementById("zle-website-schema");
    if (website) website.remove();
  }, [location]);

  return null;
}
