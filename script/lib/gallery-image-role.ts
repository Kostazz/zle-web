import path from "node:path";

export type GalleryImageRole =
  | "product"
  | "product_detail"
  | "back_detail"
  | "fabric_detail"
  | "size_chart"
  | "logo_or_technical"
  | "unknown"
  | "reject";

export type GalleryImageCandidate = {
  sourcePath: string;
  originalIndex: number;
};

export type ClassifiedGalleryImage = GalleryImageCandidate & {
  role: GalleryImageRole;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const SIZE_CHART_HINTS = [
  "size-chart", "size_chart", "sizechart", "measurement-chart", "measurement_chart",
  "measurements", "tabulka-velikosti", "velikostni-tabulka", "rozmery", "rozměry", "rozmer", "rozměr",
  "size-guide", "size guide", "sizing-guide", "sizing guide",
];
const LOGO_HINTS = ["logo", "brandmark", "wordmark", "logotype", "znacka"];
const TECHNICAL_HINTS = ["specification", "technical", "tech", "sheet"];
const PRODUCT_HINTS = ["tricko", "tee", "shirt", "hoodie", "mikina", "front", "model"];
const BACK_HINTS = ["back", "zad", "rear"];
const FABRIC_HINTS = ["detail", "closeup", "close-up", "texture", "fabric", "material"];

function normalizeTokenSource(value: string): string {
  return value.toLowerCase().replace(/[_%]+/g, "-");
}

function tokenizeBasename(baseName: string): string[] {
  return normalizeTokenSource(baseName)
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9á-ž]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasCompositeToken(tokens: string[], allowedPhrases: string[]): boolean {
  const joined = tokens.join("-");
  return allowedPhrases.some((phrase) => joined.includes(phrase));
}

function hasSizeChartSignal(normalizedBaseName: string, tokens: string[]): boolean {
  if (SIZE_CHART_HINTS.some((hint) => normalizedBaseName.includes(hint))) return true;
  const hasSizeToken = tokens.some((token) => ["size", "sizing", "velikost", "velikosti"].includes(token));
  const hasChartToken = tokens.some((token) => ["chart", "guide", "tabulka", "rozmery", "rozměry", "measurement", "specification"].includes(token))
    || hasCompositeToken(tokens, ["size-spec", "size-specification"]);
  return hasSizeToken && hasChartToken;
}

export function classifyGalleryImageRole(sourcePath: string): Omit<ClassifiedGalleryImage, "originalIndex"> {
  const basename = path.basename(sourcePath).toLowerCase();
  const normalizedBaseName = normalizeTokenSource(basename);
  const tokens = tokenizeBasename(basename);
  if (/\.(svg|gif)$/i.test(basename)) return { sourcePath, role: "reject", confidence: "high", reason: "unsupported non-product asset extension" };
  if (hasSizeChartSignal(normalizedBaseName, tokens)) return { sourcePath, role: "size_chart", confidence: "high", reason: "size-chart keyword/signal in basename" };
  if (BACK_HINTS.some((hint) => tokens.includes(hint))) return { sourcePath, role: "back_detail", confidence: "medium", reason: "back-view keyword in basename" };
  if (FABRIC_HINTS.some((hint) => tokens.includes(hint))) return { sourcePath, role: "fabric_detail", confidence: "medium", reason: "detail/fabric keyword in basename" };
  if (LOGO_HINTS.some((hint) => tokens.includes(hint)) || TECHNICAL_HINTS.some((hint) => tokens.includes(hint))) {
    return { sourcePath, role: "logo_or_technical", confidence: "medium", reason: "logo/technical keyword in basename" };
  }
  if (PRODUCT_HINTS.some((hint) => tokens.includes(hint))) return { sourcePath, role: "product", confidence: "medium", reason: "product-view keyword in basename" };
  if (/^(cover|front)\.(jpg|jpeg|webp|png)$/i.test(basename)) return { sourcePath, role: "product", confidence: "high", reason: "cover/front filename" };
  if (/^\d{2}\.(jpg|jpeg|webp|png)$/i.test(basename)) {
    return { sourcePath, role: "unknown", confidence: "low", reason: "managed numeric slot filename has no semantic role hint" };
  }
  return { sourcePath, role: "unknown", confidence: "low", reason: "no conservative role hint" };
}

function rankRole(role: GalleryImageRole): number {
  switch (role) {
    case "product": return 0;
    case "product_detail": return 1;
    case "back_detail": return 2;
    case "fabric_detail": return 3;
    case "unknown": return 4;
    case "size_chart": return 5;
    case "logo_or_technical": return 6;
    case "reject": return 7;
  }
}

export function resolveGalleryImageOrder(candidates: GalleryImageCandidate[]): {
  status: "ok" | "review_required";
  ordered: ClassifiedGalleryImage[];
  reason: string;
} {
  const classified = candidates.map((candidate) => ({
    ...candidate,
    ...classifyGalleryImageRole(candidate.sourcePath),
  }));
  const safeHero = classified.find((item) => ["product", "product_detail", "back_detail", "fabric_detail"].includes(item.role));
  if (!safeHero) {
    return { status: "review_required", ordered: classified, reason: "No safe product-like hero image candidate." };
  }
  const ordered = [...classified]
    .filter((item) => item.role !== "reject")
    .sort((a, b) => rankRole(a.role) - rankRole(b.role) || a.originalIndex - b.originalIndex);
  return { status: "ok", ordered, reason: "Ordered by conservative role priority with stable source index tie-break." };
}
