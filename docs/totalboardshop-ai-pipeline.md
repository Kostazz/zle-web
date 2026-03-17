# TotalBoardShop → ZLE AI Pipeline (KROK 1)

## Purpose
This step introduces a safe, fail-closed autonomous pipeline for **ZLE-only** product photo sourcing from TotalBoardShop. It is strictly limited to:
- source snapshot collection,
- staged ingest execution via existing ingest CLI,
- deterministic decisioning,
- optional guarded publish,
- hash-linked audit artifacts.

## Trust Boundaries
1. TotalBoardShop pages are untrusted input.
2. HTML content is treated as data only.
3. Long descriptions are captured, but never used as primary identity signal.
4. Only explicit trusted brand metadata (`Značka`) can admit a product into dataset.
5. Ambiguous or contradictory pages are skipped and logged.

## Why ZLE-only
The source crawler starts only from the ZLE brand listing page:
`https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding`

A product is included only if detail-page metadata confirms trusted ZLE brand values. Weak signals (slug/title containing “zle”, image names, marketing text) are intentionally ignored.

## Architecture (KROK 1)
- `script/source-totalboardshop-agent.ts` + `script/lib/source-totalboardshop.ts`
  - Fetches and parses ZLE listing + product details only.
  - Downloads allowlisted images into isolated `tmp/source-datasets/<runId>/images`.
- Existing ingest agent (`npm run photos:ingest`) is reused without behavioral change.
- `script/decision-agent.ts` + `script/lib/decision-agent.ts`
  - Deterministic policy engine returning `AUTO_APPROVE`, `REVIEW`, or `REJECT`.
- `script/totalboardshop-pipeline.ts` + `script/lib/pipeline-runner.ts`
  - Orchestrates source → staged ingest → decision → optional publish.
- `script/lib/audit-chain.ts`
  - Maintains hash-linked run audit trail.

## Directory Layout
`tmp/source-datasets/<runId>/`
- `dataset.json`
- `products.json`
- `crawl-log.json`
- `audit.json`
- `images/<sourceProductKey>/01.jpg ...`

## Artifacts
- Source dataset artifacts as above.
- Ingest report: `tmp/agent-reports/<runId>.json`
- Ingest manifest: `tmp/agent-manifests/<runId>.run.json`
- Decision: `tmp/agent-decisions/<runId>.decision.json`
- Optional publish log: `tmp/publish-logs/<runId>.json`

## Commands
```bash
npm run source:totalboardshop -- --run-id tbs-20260101-120000-abcdef
npm run photos:ingest -- --input tmp/source-datasets/<runId>/images --staged --source-type manual --run-id <runId>
npm run photos:decision -- --run-id <runId>
npm run pipeline:totalboardshop -- --staged-only
npm run pipeline:totalboardshop -- --publish-approved
```

## Fail-closed Principles
- HTTPS + host allowlist enforcement.
- Redirects are blocked by default.
- Unsupported content types and oversized payloads are rejected.
- Non-ZLE or ambiguous products are skipped with reason codes.
- Publish requires both explicit `--publish-approved` and `AUTO_APPROVE`.
- Decision agent never publishes; publisher never decides policy.

## Audit Chain v1
Audit is plain JSON (not blockchain). Each run stores artifact hashes and links to prior run hash:
- source artifacts: dataset/products/crawl-log,
- ingest report,
- decision manifest,
- ingest run manifest,
- publish log (if present).

`currentRunHash` is deterministic from run ID + artifact hashes + `previousRunHash`.

## Non-goal Reminder
This step does **not** include style rewriting, LLM copy adaptation, frontend publishing, DB writes, blockchain, or non-ZLE catalog crawling.
