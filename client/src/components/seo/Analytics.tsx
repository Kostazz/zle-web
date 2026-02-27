import { useEffect } from "react";
import { useLocation } from "wouter";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
const GA_SCRIPT_ID = "ga-gtag";

function ensureGaTag(measurementId: string): boolean {
  let injected = false;

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const externalScript = document.createElement("script");
    externalScript.id = GA_SCRIPT_ID;
    externalScript.async = true;
    externalScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(externalScript);
    injected = true;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || ((...args: unknown[]) => window.dataLayer.push(args));

  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

  return injected;
}

export function Analytics() {
  const [location] = useLocation();

  useEffect(() => {
    if (!GA_ID) return;

    const scriptInjectedByThisMount = ensureGaTag(GA_ID);

    return () => {
      if (!scriptInjectedByThisMount) return;
      document.getElementById(GA_SCRIPT_ID)?.remove();
    };
  }, []);

  useEffect(() => {
    if (!GA_ID || !window.gtag) return;

    window.gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: location,
      page_title: document.title,
    });
  }, [location]);

  return null;
}
