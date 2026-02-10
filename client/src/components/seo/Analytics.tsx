import { useEffect } from "react";
import { useLocation } from "wouter";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();

function ensureGaTag(measurementId: string) {
  if (document.getElementById("ga-gtag")) return;

  const externalScript = document.createElement("script");
  externalScript.id = "ga-gtag";
  externalScript.async = true;
  externalScript.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(externalScript);

  const inlineScript = document.createElement("script");
  inlineScript.id = "ga-inline";
  inlineScript.text = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', '${measurementId}', { send_page_view: false });
  `;
  document.head.appendChild(inlineScript);
}

export function Analytics() {
  const [location] = useLocation();

  useEffect(() => {
    if (!GA_ID) return;
    ensureGaTag(GA_ID);
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
