// client/src/lib/imageLoader.ts

const FINAL_DAILY_BASE = "/zle/logo/daily";
const DEFAULT_DAILY_INDEX = 1;
const DAILY_LOGO_COUNT = 19;

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

  if (path.toLowerCase().endsWith(".avif")) {
    return { src, avifSrc: src };
  }
  if (path.toLowerCase().endsWith(".webp")) {
    return { src, webpSrc: src };
  }

  const m = path.match(/\.(png|jpe?g)$/i);
  if (!m) {
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

function toToken(index: number) {
  return String(index).padStart(2, "0");
}

function pickDailyLogoIndex(date: Date = new Date()) {
  const day = date.getDate();
  return ((day - 1) % DAILY_LOGO_COUNT) + 1;
}

export function getDailyLogoPath(date: Date = new Date()) {
  const index = pickDailyLogoIndex(date) || DEFAULT_DAILY_INDEX;
  return `${FINAL_DAILY_BASE}/${toToken(index)}.png`;
}

/**
 * 🔒 Daily logo (same for whole site, changes max once per day)
 */
export function getDailyLogoSrc() {
  const src = getDailyLogoPath();

  return {
    avif: undefined,
    webp: undefined,
    jpg: src,
  };
}

/**
 * Variants for today's logo (used by ZleLogo)
 */
export function getTodaysLogoVariants(): ModernVariants {
  const src = getDailyLogoPath();

  return {
    src,
    webpSrc: undefined,
    avifSrc: undefined,
  };
}
