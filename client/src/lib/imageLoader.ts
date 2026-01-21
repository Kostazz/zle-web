// client/src/lib/imageLoader.ts

const DAILY_LOGO_COUNT = 7;

export type ModernVariants = {
  src?: string;
  webpSrc?: string;
  avifSrc?: string;
};

/**
 * Remove query/hash from path and keep suffix.
 */
function stripQueryAndHash(input: string) {
  const i = input.search(/[?#]/);
  return i === -1
    ? { path: input, suffix: "" }
    : { path: input.slice(0, i), suffix: input.slice(i) };
}

/**
 * Build modern image variants (.webp / .avif) from classic formats.
 * Pure URL logic – does NOT check file existence.
 */
function buildVariants(src: string): ModernVariants {
  const { path, suffix } = stripQueryAndHash(src);

  // Already modern
  if (path.toLowerCase().endsWith(".avif")) {
    return { src, avifSrc: src };
  }
  if (path.toLowerCase().endsWith(".webp")) {
    return { src, webpSrc: src };
  }

  // Classic formats
  const m = path.match(/\.(png|jpe?g)$/i);
  if (!m) {
    // Unknown extension → return as-is
    return { src };
  }

  const base = path.slice(0, -m[0].length);

  return {
    src,
    webpSrc: `${base}.webp${suffix}`,
    avifSrc: `${base}.avif${suffix}`,
  };
}

/**
 * Public helper for generic images
 */
export function getModernFormatVariants(src: string): ModernVariants {
  return buildVariants(src);
}

/**
 * 🔒 Daily logo (same for whole site, changes max once per day)
 */
export function getDailyLogoSrc() {
  const dayIndex =
    new Date().getDate() % DAILY_LOGO_COUNT || DAILY_LOGO_COUNT;

  const base = `/images/logo/daily/${String(dayIndex).padStart(2, "0")}`;

  return {
    avif: `${base}.avif`,
    webp: `${base}.webp`,
    jpg: `${base}.jpg`,
  };
}

/**
 * Variants for today's logo (used by ZleLogo / logoContext)
 */
export function getTodaysLogoVariants(): ModernVariants {
  const daily = getDailyLogoSrc();
  return {
    src: daily.jpg,
    webpSrc: daily.webp,
    avifSrc: daily.avif,
  };
}

/**
 * 🔁 Backward compatibility alias
 * (logoContext imports getTodaysLogo)
 */
export const getTodaysLogo = getTodaysLogoVariants;
