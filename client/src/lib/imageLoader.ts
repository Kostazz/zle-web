import { getPragueDayOfMonth, getPragueDateSeed } from "./pragueDate";

// ✅ Jediný oficiální root pro logo assets:
// client/public/zle/logo/daily/*.jpg  ->  /zle/logo/daily/*.jpg
// (Neřešíme BASE_URL – v Codespaces i lokálně to funguje spolehlivě.)
const LOGO_ROOT = "/zle/logo/daily";

// ✅ Daily logo set (stabilní struktura v client/public/zle/logo/daily)
export const allLogos = [
  `${LOGO_ROOT}/01.jpg`,
  `${LOGO_ROOT}/02.jpg`,
  `${LOGO_ROOT}/03.jpg`,
  `${LOGO_ROOT}/04.jpg`,
  `${LOGO_ROOT}/05.jpg`,
  `${LOGO_ROOT}/06.jpg`,
  `${LOGO_ROOT}/07.jpg`,
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
    return `${LOGO_ROOT}/01.jpg`;
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
