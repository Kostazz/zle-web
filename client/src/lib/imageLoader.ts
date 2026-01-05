import { getPragueDayOfMonth, getPragueDateSeed } from "./pragueDate";

// Base-safe prefix (funguje lokálně, v Codespaces i při nasazení pod subpath)
const BASE = import.meta.env.BASE_URL;

// ✅ Daily logo set (stabilní struktura v client/public/images/logo/daily)
export const allLogos = [
  `${BASE}images/logo/daily/01.jpg`,
  `${BASE}images/logo/daily/02.jpg`,
  `${BASE}images/logo/daily/03.jpg`,
  `${BASE}images/logo/daily/04.jpg`,
  `${BASE}images/logo/daily/05.jpg`,
  `${BASE}images/logo/daily/06.jpg`,
  `${BASE}images/logo/daily/07.jpg`,
];

export function getAllLogos(): string[] {
  return allLogos;
}

export function shuffleWithSeed(array: string[], seed: number): string[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const x = Math.sin(seed + i) * 10000;
    const j = Math.floor((x - Math.floor(x)) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getTodaysLogo(): string {
  const logos = getAllLogos();

  // ✅ Fallback musí existovat vždy (aspoň 01.jpg)
  if (!logos || logos.length === 0) {
    return `${BASE}images/logo/daily/01.jpg`;
  }

  // ✅ Deterministická denní rotace (Praha)
  const dayIndex = getPragueDayOfMonth() % logos.length;
  return logos[dayIndex];
}

export function getDailyShuffledPhotos(photos: string[]): string[] {
  const seed = getPragueDateSeed();
  return shuffleWithSeed(photos, seed);
}

export function getPhotosWithoutDuplicates(
  usedPhotos: Set<string>,
  sources: string[][],
  count: number
): string[] {
  const allPhotos = sources.flat();
  const available = allPhotos.filter((photo) => !usedPhotos.has(photo));
  const selected = available.slice(0, count);
  selected.forEach((photo) => usedPhotos.add(photo));
  return selected;
}
