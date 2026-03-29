import { LAYER_LIBRARY, OPENINGS, TEMPLATE_LIBRARY } from "./codex";
import type { Candidate, CandidateLayer, DailyLineContext, DailyLineHistoryItem, LayerFragment } from "./types";

function seededFloat(seed: number, offset: number): number {
  const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function pickOne<T>(items: T[], seed: number, offset: number): T {
  const index = Math.floor(seededFloat(seed, offset) * items.length);
  return items[Math.max(0, Math.min(items.length - 1, index))];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9á-ž\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function collectRecentMotifs(history: DailyLineHistoryItem[]): Set<string> {
  const motifs = new Set<string>();
  for (const item of history.slice(0, 12)) {
    if (item.motifs?.length) {
      for (const motif of item.motifs) {
        motifs.add(motif);
      }
      continue;
    }

    const tokens = tokenize(item.text);
    for (const axis of Object.keys(LAYER_LIBRARY) as Array<keyof typeof LAYER_LIBRARY>) {
      for (const fragment of LAYER_LIBRARY[axis]) {
        const motifTokens = fragment.motif.split("_");
        if (motifTokens.some((token) => tokens.includes(token))) {
          motifs.add(fragment.motif);
        }
      }
    }
  }
  return motifs;
}

function chooseLayer(
  axis: keyof typeof LAYER_LIBRARY,
  context: DailyLineContext,
  recentMotifs: Set<string>,
  candidateNo: number,
  axisOffset: number
): LayerFragment {
  const basePool = LAYER_LIBRARY[axis];
  const filtered = basePool.filter((fragment) => !recentMotifs.has(fragment.motif));
  const pool = filtered.length >= 2 ? filtered : basePool;

  return pickOne(pool, context.seed + candidateNo * 31, axisOffset + candidateNo * 7);
}

function selectAxes(
  context: DailyLineContext,
  candidateNo: number,
  minLayers: number
): Array<keyof typeof LAYER_LIBRARY> {
  const targetLayerCount = Math.max(
    minLayers,
    context.worldSignals?.activatedAxes?.length ? Math.min(5, minLayers + 1) : minLayers
  );
  const selected: Array<keyof typeof LAYER_LIBRARY> = [];
  const pushAxis = (axis?: keyof typeof LAYER_LIBRARY) => {
    if (!axis || selected.includes(axis)) return;
    selected.push(axis);
  };

  pushAxis(context.worldSignals?.dominantAxis as keyof typeof LAYER_LIBRARY | undefined);

  const contextualAxes: Array<keyof typeof LAYER_LIBRARY> = [];
  if (context.weekPhase === "weekend") contextualAxes.push("weather");
  else contextualAxes.push("system");

  if (candidateNo % 2 === 0) contextualAxes.push("world");
  else contextualAxes.push("weather");

  if (context.worldSignals) {
    if (context.worldSignals.volatilityRegime !== "low" || context.worldSignals.trustFragility !== "low") contextualAxes.push("crypto");
    if (context.worldSignals.speculationHeat === "high" || context.worldSignals.liquidityTension !== "low") contextualAxes.push("symbolicFuture");
    if (context.worldSignals.dominancePressure !== "low" || context.worldSignals.fragileHope !== "low") contextualAxes.push("technoHuman");
  }

  if (context.worldSignals?.activatedAxes?.length) {
    const rotated = [...context.worldSignals.activatedAxes.slice(candidateNo % context.worldSignals.activatedAxes.length), ...context.worldSignals.activatedAxes.slice(0, candidateNo % context.worldSignals.activatedAxes.length)];
    for (const axis of rotated) pushAxis(axis as keyof typeof LAYER_LIBRARY);
  }

  for (const axis of contextualAxes) pushAxis(axis);

  for (const baseAxis of ["personal", "existential", "irony", "kryptokamos"] as Array<keyof typeof LAYER_LIBRARY>) {
    pushAxis(baseAxis);
  }

  return selected.slice(0, targetLayerCount);
}

export function generateCandidates(params: {
  context: DailyLineContext;
  history: DailyLineHistoryItem[];
  count: number;
}): Candidate[] {
  const { context, history, count } = params;
  const recentMotifs = collectRecentMotifs(history);
  const candidates: Candidate[] = [];

  for (let i = 0; i < count; i += 1) {
    const opening = pickOne(OPENINGS, context.seed + i * 13, 400 + i);
    const template = pickOne([...TEMPLATE_LIBRARY], context.seed + i * 17, 500 + i);
    const axes = selectAxes(context, i, template.minLayers);

    const layers: CandidateLayer[] = axes.map((axis, idx) => ({
      axis,
      fragment: chooseLayer(axis, context, recentMotifs, i, idx + 30),
    }));

    const parts = layers.map((layer) => layer.fragment.text);
    const body = template.render(parts);
    const normalizedBody = body.charAt(0).toLowerCase() + body.slice(1);
    const sentence = `${opening} ${normalizedBody}`;

    candidates.push({
      text: sentence.replace(/\s+/g, " ").trim(),
      opening,
      templateId: template.id,
      rhythm: template.rhythm,
      layers,
      motifs: layers.map((layer) => layer.fragment.motif),
      tags: layers.flatMap((layer) => layer.fragment.tags),
    });
  }

  return candidates;
}
