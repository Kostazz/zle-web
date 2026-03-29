import { normalizeWorldContext, type RawWorldContext, type WorldContextSnapshot } from "./contextNormalizer";
import type { CodexLayerAxis } from "@shared/dailyLine/types";

const REQUEST_TIMEOUT_MS = 1800;
const PRAGUE_LAT = 50.0755;
const PRAGUE_LON = 14.4378;

const OPEN_METEO_URL = `https://api.open-meteo.com/v1/forecast?latitude=${PRAGUE_LAT}&longitude=${PRAGUE_LON}&current=cloud_cover,precipitation,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=Europe%2FPrague&forecast_days=1`;
const STOOQ_VIX_URL = "https://stooq.com/q/l/?s=%5Evix&i=d";
const STOOQ_OIL_URL = "https://stooq.com/q/l/?s=cl.f&i=d";
const FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1&format=json";
const COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global";
const COINGECKO_BTC_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";

interface CachedWorldContext {
  snapshot: WorldContextSnapshot;
  fetchedAt: number;
}

const dailyWorldCache = new Map<string, CachedWorldContext>();

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Accept": "application/json,text/csv;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetchJson(url: string): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` };
    }
    return { ok: true, data: await response.json() };
  } catch (error: any) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "network" };
  }
}

async function safeFetchCsvLastClose(url: string): Promise<{ ok: true; close: number } | { ok: false; reason: string }> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` };
    }

    const body = await response.text();
    const lines = body.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return { ok: false, reason: "csv_empty" };
    }

    const values = lines[1].split(",").map((x) => x.trim());
    const close = Number(values[6]);
    if (!Number.isFinite(close)) {
      return { ok: false, reason: "close_nan" };
    }

    return { ok: true, close };
  } catch (error: any) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "network" };
  }
}

export function getPragueDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Prague" });
}

function parsePragueDate(dateKey: string): { weekday: number; month: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return { weekday: dt.getUTCDay(), month };
}

export async function loadWorldContext(params: {
  dateKey?: string;
  recentDominantAxes?: CodexLayerAxis[];
} = {}): Promise<WorldContextSnapshot> {
  const dateKey = params.dateKey ?? getPragueDateKey();

  const cached = dailyWorldCache.get(dateKey);
  if (cached) {
    return cached.snapshot;
  }

  const { weekday, month } = parsePragueDate(dateKey);
  const notes: string[] = [];

  const [weatherRes, vixRes, oilRes, fearGreedRes, cryptoGlobalRes, cryptoBtcRes] = await Promise.all([
    safeFetchJson(OPEN_METEO_URL),
    safeFetchCsvLastClose(STOOQ_VIX_URL),
    safeFetchCsvLastClose(STOOQ_OIL_URL),
    safeFetchJson(FEAR_GREED_URL),
    safeFetchJson(COINGECKO_GLOBAL_URL),
    safeFetchJson(COINGECKO_BTC_URL),
  ]);

  const raw: RawWorldContext = {
    dateKey,
    weekday,
    month,
    weather: weatherRes.ok
      ? {
          cloudCover: Number(weatherRes.data?.current?.cloud_cover ?? 50),
          precipitation: Number(weatherRes.data?.current?.precipitation ?? 0),
          windSpeed: Number(weatherRes.data?.current?.wind_speed_10m ?? 10),
          isDay: Number(weatherRes.data?.current?.is_day ?? 1),
          sunrise: String(weatherRes.data?.daily?.sunrise?.[0] ?? ""),
          sunset: String(weatherRes.data?.daily?.sunset?.[0] ?? ""),
        }
      : undefined,
    market: {
      vixClose: vixRes.ok ? vixRes.close : null,
      oilClose: oilRes.ok ? oilRes.close : null,
    },
    sentiment: {
      fearGreed: fearGreedRes.ok ? Number(fearGreedRes.data?.data?.[0]?.value ?? 50) : null,
    },
    crypto: {
      btc24hChange: cryptoBtcRes.ok ? Number(cryptoBtcRes.data?.bitcoin?.usd_24h_change ?? 0) : null,
      btcDominance: cryptoGlobalRes.ok ? Number(cryptoGlobalRes.data?.data?.market_cap_percentage?.btc ?? 52) : null,
      totalVolumeUsd: cryptoGlobalRes.ok ? Number(cryptoGlobalRes.data?.data?.total_volume?.usd ?? 0) : null,
      totalMarketCapUsd: cryptoGlobalRes.ok ? Number(cryptoGlobalRes.data?.data?.total_market_cap?.usd ?? 0) : null,
    },
    sourceHealth: {
      weather: weatherRes.ok ? "ok" : "fallback",
      market: vixRes.ok && oilRes.ok ? "ok" : "fallback",
      sentiment: fearGreedRes.ok ? "ok" : "fallback",
      crypto: cryptoGlobalRes.ok && cryptoBtcRes.ok ? "ok" : "fallback",
    },
    notes,
  };

  if (!weatherRes.ok) notes.push(`weather:${weatherRes.reason}`);
  if (!vixRes.ok) notes.push(`vix:${vixRes.reason}`);
  if (!oilRes.ok) notes.push(`oil:${oilRes.reason}`);
  if (!fearGreedRes.ok) notes.push(`fear_greed:${fearGreedRes.reason}`);
  if (!cryptoGlobalRes.ok) notes.push(`coingecko_global:${cryptoGlobalRes.reason}`);
  if (!cryptoBtcRes.ok) notes.push(`coingecko_btc:${cryptoBtcRes.reason}`);

  const snapshot = normalizeWorldContext(raw, params.recentDominantAxes ?? []);
  dailyWorldCache.set(dateKey, { snapshot, fetchedAt: Date.now() });
  return snapshot;
}

export function clearWorldContextCache(dateKey?: string) {
  if (dateKey) {
    dailyWorldCache.delete(dateKey);
    return;
  }
  dailyWorldCache.clear();
}
