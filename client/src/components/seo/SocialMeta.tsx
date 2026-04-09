import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  getRouteMetaWithProduct,
} from "@/components/seo/seoConfig";
import {
  buildProductMetaDescription,
  buildProductMetaTitle,
  toAbsoluteUrl as toAbsoluteSeoUrl,
} from "@shared/productSeo";

const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

function toAbsoluteUrl(pathOrUrl: string) {
  return toAbsoluteSeoUrl(pathOrUrl, baseUrl);
}

function upsertMetaByName(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name=\"${name}\"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[property=\"${property}\"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

export function SocialMeta() {
  const [location] = useLocation();
  const { data: products, isSuccess } = useProducts();

  useEffect(() => {
    const encodedProductId = location.match(/^\/p\/([^/]+)$/)?.[1];
    const productId = (() => {
      if (!encodedProductId) return null;
      try {
        return decodeURIComponent(encodedProductId);
      } catch {
        return encodedProductId;
      }
    })();
    const isProductRoute = Boolean(productId);
    const currentProduct = productId ? products?.find((item) => item.id === productId) : undefined;
    const shouldUseProductOgType = isProductRoute && (Boolean(currentProduct) || !isSuccess);
    const route = getRouteMetaWithProduct(location, products);
    const title = isProductRoute
      ? currentProduct
        ? buildProductMetaTitle(currentProduct)
        : ""
      : route?.title || DEFAULT_TITLE;
    const description = isProductRoute
      ? currentProduct
        ? buildProductMetaDescription(currentProduct)
        : ""
      : route?.description || DEFAULT_DESCRIPTION;
    const ogDescription = isProductRoute ? description : route?.ogDescription || description;
    const image = toAbsoluteUrl(route?.ogImage || DEFAULT_OG_IMAGE);
    const twitterSite = import.meta.env.VITE_TWITTER_SITE?.trim();

    if (title && ogDescription) {
      upsertMetaByProperty("og:title", title);
      upsertMetaByProperty("og:description", ogDescription);
      upsertMetaByName("twitter:title", title);
      upsertMetaByName("twitter:description", ogDescription);
    }
    upsertMetaByProperty("og:image", image);
    upsertMetaByProperty("og:type", shouldUseProductOgType ? "product" : "website");
    upsertMetaByProperty("og:locale", "cs_CZ");
    upsertMetaByProperty("og:image:width", "1408");
    upsertMetaByProperty("og:image:height", "768");

    upsertMetaByName("twitter:card", "summary_large_image");
    upsertMetaByName("twitter:image", image);

    const twitterSiteTag = document.querySelector<HTMLMetaElement>('meta[name="twitter:site"]');
    if (twitterSite) {
      upsertMetaByName("twitter:site", twitterSite);
    } else if (twitterSiteTag) {
      twitterSiteTag.remove();
    }
  }, [location, products, isSuccess]);

  return null;
}
