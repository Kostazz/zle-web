import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";

const SHOP_SCHEMA_ID = "zle-shop-itemlist-schema";
const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

function toAbsoluteImageUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
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

export function ShopProductSchema() {
  const [location] = useLocation();
  const { data: products } = useProducts();
  const priceValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  useEffect(() => {
    if (location !== "/shop") {
      removeJsonLd(SHOP_SCHEMA_ID);
      return;
    }

    if (!products || products.length === 0) {
      removeJsonLd(SHOP_SCHEMA_ID);
      return;
    }

    const itemListElement = products.map((product, index) => {
      const productUrl = `${baseUrl}/shop#product-${product.id}`;
      const allImages = [product.image, ...(product.images || [])].filter(Boolean);
      const uniqueImages = Array.from(new Set(allImages.map((image) => toAbsoluteImageUrl(image))));

      return {
        "@type": "ListItem",
        position: index + 1,
        url: productUrl,
        item: {
          "@type": "Product",
          name: product.name,
          description: product.description,
          image: uniqueImages,
          sku: product.id,
          brand: {
            "@type": "Brand",
            name: "ZLE",
          },
          category: product.category,
          additionalProperty: [
            {
              "@type": "PropertyValue",
              name: "sizes",
              value: product.sizes.join(","),
            },
          ],
          offers: {
            "@type": "Offer",
            priceCurrency: "CZK",
            price: String(product.price),
            priceValidUntil,
            seller: {
              "@type": "Organization",
              name: "ZLE",
            },
            priceSpecification: {
              "@type": "PriceSpecification",
              priceCurrency: "CZK",
              price: String(product.price),
            },
            url: productUrl,
            availability: product.stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            itemCondition: "https://schema.org/NewCondition",
          },
        },
      };
    });

    upsertJsonLd(SHOP_SCHEMA_ID, {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement,
    });
  }, [location, products]);

  return null;
}
