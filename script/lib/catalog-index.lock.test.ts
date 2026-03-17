import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeCatalogEntriesWithLock, readCatalogIndex } from "./catalog-index.ts";
import type { CatalogIndexEntry } from "./reconciliation-types.ts";

function makeEntry(key: string): CatalogIndexEntry {
  return {
    sourceProductKey: key,
    sourceUrl: "https://totalboardshop.cz/obchod/x/",
    sourceSlug: "x",
    brandNormalized: "zle",
    titleNormalized: "x",
    identityFingerprint: "sha256:i",
    contentFingerprint: "sha256:c",
    imageFingerprint: "sha256:m",
    matchedLocalProductId: null,
    lastSeenAt: new Date().toISOString(),
    lastDecision: null,
    lastReconciliation: null,
    lastPublishedAt: null,
    status: "unknown",
  };
}

test("catalog index lock recovers stale dead lock", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "catalog-lock-"));
  const indexPath = path.join(dir, "index.json");
  const lockPath = `${indexPath}.lock`;

  try {
    await fs.promises.writeFile(indexPath, JSON.stringify({ version: 1, updatedAt: new Date(0).toISOString(), entries: [] }), "utf8");
    const staleMeta = { pid: 999999, createdAtMs: Date.now() - 10 * 60 * 1000 };
    await fs.promises.writeFile(lockPath, JSON.stringify(staleMeta), "utf8");

    await mergeCatalogEntriesWithLock([makeEntry("k1")], indexPath);
    const index = await readCatalogIndex(indexPath);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0]?.sourceProductKey, "k1");
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("catalog index lock fails closed for dead but non-stale lock", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "catalog-lock-"));
  const indexPath = path.join(dir, "index.json");
  const lockPath = `${indexPath}.lock`;

  try {
    await fs.promises.writeFile(indexPath, JSON.stringify({ version: 1, updatedAt: new Date(0).toISOString(), entries: [] }), "utf8");
    const freshMeta = { pid: 999999, createdAtMs: Date.now() };
    await fs.promises.writeFile(lockPath, JSON.stringify(freshMeta), "utf8");

    await assert.rejects(mergeCatalogEntriesWithLock([makeEntry("k2")], indexPath), /not stale yet/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
