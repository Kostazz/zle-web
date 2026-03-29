import { CODEX_RULES } from "./codex";
import { generateCandidates } from "./generator";
import { scoreCandidate } from "./scoring";
import type {
  CandidateEvaluation,
  CodexGenerationResult,
  DailyLineContext,
  DailyLineHistoryItem,
} from "./types";
import { validateCandidate } from "./validation";

function parseDateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function buildContext(date: string): DailyLineContext {
  const { year, month, day } = parseDateParts(date);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();

  const weekPhase = dayOfWeek === 0 || dayOfWeek === 6
    ? "weekend"
    : dayOfWeek <= 2
      ? "start"
      : dayOfWeek <= 4
        ? "middle"
        : "end";

  const season = month <= 2 || month === 12
    ? "winter"
    : month <= 5
      ? "spring"
      : month <= 8
        ? "summer"
        : "autumn";

  const weatherMoodPool: DailyLineContext["weatherMood"][] = ["slunce", "déšť", "vítr", "mlha", "tma"];
  const societalPool: DailyLineContext["societalPulse"][] = ["drahota", "přetlak", "únava", "chaos", "hluk"];
  const worldPool: DailyLineContext["worldSignal"][] = ["trhy", "algoritmy", "války", "krize", "pozornost"];

  const seed = year * 10000 + month * 100 + day;

  return {
    date,
    seed,
    dayOfWeek,
    month,
    weekPhase,
    season,
    weatherMood: weatherMoodPool[seed % weatherMoodPool.length],
    pressureLevel: seed % 3 === 0 ? "high" : seed % 3 === 1 ? "medium" : "low",
    societalPulse: societalPool[(seed + dayOfWeek) % societalPool.length],
    worldSignal: worldPool[(seed + month) % worldPool.length],
  };
}

function withWorldSignals(
  context: DailyLineContext,
  worldSignals: DailyLineContext["worldSignals"]
): DailyLineContext {
  if (!worldSignals) return context;

  const pressureLevel = worldSignals.socialTension === "high"
    ? "high"
    : worldSignals.energyPressure === "medium" || worldSignals.marketStress === "medium"
      ? "medium"
      : "low";

  const mappedSocietalPulse: DailyLineContext["societalPulse"] =
    worldSignals.socialTension === "high"
      ? "přetlak"
      : worldSignals.weatherMood === "oppressive"
        ? "únava"
        : worldSignals.macroAbsurdity === "high"
          ? "chaos"
          : "hluk";

  const mappedWorldSignal: DailyLineContext["worldSignal"] =
    worldSignals.marketStress === "high"
      ? "trhy"
      : worldSignals.macroAbsurdity === "high"
        ? "krize"
        : "pozornost";

  return {
    ...context,
    pressureLevel,
    societalPulse: mappedSocietalPulse,
    worldSignal: mappedWorldSignal,
    worldSignals,
  };
}

function evaluateCandidates(
  context: DailyLineContext,
  history: DailyLineHistoryItem[],
  candidateCount: number
): CandidateEvaluation[] {
  return generateCandidates({ context, history, count: candidateCount }).map((candidate) => {
    const guardrailReasons = validateCandidate(candidate, history);
    const blocked = guardrailReasons.length > 0;
    const score = scoreCandidate(candidate, history);

    return {
      candidate,
      score,
      guardrailReasons,
      blocked,
    };
  });
}

export function runDailyLineCodex(params: {
  date: string;
  history: DailyLineHistoryItem[];
  candidateCount?: number;
  worldSignals?: DailyLineContext["worldSignals"];
}): CodexGenerationResult {
  const context = withWorldSignals(buildContext(params.date), params.worldSignals);
  const evaluations = evaluateCandidates(context, params.history, params.candidateCount ?? 24);

  const eligible = evaluations.filter((evaluation) => !evaluation.blocked);
  const pool = eligible.length > 0 ? eligible : evaluations;

  const selected = [...pool].sort((a, b) => b.score.total - a.score.total)[0];
  if (!selected) {
    throw new Error("codex_selection_failed");
  }

  return {
    line: selected.candidate.text,
    evaluations,
    selected,
    context,
    explain: {
      usedSignals: context.worldSignals
        ? [
            `light:${context.worldSignals.lightLevel}`,
            `weather:${context.worldSignals.weatherMood}`,
            `market:${context.worldSignals.marketStress}`,
            `energy:${context.worldSignals.energyPressure}`,
            `macro:${context.worldSignals.macroAbsurdity}`,
            `social:${context.worldSignals.socialTension}`,
            `volatility:${context.worldSignals.volatilityRegime}`,
            `trust:${context.worldSignals.trustFragility}`,
            `dominance:${context.worldSignals.dominancePressure}`,
            `speculation:${context.worldSignals.speculationHeat}`,
            `liquidity:${context.worldSignals.liquidityTension}`,
            `hope:${context.worldSignals.fragileHope}`,
          ]
        : [],
      activatedMotifBuckets: context.worldSignals?.activatedAxes ?? [],
    },
  };
}

export function getCodexRules(): string[] {
  return CODEX_RULES;
}
