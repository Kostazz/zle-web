import type { CodexLayerAxis } from "@shared/dailyLine/types";

export type SignalLevel = "low" | "medium" | "high";
export type LightLevel = "dark" | "dim" | "balanced" | "bright";
export type WeatherMood = "oppressive" | "flat" | "clear" | "volatile";

export interface RawWorldContext {
  dateKey: string;
  weekday: number;
  month: number;
  weather?: {
    cloudCover?: number | null;
    precipitation?: number | null;
    windSpeed?: number | null;
    isDay?: number | null;
    sunrise?: string | null;
    sunset?: string | null;
  };
  market?: {
    vixClose?: number | null;
    oilClose?: number | null;
  };
  sentiment?: {
    fearGreed?: number | null;
  };
  crypto?: {
    btc24hChange?: number | null;
    btcDominance?: number | null;
    totalVolumeUsd?: number | null;
    totalMarketCapUsd?: number | null;
  };
  sourceHealth: {
    weather: "ok" | "fallback";
    market: "ok" | "fallback";
    sentiment: "ok" | "fallback";
    crypto: "ok" | "fallback";
  };
  notes: string[];
}

export interface WorldContextSnapshot {
  dateKey: string;
  weekday: number;
  season: "winter" | "spring" | "summer" | "autumn";
  lightLevel: LightLevel;
  weatherMood: WeatherMood;
  weatherContrast: SignalLevel;
  marketStress: SignalLevel;
  energyPressure: SignalLevel;
  macroAbsurdity: SignalLevel;
  socialTension: SignalLevel;
  volatilityRegime: SignalLevel;
  trustFragility: SignalLevel;
  dominancePressure: SignalLevel;
  speculationHeat: SignalLevel;
  liquidityTension: SignalLevel;
  fragileHope: SignalLevel;
  sourceHealth: RawWorldContext["sourceHealth"];
  motifs: string[];
  notes: string[];
  activatedAxes: CodexLayerAxis[];
  dominantAxis: CodexLayerAxis;
}

