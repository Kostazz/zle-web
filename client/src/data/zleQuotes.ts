import { runDailyLineCodex } from "@shared/dailyLine/engine";
import { getPragueDateString } from "@/lib/pragueDate";

export interface ZleQuoteData {
  title: string;
  message: string;
  dailyLine: string;
  source: "api" | "fallback";
}

const DEFAULT_TITLE = "DNEŠNÍ ZLE HLÁŠKA";
const DEFAULT_MESSAGE = "ZLE Daily Line Codex v2";
const STORAGE_KEY = "zleQuoteCodexV2";

function buildFallbackQuote(date: string): ZleQuoteData {
  const result = runDailyLineCodex({ date, history: [], candidateCount: 16 });
  return {
    title: DEFAULT_TITLE,
    message: DEFAULT_MESSAGE,
    dailyLine: result.line,
    source: "fallback",
  };
}

function readStoredQuote(date: string): ZleQuoteData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { date?: string; quote?: ZleQuoteData };
    if (parsed.date !== date || !parsed.quote?.dailyLine) {
      return null;
    }
    return parsed.quote;
  } catch {
    return null;
  }
}

function persistQuote(date: string, quote: ZleQuoteData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date, quote }));
}

export function getImmediateTodayQuote(): ZleQuoteData {
  const pragueToday = getPragueDateString();
  const cached = readStoredQuote(pragueToday);
  if (cached) return cached;

  const fallback = buildFallbackQuote(pragueToday);
  persistQuote(pragueToday, fallback);
  return fallback;
}

export async function getTodayQuote(): Promise<ZleQuoteData> {
  const pragueToday = getPragueDateString();
  const cached = getImmediateTodayQuote();
  if (cached.source === "api") return cached;

  try {
    const response = await fetch("/api/daily-line", {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`daily_line_http_${response.status}`);
    }

    const payload = await response.json() as { date?: string; text?: string };
    if (!payload?.date || !payload?.text) {
      throw new Error("invalid_daily_line_payload");
    }

    const quote: ZleQuoteData = {
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE,
      dailyLine: payload.text,
      source: "api",
    };

    persistQuote(payload.date, quote);
    return quote;
  } catch {
    return cached;
  }
}

export async function getTodayDailyLine(): Promise<string> {
  const quote = await getTodayQuote();
  return quote.dailyLine;
}
