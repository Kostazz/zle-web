import type { Candidate, CandidateScoreBreakdown, DailyLineHistoryItem } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9á-ž\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function jaccardSimilarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size || !sb.size) return 0;

  let intersection = 0;
  for (const t of Array.from(sa)) {
    if (sb.has(t)) intersection += 1;
  }
  return intersection / (sa.size + sb.size - intersection);
}

function countDistinctAxes(candidate: Candidate): number {
  return new Set(candidate.layers.map((layer) => layer.axis)).size;
}

function startsLikeRecent(candidate: Candidate, history: DailyLineHistoryItem[]): boolean {
  const normalized = candidate.text.toLowerCase();
  return history.slice(0, 8).some((item) => {
    const other = item.text.toLowerCase();
    return normalized.slice(0, 18) === other.slice(0, 18);
  });
}

export function scoreCandidate(candidate: Candidate, history: DailyLineHistoryItem[]): CandidateScoreBreakdown {
  const distinctAxes = countDistinctAxes(candidate);
  const textTokens = tokenize(candidate.text);
  const uniqueRatio = new Set(textTokens).size / Math.max(1, textTokens.length);
  const maxSimilarity = history.slice(0, 20).reduce((max, item) => Math.max(max, jaccardSimilarity(candidate.text, item.text)), 0);
  const hasZleAnchor = /^zle|zle\b/i.test(candidate.text) || candidate.text.toLowerCase().includes(" zle ");
  const mentionsWeather = /(slunce|déšť|vítr|tma|ráno|město)/i.test(candidate.text);
  const mentionsSystem = /(účty|systém|výplata|nákup|trhy|energie)/i.test(candidate.text);
  const mentionsSymbolic = /(hodnota|důvěra|směr|ticho|hluk|hype|pravda|budoucnost)/i.test(candidate.text);
  const mentionsFutureTension = /(budoucnost|algoritmus|digitální|analogová|směr)/i.test(candidate.text);
  const mentionsTrustIllusion = /(důvěra|iluze|hype|pravda|kompas)/i.test(candidate.text);
  const hasKryptoKamosAxis = candidate.layers.some((layer) => layer.axis === "kryptokamos");

  const depth = Math.min(10, distinctAxes * 2 + (candidate.layers.length >= 4 ? 2 : 0));
  const originality = Math.max(0, Math.round((1 - maxSimilarity) * 10));
  const naturalness = candidate.text.length >= 70 && candidate.text.length <= 180 ? 8 : 5;
  const zleFit = hasZleAnchor ? 9 : 5;
  const antiBullshit = candidate.text.includes("pozitivně") ? 2 : 9;
  const antiRepeat = startsLikeRecent(candidate, history) ? 2 : Math.max(1, Math.round((1 - maxSimilarity) * 10));
  const publishability = uniqueRatio > 0.72 ? 8 : 6;
  const worldBlendBonus = mentionsWeather && mentionsSystem ? 1 : 0;
  const symbolicDepth = mentionsSymbolic ? 8 : 5;
  const futureTension = mentionsFutureTension ? 8 : 5;
  const trustIllusionLayer = mentionsTrustIllusion ? 8 : 5;
  const kryptoKamosFit = hasKryptoKamosAxis ? 9 : 6;

  const total =
    depth * 0.2 +
    originality * 0.2 +
    naturalness * 0.15 +
    zleFit * 0.15 +
    antiBullshit * 0.1 +
    antiRepeat * 0.1 +
    publishability * 0.1 +
    worldBlendBonus * 0.05 +
    symbolicDepth * 0.05 +
    futureTension * 0.05 +
    trustIllusionLayer * 0.05 +
    kryptoKamosFit * 0.05;

  return {
    depth,
    originality,
    naturalness,
    zleFit,
    antiBullshit,
    antiRepeat,
    publishability,
    symbolicDepth,
    futureTension,
    trustIllusionLayer,
    kryptoKamosFit,
    total: Number(total.toFixed(3)),
  };
}
