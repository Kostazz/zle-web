export const allLogos = [
  "/zle/logo/36656331-57eb-4f01-951a-5a5abf884a6c.jpg",
  "/zle/logo/39840c8a-5ec0-48e5-b9c6-add35e0505f2.jpg",
  "/zle/logo/561b220f-9ef4-4973-83ad-7f6d5ee95497.jpg",
  "/zle/logo/5ff6f168-038f-4555-ad33-c2eb736647d7.jpg",
  "/zle/logo/9be474db-99b7-4fd6-9954-c54a20e8ec9d.jpg",
  "/zle/logo/b707c12b-e8cb-48b1-a09f-32a1c4ee0a20.jpg",
  "/zle/logo/d5ac29ea-b59a-46ed-bf51-5f941ead50d0.jpg",
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
  
  if (logos.length === 0) {
    return "/zle/logo/36656331-57eb-4f01-951a-5a5abf884a6c.jpg";
  }
  
  const today = new Date();
  const dayIndex = today.getDate() % logos.length;
  return logos[dayIndex];
}

export function getDailyShuffledPhotos(photos: string[]): string[] {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
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
