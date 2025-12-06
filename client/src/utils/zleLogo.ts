import { allLogos, getTodaysLogo } from "@/lib/imageLoader";

export const ZLE_LOGOS = allLogos;

export function getDailyZleLogo(): string {
  return getTodaysLogo();
}

export function getRandomZleLogo(): string {
  if (ZLE_LOGOS.length === 0) {
    return "/zle-logo/pro/zle-logo-raw.png";
  }
  const randomIndex = Math.floor(Math.random() * ZLE_LOGOS.length);
  return ZLE_LOGOS[randomIndex];
}
