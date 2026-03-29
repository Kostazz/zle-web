import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldContext } from "./contextNormalizer";
import { scoreCandidate } from "@shared/dailyLine/scoring";
import { validateCandidate } from "@shared/dailyLine/validation";

test("normalizer maps raw market/weather data to controlled signals", () => {
  const snapshot = normalizeWorldContext({
    dateKey: "2026-03-29",
    weekday: 0,
    month: 3,
    weather: { cloudCover: 92, precipitation: 3, windSpeed: 28, isDay: 0 },
    market: { vixClose: 31, oilClose: 97 },
    sentiment: { fearGreed: 20 },
    sourceHealth: { weather: "ok", market: "ok", sentiment: "ok", crypto: "ok" },
    notes: [],
    crypto: { btc24hChange: -6.2, btcDominance: 61, totalVolumeUsd: 110000000000, totalMarketCapUsd: 2500000000000 },
  });

  assert.equal(snapshot.weatherMood, "oppressive");
  assert.equal(snapshot.marketStress, "high");
  assert.equal(snapshot.energyPressure, "high");
  assert.equal(snapshot.volatilityRegime, "high");
  assert.equal(snapshot.dominancePressure, "high");
  assert.ok(snapshot.activatedAxes.includes("system"));
  assert.ok(snapshot.activatedAxes.includes("crypto"));
});

test("scoring rewards non-repeated candidate", () => {
  const candidate = {
    text: "ZLE je když venku svítí jak duben, ale účty rostou rychlejc než energie a největší luxus je dneska obyčejnej klid.",
    opening: "ZLE je když",
    templateId: "tension_then_paradox",
    rhythm: "A, ale B",
    layers: [
      { axis: "weather", fragment: { axis: "weather", motif: "slunce_vs_únor", text: "venku svítí jak duben", tags: [] } },
      { axis: "system", fragment: { axis: "system", motif: "účty_vs_energie", text: "účty rostou rychlejc než energie", tags: [] } },
      { axis: "existential", fragment: { axis: "existential", motif: "paradox_klidu", text: "největší luxus je dneska obyčejnej klid", tags: [] } },
    ],
    motifs: ["slunce_vs_únor", "účty_vs_energie", "paradox_klidu"],
    tags: [],
  } as const;

  const score = scoreCandidate(candidate as any, []);
  assert.ok(score.total >= 7);
  assert.ok(score.depth >= 6);
  assert.ok(score.kryptoKamosFit >= 6);
});

test("validator blocks report-like numeric candidate", () => {
  const candidate = {
    text: "ZLE je když VIX 32 a ropa 98, takže to je chaos.",
    opening: "ZLE je když",
    templateId: "t",
    rhythm: "A",
    layers: [
      { axis: "world", fragment: { axis: "world", motif: "trhy_nervy", text: "trhy lítají", tags: [] } },
      { axis: "system", fragment: { axis: "system", motif: "drahota_klidu", text: "klid stojí víc než běžnej nákup", tags: [] } },
      { axis: "existential", fragment: { axis: "existential", motif: "adaptace_chaos", text: "zvykneš si na chaos", tags: [] } },
    ],
    motifs: ["trhy_nervy"],
    tags: [],
  } as const;

  const reasons = validateCandidate(candidate as any, []);
  assert.ok(reasons.includes("too_report_like") || reasons.includes("contains_hard_numeric_report"));
});
