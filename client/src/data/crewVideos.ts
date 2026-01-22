export interface CrewVideo {
  id: string;
  title: string;
  description?: string;
  date?: string;
  durationSec?: number;
  visibility: "shop" | "public";
  sourceType: "file" | "youtube";
  src: string;
  thumb?: string;
  tags?: string[];
}

export const crewVideos: CrewVideo[] = [
  {
    id: "premiere-zabr-2024",
    title: "ZABR x PRAHA STREETS",
    description: "Exkluzivní premiere. Raw footage z letního tripu.",
    date: "2024-12-01",
    durationSec: 420,
    visibility: "shop",
    sourceType: "file",
    src: "",
  thumb: "/crew-videos/_fallback.svg",
    tags: ["premiere", "street", "praha"],
  },
  {
    id: "quick-clip-kosta",
    title: "KOSTA QUICK CLIP",
    description: "30 sekund raw skate.",
    date: "2024-11-15",
    durationSec: 32,
    visibility: "public",
    sourceType: "file",
    src: "",
  thumb: "/crew-videos/_fallback.svg",
    tags: ["quick", "clip"],
  },
  {
    id: "yt-zle-intro",
    title: "ZLE CREW INTRO",
    description: "Kdo jsme a co děláme. Underground forever.",
    date: "2024-10-20",
    durationSec: 195,
    visibility: "public",
    sourceType: "youtube",
    src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    tags: ["intro", "crew"],
  },
  {
    id: "yt-premiere-winter",
    title: "WINTER SESSION 2024",
    description: "Shop-first premiere. Zimní session s celou crew.",
    date: "2024-11-28",
    durationSec: 540,
    visibility: "shop",
    sourceType: "youtube",
    src: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    thumb: "/crew-videos/winter-session-thumb.jpg",
    tags: ["premiere", "winter", "full"],
  },
];

export function formatDuration(sec?: number): string {
  if (!sec) return "";
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}:${s.toString().padStart(2, "0")}`;
}

export function isShortVideo(durationSec?: number): boolean {
  return durationSec !== undefined && durationSec < 180;
}

export function isLongVideo(durationSec?: number): boolean {
  return durationSec !== undefined && durationSec >= 180;
}
