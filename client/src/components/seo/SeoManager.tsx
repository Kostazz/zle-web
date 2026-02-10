import { useEffect } from "react";
import { useLocation } from "wouter";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, getRouteMeta } from "@/components/seo/seoConfig";

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

  useEffect(() => {
    const route = getRouteMeta(location);
    const title = route?.title || DEFAULT_TITLE;
    const description = route?.description || DEFAULT_DESCRIPTION;

    document.title = title;
    setMeta("description", description);

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
  }, [location]);

  return null;
}
