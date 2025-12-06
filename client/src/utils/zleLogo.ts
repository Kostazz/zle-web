import { allLogos, getTodaysLogo } from "@/lib/imageLoader";

export const ZLE_LOGOS = allLogos;

export function getDailyZleLogo(): string {
  return getTodaysLogo();
}

export function getRandomZleLogo(): string {
  if (ZLE_LOGOS.length === 0) {
    return "/zle/logo/36656331-57eb-4f01-951a-5a5abf884a6c.jpg";
  }
  const randomIndex = Math.floor(Math.random() * ZLE_LOGOS.length);
  return ZLE_LOGOS[randomIndex];
}