function seasonFromMonth(month: number): WorldContextSnapshot["season"] {
  if (month <= 2 || month === 12) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

function levelFromNumber(value: number, medium: number, high: number): SignalLevel {
  if (value >= high) return "high";
  if (value >= medium) return "medium";
  return "low";
}

function pickDominantAxis(params: {
  weatherMood: WeatherMood;
  marketStress: SignalLevel;
  energyPressure: SignalLevel;
  socialTension: SignalLevel;
  volatilityRegime: SignalLevel;
  trustFragility: SignalLevel;
  dominancePressure: SignalLevel;
  recentDominantAxes: CodexLayerAxis[];
}): CodexLayerAxis {
  const candidates: Array<{ axis: CodexLayerAxis; score: number }> = [
    { axis: "weather", score: params.weatherMood === "oppressive" || params.weatherMood === "volatile" ? 3 : 1 },
    { axis: "system", score: params.energyPressure === "high" ? 3 : params.socialTension === "high" ? 2 : 1 },
    { axis: "world", score: params.marketStress === "high" ? 3 : params.marketStress === "medium" ? 2 : 1 },
    { axis: "personal", score: params.socialTension === "high" ? 2 : 1 },
    { axis: "crypto", score: params.volatilityRegime === "high" || params.trustFragility === "high" ? 3 : 1 },
    { axis: "technoHuman", score: params.dominancePressure === "high" ? 3 : 1 },
    { axis: "symbolicFuture", score: params.trustFragility === "high" ? 3 : 2 },
    { axis: "kryptokamos", score: 3 },
    { axis: "existential", score: 2 },
    { axis: "irony", score: 2 },
  ];

  const recentPenalty = new Map<CodexLayerAxis, number>();
  for (const axis of params.recentDominantAxes.slice(0, 3)) {
    recentPenalty.set(axis, (recentPenalty.get(axis) ?? 0) + 2);
  }

  const sorted = candidates
    .map((candidate) => ({
      ...candidate,
      final: candidate.score - (recentPenalty.get(candidate.axis) ?? 0),
    }))
    .sort((a, b) => b.final - a.final);

  return sorted[0]?.axis ?? "existential";
}

export function normalizeWorldContext(raw: RawWorldContext, recentDominantAxes: CodexLayerAxis[] = []): WorldContextSnapshot {
  const weather = raw.weather ?? {};
  const market = raw.market ?? {};
  const sentiment = raw.sentiment ?? {};
  const crypto = raw.crypto ?? {};

  const cloudCover = Number(weather.cloudCover ?? 50);
  const precipitation = Number(weather.precipitation ?? 0);
  const windSpeed = Number(weather.windSpeed ?? 10);
  const lightLevel: LightLevel = cloudCover >= 85 ? "dark" : cloudCover >= 65 ? "dim" : cloudCover <= 25 ? "bright" : "balanced";

  const weatherMood: WeatherMood = precipitation >= 2
    ? "oppressive"
    : windSpeed >= 35
      ? "volatile"
      : cloudCover <= 25
        ? "clear"
        : "flat";

  const weatherContrast = levelFromNumber(Math.abs(70 - cloudCover) + precipitation * 8, 25, 45);
  const marketStress = levelFromNumber(Number(market.vixClose ?? 20), 20, 28);
  const energyPressure = levelFromNumber(Number(market.oilClose ?? 75), 80, 92);
  const fearGreed = Number(sentiment.fearGreed ?? 50);
  const macroAbsurdity = levelFromNumber(Math.abs(50 - fearGreed), 15, 30);
  const socialTension = levelFromNumber((marketStress === "high" ? 30 : marketStress === "medium" ? 20 : 10) + (energyPressure === "high" ? 25 : 10), 30, 45);
  const btcChange = Math.abs(Number(crypto.btc24hChange ?? 0));
  const volatilityRegime = levelFromNumber(btcChange, 2.5, 5.5);
  const dominancePressure = levelFromNumber(Number(crypto.btcDominance ?? 52), 54, 59);
  const liquidityRatio = Number(crypto.totalVolumeUsd ?? 0) / Math.max(1, Number(crypto.totalMarketCapUsd ?? 1));
  const liquidityTension = levelFromNumber(Number.isFinite(liquidityRatio) ? liquidityRatio * 100 : 8, 8, 13);
  const trustFragility = levelFromNumber((macroAbsurdity === "high" ? 20 : 10) + (volatilityRegime === "high" ? 20 : 8), 20, 32);
  const speculationHeat = levelFromNumber((fearGreed >= 70 ? 30 : fearGreed <= 30 ? 24 : 12) + (volatilityRegime === "high" ? 12 : 4), 25, 36);
  const fragileHope = levelFromNumber((trustFragility === "high" ? 14 : 6) + (speculationHeat === "high" ? 18 : 8), 18, 28);

  const motifs = [
    `light:${lightLevel}`,
    `weather:${weatherMood}`,
    `market:${marketStress}`,
    `energy:${energyPressure}`,
    `macro:${macroAbsurdity}`,
    `social:${socialTension}`,
    `crypto_vol:${volatilityRegime}`,
    `crypto_trust:${trustFragility}`,
    `crypto_dom:${dominancePressure}`,
    `crypto_spec:${speculationHeat}`,
  ];

  const activatedAxes: CodexLayerAxis[] = ["personal", "existential", "irony", "kryptokamos"];
  if (weatherMood !== "flat") activatedAxes.push("weather");
  if (marketStress !== "low") activatedAxes.push("world");
  if (energyPressure !== "low" || socialTension === "high") activatedAxes.push("system");
  if (volatilityRegime !== "low" || trustFragility !== "low") activatedAxes.push("crypto");
  if (liquidityTension !== "low" || speculationHeat === "high") activatedAxes.push("symbolicFuture");
  if (dominancePressure !== "low") activatedAxes.push("technoHuman");

  const dominantAxis = pickDominantAxis({
    weatherMood,
    marketStress,
    energyPressure,
    socialTension,
    volatilityRegime,
    trustFragility,
    dominancePressure,
    recentDominantAxes,
  });

  return {
    dateKey: raw.dateKey,
    weekday: raw.weekday,
    season: seasonFromMonth(raw.month),
    lightLevel,
    weatherMood,
    weatherContrast,
    marketStress,
    energyPressure,
    macroAbsurdity,
    socialTension,
    volatilityRegime,
    trustFragility,
    dominancePressure,
    speculationHeat,
    liquidityTension,
    fragileHope,
    sourceHealth: raw.sourceHealth,
    motifs,
    notes: raw.notes,
    activatedAxes: Array.from(new Set(activatedAxes)),
    dominantAxis,
  };
}
