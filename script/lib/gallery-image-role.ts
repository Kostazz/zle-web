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
  roleHintPath?: string;
};

export type ClassifiedGalleryImage = GalleryImageCandidate & {
  role: GalleryImageRole;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const LOGO_HINTS = ["logo", "brandmark", "wordmark", "logotype", "znacka"];
const TECHNICAL_HINTS = ["specification", "technical", "tech", "sheet"];
const PRODUCT_HINTS = ["tricko", "tee", "shirt", "hoodie", "mikina", "front", "model"];
const BACK_HINTS = ["back", "zad", "rear"];
const FABRIC_HINTS = ["detail", "closeup", "close-up", "texture", "fabric", "material"];

function normalizeTokenSource(value: string): string {
  return value.toLowerCase().replace(/[_%]+/g, "-");
}

function tokenizeSemanticInput(input: string): string[] {
  return normalizeTokenSource(input)
    .split(/[\s\-_.\\/!?;:,()[\]{}"'`~@#$%^&*+=|<>]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasToken(tokens: string[], token: string): boolean {
  return tokens.includes(token);
}

function hasAnyToken(tokens: string[], tokensToMatch: string[]): boolean {
  return tokensToMatch.some((token) => hasToken(tokens, token));
}

function hasTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || tokens.length < sequence.length) return false;
  for (let i = 0; i <= tokens.length - sequence.length; i++) {
    if (sequence.every((token, offset) => tokens[i + offset] === token)) return true;
  }
  return false;
}

function hasCompositeToken(tokens: string[], allowedPhrases: string[]): boolean {
  return allowedPhrases.some((phrase) => hasTokenSequence(tokens, tokenizeSemanticInput(phrase)));
}

function hasSizeChartSignal(tokens: string[]): boolean {
  if (hasCompositeToken(tokens, [
    "size-chart",
    "size-guide",
    "size-spec",
    "size-specification",
    "sizing-guide",
    "tabulka-velikosti",
    "velikostni-tabulka",
  ])) return true;

  const hasSizeToken = hasAnyToken(tokens, ["size", "sizing", "velikost", "velikosti"]);
  const hasChartToken = hasAnyToken(tokens, ["chart", "guide", "tabulka", "rozmery", "rozměry", "measurement", "specification"]);
  return hasSizeToken && hasChartToken;
}

export function classifyGalleryImageRole(sourcePath: string): Omit<ClassifiedGalleryImage, "originalIndex"> {
  const basename = path.basename(sourcePath).toLowerCase();
  const semanticInput = normalizeTokenSource(basename);
  const tokens = tokenizeSemanticInput(semanticInput);
  if (/\.(svg|gif)$/i.test(basename)) return { sourcePath, role: "reject", confidence: "high", reason: "unsupported non-product asset extension" };
  if (hasSizeChartSignal(tokens)) return { sourcePath, role: "size_chart", confidence: "high", reason: "size-chart token signal in basename" };
  if (hasAnyToken(tokens, BACK_HINTS)) return { sourcePath, role: "back_detail", confidence: "medium", reason: "back-view token in basename" };
  if (hasAnyToken(tokens, FABRIC_HINTS)) return { sourcePath, role: "fabric_detail", confidence: "medium", reason: "detail/fabric token in basename" };
  if (hasAnyToken(tokens, LOGO_HINTS) || hasAnyToken(tokens, TECHNICAL_HINTS)) {
    return { sourcePath, role: "logo_or_technical", confidence: "medium", reason: "logo/technical keyword in basename" };
  }
  if (hasAnyToken(tokens, PRODUCT_HINTS)) return { sourcePath, role: "product", confidence: "medium", reason: "product-view token in basename" };
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
  const classified = candidates.map((candidate) => {
    const classificationPath = candidate.roleHintPath ?? candidate.sourcePath;
    const classifiedRole = classifyGalleryImageRole(classificationPath);
    return {
      ...candidate,
      sourcePath: candidate.sourcePath,
      role: classifiedRole.role,
      confidence: classifiedRole.confidence,
      reason: classifiedRole.reason,
    };
  });
  const safeHero = classified.find((item) => ["product", "product_detail", "back_detail", "fabric_detail"].includes(item.role));
  if (!safeHero) {
    return { status: "review_required", ordered: classified, reason: "No safe product-like hero image candidate." };
  }
  const ordered = [...classified]
    .filter((item) => item.role !== "reject")
    .sort((a, b) => rankRole(a.role) - rankRole(b.role) || a.originalIndex - b.originalIndex);
  return { status: "ok", ordered, reason: "Ordered by conservative role priority with stable source index tie-break." };
}
