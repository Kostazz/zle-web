import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { getProductImageCandidates } from "@/lib/product-ui";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  getRouteMetaWithProduct,
} from "@/components/seo/seoConfig";

const baseUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || "https://zleshop.cz").replace(/\/+$/, "");

function toAbsoluteUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${normalizedPath}`;
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
  const { data: products } = useProducts();

  useEffect(() => {
    const productId = location.match(/^\/p\/([^/]+)$/)?.[1];
    const currentProduct = productId ? products?.find((item) => item.id === productId) : undefined;
    const currentProductImage = currentProduct ? getProductImageCandidates(currentProduct)[0] : undefined;
    const route = getRouteMetaWithProduct(
      location,
      currentProduct
        ? [{ ...currentProduct, image: currentProductImage ?? currentProduct.image }]
        : products,
    );
    const title = route?.title || DEFAULT_TITLE;
    const description = route?.description || DEFAULT_DESCRIPTION;
    const image = toAbsoluteUrl(route?.ogImage || DEFAULT_OG_IMAGE);
    const twitterSite = import.meta.env.VITE_TWITTER_SITE?.trim();

    upsertMetaByProperty("og:title", title);
    upsertMetaByProperty("og:description", description);
    upsertMetaByProperty("og:image", image);
    upsertMetaByProperty("og:type", "website");
    upsertMetaByProperty("og:locale", "cs_CZ");
    upsertMetaByProperty("og:image:width", "1408");
    upsertMetaByProperty("og:image:height", "768");

    upsertMetaByName("twitter:card", "summary_large_image");
    upsertMetaByName("twitter:title", title);
    upsertMetaByName("twitter:description", description);
    upsertMetaByName("twitter:image", image);

    const twitterSiteTag = document.querySelector<HTMLMetaElement>('meta[name="twitter:site"]');
    if (twitterSite) {
      upsertMetaByName("twitter:site", twitterSite);
    } else if (twitterSiteTag) {
      twitterSiteTag.remove();
    }
  }, [location, products]);

  return null;
}
