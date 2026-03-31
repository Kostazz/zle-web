import { desc, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { dailyLines } from "@shared/schema";
import { runDailyLineCodex } from "@shared/dailyLine/engine";
import type { CodexLayerAxis, DailyLineHistoryItem } from "@shared/dailyLine/types";
import { loadWorldContext } from "./worldContext";

export function getPragueDateString(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Prague" });
}

async function fetchHistoryBefore(date: string, limit = 21): Promise<DailyLineHistoryItem[]> {
  const rows = await db
    .select({ date: dailyLines.date, text: dailyLines.text, generationMeta: dailyLines.generationMeta, contextSnapshot: dailyLines.contextSnapshot })
    .from(dailyLines)
    .where(lt(dailyLines.date, date))
    .orderBy(desc(dailyLines.date))
    .limit(limit);

  return rows.map((row) => {
    const meta = row.generationMeta as any;
    const snapshot = row.contextSnapshot as any;
    return {
      date: row.date,
      text: row.text,
      motifs: Array.isArray(meta?.selected?.motifs) ? meta.selected.motifs : undefined,
      axes: Array.isArray(snapshot?.activatedAxes) ? snapshot.activatedAxes : undefined,
    };
  });
}

async function fetchRecentDominantAxes(date: string, limit = 5): Promise<CodexLayerAxis[]> {
  const rows = await db
    .select({ contextSnapshot: dailyLines.contextSnapshot })
    .from(dailyLines)
    .where(lt(dailyLines.date, date))
    .orderBy(desc(dailyLines.date))
    .limit(limit);

  return rows
    .map((row) => (row.contextSnapshot as any)?.dominantAxis as CodexLayerAxis | undefined)
    .filter((axis): axis is CodexLayerAxis => Boolean(axis));
}

export interface DailyLineResponse {
  date: string;
  text: string;
  source: "database" | "generated" | "fallback";
}

export function buildFallbackDailyLine(date: string): DailyLineResponse {
  const fallbackResult = runDailyLineCodex({ date, history: [], candidateCount: 16 });
  return {
    date,
    text: fallbackResult.line,
    source: "fallback",
  };
}

export async function getDailyLineForDate(dateInput?: string): Promise<DailyLineResponse> {
  const date = dateInput ?? getPragueDateString();
  const fallback = () => buildFallbackDailyLine(date);

  try {
    const [existing] = await db
      .select({ date: dailyLines.date, text: dailyLines.text })
      .from(dailyLines)
      .where(eq(dailyLines.date, date))
      .limit(1);

    if (existing) {
      return { ...existing, source: "database" };
    }
  } catch {
    return fallback();
  }

  try {
    const history = await fetchHistoryBefore(date);
    const recentDominantAxes = await fetchRecentDominantAxes(date, 5);
    const worldContext = await loadWorldContext({
      dateKey: date,
      recentDominantAxes,
    });
    const result = runDailyLineCodex({
      date,
      history,
      candidateCount: 32,
      worldSignals: {
        lightLevel: worldContext.lightLevel,
        weatherMood: worldContext.weatherMood,
        marketStress: worldContext.marketStress,
        energyPressure: worldContext.energyPressure,
        macroAbsurdity: worldContext.macroAbsurdity,
        socialTension: worldContext.socialTension,
        volatilityRegime: worldContext.volatilityRegime,
        trustFragility: worldContext.trustFragility,
        dominancePressure: worldContext.dominancePressure,
        speculationHeat: worldContext.speculationHeat,
        liquidityTension: worldContext.liquidityTension,
        fragileHope: worldContext.fragileHope,
        motifs: worldContext.motifs,
        notes: worldContext.notes,
        activatedAxes: worldContext.activatedAxes,
        dominantAxis: worldContext.dominantAxis,
        sourceHealth: worldContext.sourceHealth,
      },
    });

    try {
      await db
        .insert(dailyLines)
        .values({
          date,
          text: result.line,
          mode: "codex_v2",
          seed: String(result.context.seed),
          contextSnapshot: worldContext as any,
          generationMeta: {
            selected: {
              score: result.selected.score,
              templateId: result.selected.candidate.templateId,
              opening: result.selected.candidate.opening,
              motifs: result.selected.candidate.motifs,
            },
            explain: result.explain,
          } as any,
        })
        .onConflictDoNothing({ target: dailyLines.date });
    } catch {
      return { date, text: result.line, source: "generated" };
    }

    try {
      const [stored] = await db
        .select({ date: dailyLines.date, text: dailyLines.text })
        .from(dailyLines)
        .where(eq(dailyLines.date, date))
        .limit(1);

      if (stored) {
        return { ...stored, source: "generated" };
      }
    } catch {
      return { date, text: result.line, source: "generated" };
    }

    return { date, text: result.line, source: "generated" };
  } catch {
    return fallback();
  }
}

export async function getDailyLineExplain(dateInput?: string) {
  const date = dateInput ?? getPragueDateString();
  const history = await fetchHistoryBefore(date);
  const recentDominantAxes = await fetchRecentDominantAxes(date, 5);
  const worldContext = await loadWorldContext({ dateKey: date, recentDominantAxes });
  return runDailyLineCodex({
    date,
    history,
    candidateCount: 32,
    worldSignals: {
      lightLevel: worldContext.lightLevel,
      weatherMood: worldContext.weatherMood,
      marketStress: worldContext.marketStress,
      energyPressure: worldContext.energyPressure,
      macroAbsurdity: worldContext.macroAbsurdity,
      socialTension: worldContext.socialTension,
      volatilityRegime: worldContext.volatilityRegime,
      trustFragility: worldContext.trustFragility,
      dominancePressure: worldContext.dominancePressure,
      speculationHeat: worldContext.speculationHeat,
      liquidityTension: worldContext.liquidityTension,
      fragileHope: worldContext.fragileHope,
      motifs: worldContext.motifs,
      notes: worldContext.notes,
      activatedAxes: worldContext.activatedAxes,
      dominantAxis: worldContext.dominantAxis,
      sourceHealth: worldContext.sourceHealth,
    },
  });
}
