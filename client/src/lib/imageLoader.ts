import { getPragueDayOfMonth, getPragueDateSeed } from "./pragueDate";

// ✅ Daily logo set (nová stabilní struktura)
export const allLogos = [
  "/zle/logo/daily/01.jpg",
  "/zle/logo/daily/02.jpg",
  "/zle/logo/daily/03.jpg",
  "/zle/logo/daily/04.jpg",
  "/zle/logo/daily/05.jpg",
  "/zle/logo/daily/06.jpg",
  "/zle/logo/daily/07.jpg",
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

  // ✅ Fallback musí existovat vždy
  if (logos.length === 0) {
    return "/zle/logo/daily/01.jpg";
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
