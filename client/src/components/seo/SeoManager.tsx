import { useEffect } from "react";
import { useLocation } from "wouter";

const DEFAULT_TITLE = "ZLE — Live Raw, Ride Hard";
const DEFAULT_DESCRIPTION =
  "ZLE — underground skate/street crew. Live raw, ride hard. No filters, no bullshit.";

const ROUTE_META: Array<{
  match: RegExp;
  title: string;
  description: string;
  noindex?: boolean;
}> = [
  {
    match: /^\/$/,
    title: "ZLE — Live Raw, Ride Hard",
    description:
      "Oficiální web ZLE crew. Streetwear, spoty, stories a merch přímo z underground scény.",
  },
  {
    match: /^\/shop$/,
    title: "Shop | ZLE",
    description:
      "Kup originální ZLE merch. Trička, hoodies a limitované dropy navržené pro street a skate komunitu.",
  },
  {
    match: /^\/story$/,
    title: "Story | ZLE",
    description:
      "Jak vznikl ZLE. Naše filozofie, crew mindset a cesta od lokálních spotů po vlastní značku.",
  },
  {
    match: /^\/crew$/,
    title: "Crew | ZLE",
    description:
      "Poznej ZLE crew, videa a momenty ze scény. Real life, raw energy, žádný fake.",
  },
  {
    match: /^\/contact$/,
    title: "Kontakt | ZLE",
    description:
      "Kontaktuj ZLE kvůli spolupráci, médiím nebo dotazům k objednávkám.",
  },
  {
    match: /^\/legal/,
    title: "Právní informace | ZLE",
    description: "Právní dokumenty ZLE: obchodní podmínky, GDPR, cookies a kontaktní informace.",
  },
  {
    match: /^\/(admin|ops|account|checkout|success|cancel)/,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    noindex: true,
  },
];

function setMeta(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name=\"${name}\"]`);
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
    const route = ROUTE_META.find((entry) => entry.match.test(location));
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
