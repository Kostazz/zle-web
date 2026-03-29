import { FORBIDDEN_PHRASES } from "./codex";
import type { Candidate, DailyLineHistoryItem } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9á-ž\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function overlapRatio(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of Array.from(aTokens)) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(aTokens.size, bTokens.size);
}

export function validateCandidate(candidate: Candidate, history: DailyLineHistoryItem[]): string[] {
  const reasons: string[] = [];
  const lower = candidate.text.toLowerCase();

  if (!candidate.text.endsWith(".")) {
    reasons.push("missing_terminal_period");
  }

  const sentenceSplit = candidate.text.split(/[.!?]+/).filter((part) => part.trim().length > 0);
  if (sentenceSplit.length > 1) {
    reasons.push("multi_sentence_output");
  }

  if (candidate.layers.length < 3 || new Set(candidate.layers.map((layer) => layer.axis)).size < 3) {
    reasons.push("missing_multilayer_structure");
  }

  if (candidate.text.length < 65 || candidate.text.length > 190) {
    reasons.push("out_of_length_window");
  }

  if (FORBIDDEN_PHRASES.some((phrase) => lower.includes(phrase))) {
    reasons.push("forbidden_phrase");
  }

  if (/\b(brent|wti|vix|s&p|nasdaq|dow)\b/i.test(candidate.text)) {
    reasons.push("too_report_like");
  }

  if (/\b\d{2,4}\b/.test(candidate.text)) {
    reasons.push("contains_hard_numeric_report");
  }

  if (/\b(btc|bitcoin|eth|altcoin|sol|long|short|entry|pump|dump|moon|wagmi|hodl|gm)\b/i.test(candidate.text)) {
    reasons.push("crypto_tweet_tone");
  }

  if (/\b(disrupt|mindset|grindset|10x|founder mode|startup)\b/i.test(candidate.text)) {
    reasons.push("tech_bro_tone");
  }

  if (/\b(vesmír ti vrátí|manifest|vibrace)\b/i.test(candidate.text)) {
    reasons.push("pseudo_zen_tone");
  }

  const repeatedWord = /(\b[a-zá-ž]{4,}\b)(?:\s+\1){1,}/i;
  if (repeatedWord.test(lower)) {
    reasons.push("clumsy_repetition");
  }

  const tooSimilar = history
    .slice(0, 10)
    .some((item) => overlapRatio(candidate.text, item.text) >= 0.72 || item.text.slice(0, 20).toLowerCase() === lower.slice(0, 20));

  if (tooSimilar) {
    reasons.push("too_similar_to_recent_history");
  }

  return reasons;
}
