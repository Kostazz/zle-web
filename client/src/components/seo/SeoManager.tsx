import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, getRouteMetaWithProduct } from "@/components/seo/seoConfig";
import { buildProductMetaDescription, buildProductMetaTitle } from "@shared/productSeo";

function setMeta(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

export function SeoManager() {
  const [location] = useLocation();
  const { data: products } = useProducts();

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
    const currentProduct = productId ? products?.find((item) => item.id === productId) : undefined;
    const route = getRouteMetaWithProduct(location, products);
    const isProductRoute = Boolean(productId);

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

    if (title && description) {
      document.title = title;
      setMeta("description", description);
    }

    let robotsTag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (route?.noindex) {
      if (!robotsTag) {
        robotsTag = document.createElement("meta");
        robotsTag.setAttribute("name", "robots");
        document.head.appendChild(robotsTag);
      }
      robotsTag.setAttribute("content", "noindex, nofollow");
    } else if (robotsTag) {
      robotsTag.remove();
    }
  }, [location, products]);

  return null;
}
