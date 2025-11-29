export const logoProImages = [
  "/zle-logo/pro/zle-logo-3d.png",
  "/zle-logo/pro/zle-logo-chrome.png",
  "/zle-logo/pro/zle-logo-clean.png",
  "/zle-logo/pro/zle-logo-raw.png",
  "/zle-logo/pro/zle-logo-invert.png",
  "/zle-logo/pro/zle-logo-neon.png",
];

export const logoVariants = [
  "/zle-logo/zle-classic-clean.png",
  "/zle-logo/zle-premium-soft3d.png",
  "/zle-logo/zle-street-matte.png",
  "/zle-logo/zle-original.png",
];

export function getLogoProImages(): string[] {
  return logoProImages;
}

export function getLogoVariants(): string[] {
  return logoVariants;
}

export function getAllLogos(): string[] {
  return [...logoProImages, ...logoVariants];
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
  const allLogos = getAllLogos();
  
  if (allLogos.length === 0) {
    return "/zle-logo/zle-premium-soft3d.png";
  }
  
  const today = new Date();
  const dayIndex = today.getDate() % allLogos.length;
  return allLogos[dayIndex];
}

export function getTodaysProLogo(): string {
  if (logoProImages.length === 0) {
    return "/zle-logo/zle-premium-soft3d.png";
  }
  
  const today = new Date();
  const dayIndex = today.getDate() % logoProImages.length;
  return logoProImages[dayIndex];
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
