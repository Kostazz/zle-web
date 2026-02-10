import { useEffect } from "react";

const googleSiteVerification = import.meta.env.VITE_GOOGLE_SITE_VERIFICATION?.trim();
const bingSiteVerification = import.meta.env.VITE_BING_SITE_VERIFICATION?.trim();

function setVerification(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name=\"${name}\"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

export function WebmasterVerification() {
  useEffect(() => {
    if (googleSiteVerification) {
      setVerification("google-site-verification", googleSiteVerification);
    }

    if (bingSiteVerification) {
      setVerification("msvalidate.01", bingSiteVerification);
    }
  }, []);

  return null;
}
