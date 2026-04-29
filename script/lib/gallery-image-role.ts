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
const TECHNICAL_HINTS = ["spec", "specification", "technical", "tech-sheet", "chart"];
const PRODUCT_HINTS = ["tricko", "tee", "shirt", "hoodie", "mikina", "front", "model"];
const BACK_HINTS = ["back", "zad", "rear"];
const FABRIC_HINTS = ["detail", "closeup", "close-up", "texture", "fabric", "material"];

function normalizeTokenSource(value: string): string {
  return value.toLowerCase().replace(/[_%]+/g, "-");
}

function hasSizeChartSignal(normalized: string): boolean {
  if (SIZE_CHART_HINTS.some((hint) => normalized.includes(hint))) return true;
  const hasSizeToken = /\b(size|sizing|velikost|velikosti)\b/i.test(normalized);
  const hasChartToken = /\b(chart|guide|tabulka|rozmery|rozměry|measurement|specification|spec)\b/i.test(normalized);
  return hasSizeToken && hasChartToken;
}

export function classifyGalleryImageRole(sourcePath: string): Omit<ClassifiedGalleryImage, "originalIndex"> {
  const basename = path.basename(sourcePath).toLowerCase();
  const normalized = normalizeTokenSource(sourcePath);
  if (/\.(svg|gif)$/i.test(basename)) return { sourcePath, role: "reject", confidence: "high", reason: "unsupported non-product asset extension" };
  if (hasSizeChartSignal(normalized)) return { sourcePath, role: "size_chart", confidence: "high", reason: "size-chart keyword/signal in path" };
  if (BACK_HINTS.some((hint) => normalized.includes(hint))) return { sourcePath, role: "back_detail", confidence: "medium", reason: "back-view keyword in path" };
  if (FABRIC_HINTS.some((hint) => normalized.includes(hint))) return { sourcePath, role: "fabric_detail", confidence: "medium", reason: "detail/fabric keyword in path" };
  if (LOGO_HINTS.some((hint) => normalized.includes(hint)) || TECHNICAL_HINTS.some((hint) => normalized.includes(hint))) {
    return { sourcePath, role: "logo_or_technical", confidence: "medium", reason: "logo/technical keyword in path" };
  }
  if (PRODUCT_HINTS.some((hint) => normalized.includes(hint))) return { sourcePath, role: "product", confidence: "medium", reason: "product-view keyword in path" };
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
