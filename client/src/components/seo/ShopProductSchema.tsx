import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { getOwnedDeclaredProductImages, getProductImageCandidates } from "@/lib/product-ui";
import { buildProductJsonLd, toAbsoluteUrl } from "@shared/productSeo";

const SHOP_SCHEMA_ID = "zle-shop-itemlist-schema";
const PRODUCT_SCHEMA_ID = "zle-product-schema";
const SSR_PRODUCT_SCHEMA_ID = "zle-product-schema-ssr";
const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

function toAbsoluteImageUrl(path: string) {
  return toAbsoluteUrl(path, baseUrl);
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

type ProductSchemaIdentity = {
  url?: string;
};

function readProductSchemaIdentity(script: HTMLScriptElement | null): ProductSchemaIdentity | null {
  if (!script?.textContent) return null;

  try {
    return JSON.parse(script.textContent) as ProductSchemaIdentity;
  } catch {
    return null;
  }
}

export function ShopProductSchema() {
  const [location] = useLocation();
  const { data: products, isFetched } = useProducts();
  const priceValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  useEffect(() => {
    const productId = location.match(/^\/p\/([^/]+)$/)?.[1];
    const currentProduct = productId ? products?.find((item) => item.id === productId) : undefined;

    // Single schema identity for product detail (SSR-first, SPA fallback).
    removeJsonLd(PRODUCT_SCHEMA_ID);

    if (currentProduct) {
      const declaredImages = getOwnedDeclaredProductImages(currentProduct);
      const image = declaredImages[0] || currentProduct.image || "/images/brand/hero.png";
      const ssrScript = document.getElementById(SSR_PRODUCT_SCHEMA_ID) as HTMLScriptElement | null;
      const expectedUrl = `${baseUrl}/p/${encodeURIComponent(currentProduct.id)}`;
      const identity = readProductSchemaIdentity(ssrScript);

      if (!ssrScript || identity?.url !== expectedUrl) {
        upsertJsonLd(SSR_PRODUCT_SCHEMA_ID, buildProductJsonLd(currentProduct, {
          siteUrl: baseUrl,
          imageUrl: image,
        }));
      }
    } else if (!productId) {
      removeJsonLd(SSR_PRODUCT_SCHEMA_ID);
    } else if (isFetched) {
      removeJsonLd(SSR_PRODUCT_SCHEMA_ID);
    }

    if (location !== "/shop") {
      removeJsonLd(SHOP_SCHEMA_ID);
      return;
    }

    if (!products || products.length === 0) {
      removeJsonLd(SHOP_SCHEMA_ID);
      return;
    }

    const itemListElement = products.map((product, index) => {
      const productUrl = `${baseUrl}/p/${product.id}`;
      const uniqueImages = Array.from(
        new Set(getProductImageCandidates(product).map((image) => toAbsoluteImageUrl(image))),
      );

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
            availability: product.isActive && product.stock > 0
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
  }, [location, products, isFetched]);

  return null;
}
