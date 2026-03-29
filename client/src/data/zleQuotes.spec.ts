import test from "node:test";
import assert from "node:assert/strict";
import { getImmediateTodayQuote } from "./zleQuotes";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

test("immediate quote fallback returns render-ready quote synchronously", () => {
  (globalThis as any).localStorage = new MemoryStorage();
  const quote = getImmediateTodayQuote();
  assert.ok(quote.dailyLine.length > 10);
  assert.equal(typeof quote.dailyLine, "string");
});
