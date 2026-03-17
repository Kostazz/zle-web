# TotalBoardShop Reconciliation (KROK 2)

## Purpose
KROK 2 adds a planning/intelligence layer on top of the existing safe KROK 1 pipeline. It is strictly planning-only:
- catalog index memory,
- deterministic delta detection,
- reconciliation outcomes,
- bootstrap replacement planning,
- incremental prioritization.

No destructive mutations are performed here.

## Bootstrap vs Incremental
- `bootstrap-replacement`
  - for the first replacement wave of legacy local ZLE set,
  - plans `CREATE`/`UPDATE`/`KEEP` and marks `ARCHIVE_CANDIDATE` only,
  - supports wave filters (`--category`, `--limit`).
- `incremental-sync`
  - optimized future mode,
  - prioritizes NEW and CHANGED work,
  - deprioritizes unchanged known products.

## Catalog Index
File-based index path:
- `tmp/catalog-index/zle-source-index.json`

The index stores per `sourceProductKey`:
- source identity,
- deterministic identity/content/image fingerprints,
- last matched local product id,
- last decision/reconciliation status.

The index is updated deterministically by key; collisions fail closed.

## Delta Fingerprints
Per source product we derive:
- `identityFingerprint`: brand/title/slug/category + structured identity fields.
- `contentFingerprint`: identity + description/sizes/options/price/tag.
- `imageFingerprint`: ordered image URL list + downloaded image path list.

Delta outcomes:
- `NEW`, `UNCHANGED`, `CHANGED_IDENTITY`, `CHANGED_CONTENT`, `CHANGED_IMAGES`, `AMBIGUOUS`.

## Reconciliation Outcomes
Planning outputs are per product:
- `CREATE`, `UPDATE`, `KEEP`, `ARCHIVE_CANDIDATE`, `REVIEW`.

Rules are conservative and deterministic:
- ambiguous or conflicting mapping => `REVIEW`,
- no silent replacement when multiple close local candidates exist,
- no delete/archive action is executed in this step.

## Why archive is candidate-only in v1
`ARCHIVE_CANDIDATE` is just a planning signal to help controlled migration from legacy catalog to source-grounded set. Actual archive/delete action remains out of scope.

## Artifacts
- reconciliation report:
  - `tmp/reconciliation/<runId>.reconciliation.json`
- updated index:
  - `tmp/catalog-index/zle-source-index.json`

## Commands
```bash
npm run photos:reconcile -- --run-id <id> --mode bootstrap-replacement
npm run photos:reconcile -- --run-id <id> --mode bootstrap-replacement --category mikiny --limit 20
npm run photos:reconcile -- --run-id <id> --mode incremental-sync
```

Optional planning budgets:
```bash
--max-candidates-per-run 100 \
--max-new-per-run 40 \
--max-changed-per-run 40 \
--max-review-per-run 20 \
--max-unchanged-to-inspect-per-run 10
```
