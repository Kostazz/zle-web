// client/src/lib/imageLoader.ts

const LEGACY_DAILY_BASE = "/images/logo/daily";
const FINAL_DAILY_BASE = "/zle/logo/daily";
const DEFAULT_DAILY_DAY = 1;

const AVAILABLE_DAILY_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const FINAL_DAILY_VARIANTS: Record<number, { jpg?: boolean; webp?: boolean; avif?: boolean }> = {
  1: { jpg: true },
  2: { jpg: true },
  3: { jpg: true },
  4: { jpg: true },
  5: { jpg: true },
  6: { jpg: true },
  7: { jpg: true },
};

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

function toDayToken(day: number) {
  return String(day).padStart(2, "0");
}

function pickDailyDayIndex(date: Date = new Date()) {
  const slot = date.getDate();
  const index = slot % AVAILABLE_DAILY_DAYS.length || AVAILABLE_DAILY_DAYS.length;
  return AVAILABLE_DAILY_DAYS[index - 1] ?? DEFAULT_DAILY_DAY;
}

function getDailyVariantPath(day: number, ext: "avif" | "webp" | "jpg") {
  const token = toDayToken(day);
  const finalVariant = FINAL_DAILY_VARIANTS[day];

  if (finalVariant?.[ext]) {
    return `${FINAL_DAILY_BASE}/${token}.${ext}`;
  }

  return `${LEGACY_DAILY_BASE}/${token}.${ext}`;
}

/**
 * 🔒 Daily logo (same for whole site, changes max once per day)
 */
export function getDailyLogoSrc() {
  const dayIndex = pickDailyDayIndex();

  return {
    avif: getDailyVariantPath(dayIndex, "avif"),
    webp: getDailyVariantPath(dayIndex, "webp"),
    jpg: getDailyVariantPath(dayIndex, "jpg"),
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
