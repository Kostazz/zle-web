import test from "node:test";
import assert from "node:assert/strict";
import { runDailyLineCodex } from "./engine";

test("engine includes world/crypto/system axis when world signals are active", () => {
  const result = runDailyLineCodex({
    date: "2026-03-29",
    history: [],
    candidateCount: 40,
    worldSignals: {
      lightLevel: "dim",
      weatherMood: "oppressive",
      marketStress: "high",
      energyPressure: "high",
      macroAbsurdity: "high",
      socialTension: "high",
      volatilityRegime: "high",
      trustFragility: "high",
      dominancePressure: "high",
      speculationHeat: "high",
      liquidityTension: "high",
      fragileHope: "medium",
      motifs: ["crypto_vol:high"],
      notes: [],
      activatedAxes: ["crypto", "world", "system", "symbolicFuture", "kryptokamos"],
      dominantAxis: "crypto",
      sourceHealth: { weather: "ok", market: "ok", sentiment: "ok", crypto: "ok" },
    },
  });

  const axes = result.selected.candidate.layers.map((layer) => layer.axis);
  assert.ok(axes.some((axis) => ["world", "system", "crypto", "technoHuman", "symbolicFuture"].includes(axis)));
});

test("final rendered line carries text fragment from prioritized context axis", () => {
  const result = runDailyLineCodex({
    date: "2026-04-01",
    history: [],
    candidateCount: 48,
    worldSignals: {
      lightLevel: "dark",
      weatherMood: "oppressive",
      marketStress: "high",
      energyPressure: "high",
      macroAbsurdity: "high",
      socialTension: "high",
      volatilityRegime: "high",
      trustFragility: "high",
      dominancePressure: "high",
      speculationHeat: "high",
      liquidityTension: "high",
      fragileHope: "high",
      motifs: ["crypto_vol:high", "market:high", "energy:high"],
      notes: [],
      activatedAxes: ["crypto", "system", "world", "symbolicFuture", "kryptokamos"],
      dominantAxis: "crypto",
      sourceHealth: { weather: "ok", market: "ok", sentiment: "ok", crypto: "ok" },
    },
  });

  const priorityLayer = result.selected.candidate.layers.find((layer) => layer.axis === "crypto")
    ?? result.selected.candidate.layers.find((layer) => layer.axis === "system")
    ?? result.selected.candidate.layers.find((layer) => layer.axis === "world");

  assert.ok(priorityLayer, "expected a priority world/crypto/system layer");
  assert.ok(
    result.line.toLowerCase().includes(priorityLayer!.fragment.text.toLowerCase()),
    "expected final text to include selected priority fragment"
  );
});

test("motif cooldown avoids recently repeated motifs from history metadata", () => {
  const repeatedMotif = "křehká_důvěra";
  const history = [
    { date: "2026-03-28", text: "x", motifs: [repeatedMotif] },
    { date: "2026-03-27", text: "x", motifs: [repeatedMotif] },
    { date: "2026-03-26", text: "x", motifs: [repeatedMotif] },
  ];

  const result = runDailyLineCodex({
    date: "2026-03-29",
    history,
    candidateCount: 36,
    worldSignals: {
      lightLevel: "dim",
      weatherMood: "flat",
      marketStress: "medium",
      energyPressure: "medium",
      macroAbsurdity: "medium",
      socialTension: "medium",
      volatilityRegime: "high",
      trustFragility: "high",
      dominancePressure: "medium",
      speculationHeat: "medium",
      liquidityTension: "medium",
      fragileHope: "medium",
      motifs: [],
      notes: [],
      activatedAxes: ["crypto", "kryptokamos", "system"],
      dominantAxis: "crypto",
      sourceHealth: { weather: "ok", market: "ok", sentiment: "ok", crypto: "ok" },
    },
  });

  assert.ok(!result.selected.candidate.motifs.includes(repeatedMotif));
});
