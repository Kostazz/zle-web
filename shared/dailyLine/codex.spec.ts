import test from "node:test";
import assert from "node:assert/strict";
import { runDailyLineCodex } from "./engine";

test("codex generates deterministic line for same date and history", () => {
  const history = [
    { date: "2026-03-27", text: "ZLE je když klid stojí víc než nákup." },
    { date: "2026-03-28", text: "ZLE je když svět křičí a ty držíš ticho." },
  ];

  const a = runDailyLineCodex({ date: "2026-03-29", history, candidateCount: 30 });
  const b = runDailyLineCodex({ date: "2026-03-29", history, candidateCount: 30 });

  assert.equal(a.line, b.line);
});

test("codex avoids recent line overlap", () => {
  const history = [
    { date: "2026-03-28", text: "ZLE je když venku svítí jak duben, uvnitř je pořád únor." },
    { date: "2026-03-27", text: "ZLE je když klid stojí víc než běžnej nákup." },
  ];

  const result = runDailyLineCodex({ date: "2026-03-29", history, candidateCount: 30 });
  assert.ok(!history.some((item) => item.text === result.line));
  assert.ok(result.selected.score.depth >= 6);
  assert.ok(result.selected.score.antiRepeat >= 4);
});
