# TotalBoardShop → ZLE AI Pipeline

## Purpose
This pipeline remains a safe, fail-closed, layered flow for **ZLE-only** product sourcing from TotalBoardShop. The repository now includes a dedicated curation/review foundation between source collection and downstream ingest/publish concerns.

Current covered layers are:
- source snapshot collection,
- deterministic curation/review planning,
- approved-only staging execution,
- publish gate / release authority decisions,
- staged ingest execution via existing ingest CLI,
- deterministic decisioning,
- explicit manual publish execution,
- optional legacy guarded publish,
- hash-linked audit artifacts.

## Layered Architecture
1. **Source layer**
   - `script/source-totalboardshop-agent.ts` + `script/lib/source-totalboardshop.ts`
   - Collects ZLE-only source snapshots into `tmp/source-datasets/<runId>/`.
2. **Curation layer**
   - `script/curate-totalboardshop.ts` + `script/lib/curation-agent.ts`
   - Reads source artifacts, reuses reconciliation logic, and emits review-first planning artifacts in `tmp/curation/`.
   - Does not stage, publish, touch live assets, or write to DB.
3. **Review decision layer**
   - `script/review-totalboardshop.ts` + `script/lib/review-decision-agent.ts`
   - Loads curation artifacts, validates a strict human-authored review manifest, and writes normalized review-decision artifacts in `tmp/review-decisions/`.
   - Acts as the authoritative human checkpoint before any future staging/publish work.
   - Does not stage, publish, touch live assets, or write to DB.
4. **Staging layer**
   - `script/stage-totalboardshop-reviewed.ts` + `script/lib/staging-review-executor.ts`
   - Loads source + curation + authoritative review artifacts and stages only review-approved items into `tmp/agent-staging/`.
   - Writes execution manifests only into `tmp/agent-manifests/`.
   - Does not publish, write live assets, or perform live swaps.
5. **Publish gate / release authority layer**
   - `script/publish-gate-totalboardshop.ts` + `script/lib/publish-gate-agent.ts`
   - Loads authoritative review decisions plus staging results and determines which staged items are explicitly approved for a future publish window.
   - Writes normalized release-authority artifacts only into `tmp/publish-gates/`.
   - Does not publish, perform live swaps, or write live assets.
6. **Manual publish executor layer**
   - `script/publish-totalboardshop-reviewed.ts` + `script/lib/manual-publish-executor.ts`
   - Loads a validated publish gate manifest plus the staging execution report, selects only `ready_for_publish` + `eligible` + successfully staged items, and publishes only through the managed live asset root.
   - This is the first and only layer in this flow allowed to write live assets.
   - Writes publish reports only to `tmp/publish-reports/`.
7. **Legacy publish layer**
   - Existing guarded publish path for the older ingest pipeline remains separate.

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

## Architecture
- `script/source-totalboardshop-agent.ts` + `script/lib/source-totalboardshop.ts`
  - Fetches and parses ZLE listing + product details only.
  - Downloads allowlisted images into isolated `tmp/source-datasets/<runId>/images`.
- `script/curate-totalboardshop.ts` + `script/lib/curation-agent.ts`
  - Runs the review-first curation layer between source artifacts and downstream processing.
  - Reuses reconciliation logic without calling staging or publish code.
- `script/review-totalboardshop.ts` + `script/lib/review-decision-agent.ts`
  - Validates the authoritative human review decision manifest with fail-closed runtime checks.
  - Produces normalized `approved` / `rejected` / `hold` outputs without calling staging or publish code.
- `script/stage-totalboardshop-reviewed.ts` + `script/lib/staging-review-executor.ts`
  - Executes a strict staging-only layer after review authority.
  - Stages only `approved` items, rejects malformed/missing source image inputs, and writes manifests under `tmp/agent-manifests/`.
- `script/publish-gate-totalboardshop.ts` + `script/lib/publish-gate-agent.ts`
  - Executes the release-authority layer after staging.
  - Validates that only review-approved, successfully staged items can receive release decisions and emits normalized gate artifacts in `tmp/publish-gates/`.
  - Never calls publish code and never writes to `client/public/images/products`.
- `script/publish-totalboardshop-reviewed.ts` + `script/lib/manual-publish-executor.ts`
  - Executes strict manual publish from a validated publish gate manifest plus staged artifacts only.
  - Fails closed on malformed artifacts, missing staged outputs, collisions, unsafe paths, or writes outside the managed live root / `tmp/publish-reports`.
  - Supports `--validate-only` planning without live writes.
  - Supports clean-room publish targets under `tmp/remigration/live-targets/<cleanRoomRunId>/products` via `--clean-room-run-id`.
  - Clean-room mode fails closed on non-empty targets and never writes into `client/public/images/products`.
  - On fail-closed validation errors, the CLI still emits fail-closed report artifacts in `tmp/publish-reports/`.
- `script/verify-clean-room-product-assets-root.ts`
  - Verifies a clean-room target (`tmp/remigration/live-targets/<runId>/products`) before any cutover.
  - Writes machine-readable + markdown reports into `tmp/remigration/reports/`.
- `script/switch-product-assets-root.ts`
  - Performs root-level cutover from clean-room target to live root with rename-based switch and backup in `tmp/remigration/backups/<backupId>/`.
  - Adds global switch lock (`tmp/remigration/.switch-lock`), in-progress marker (`tmp/remigration/.switch-in-progress`), unified readiness preflight, post-switch sanity check, and automatic rollback attempt.
  - Writes runtime signal `client/public/.assets-version.json` after successful v2 switch.
- `script/verify-product-assets-root.ts`
  - Post-switch validation for `client/public/images/products`.
  - Fails closed on empty roots, missing cover files, malformed product directories, missing/malformed `client/public/.assets-version.json`, and non-empty fallback root `public/images/products` (unless explicitly bypassed).
- `script/remigrate-totalboardshop-clean-room.ts`
  - Small explicit orchestration wrapper for validate publish → clean-room publish → clean-room verify → switch → post-switch verify.
  - Adds resumable state (`tmp/remigration/runs/<runId>.state.json`) and skips already-completed steps.
  - Runs retention only after full success.
- `script/lib/remigration-retention.ts`
  - Retention for `tmp/remigration/live-targets`, `tmp/remigration/backups`, `tmp/remigration/runs`, and `client/public/images/product-versions`.
- `script/promote-clean-room-to-product-version.ts`
  - v3 promotion path from clean-room run to immutable version root `client/public/images/product-versions/<versionId>/`.
- `script/activate-product-assets-version.ts`
  - v3 pointer activation via `client/public/.active-product-assets.json`.
- `script/verify-product-assets-version-root.ts` / `script/verify-active-product-assets.ts`
  - v3 verification for version roots and active pointer validity.
- Existing ingest agent (`npm run photos:ingest`) remains available for the older generic ingest path without behavioral change.
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
- Curation report: `tmp/curation/<runId>.curation.json`
- Curation review queue: `tmp/curation/<runId>.review-queue.json`
- Curation summary: `tmp/curation/<runId>.summary.md`
- Review decision manifest: `tmp/review-decisions/<runId>.review.json`
- Review decision summary: `tmp/review-decisions/<runId>.summary.md`
- Approved staging report: `tmp/agent-manifests/<runId>.staging.json`
- Approved staging summary: `tmp/agent-manifests/<runId>.staging-summary.md`
- Approved staged outputs: `tmp/agent-staging/<runId>/...`
- Publish gate manifest: `tmp/publish-gates/<runId>.publish-gate.json`
- Publish gate summary: `tmp/publish-gates/<runId>.summary.md`
- Manual publish report: `tmp/publish-reports/<runId>.publish.json`
- Manual publish summary: `tmp/publish-reports/<runId>.summary.md`
- Clean-room verify reports: `tmp/remigration/reports/*-verify-clean-room.{json,md}`
- Root switch reports: `tmp/remigration/reports/*-switch.{json,md}`
- Post-switch verify reports: `tmp/remigration/reports/*-verify.{json,md}`
- v2 run state: `tmp/remigration/runs/<runId>.state.json`
- v2 runtime signal: `client/public/.assets-version.json`
- v3 active pointer: `client/public/.active-product-assets.json`
- v3 immutable roots: `client/public/images/product-versions/<versionId>/...`
- Ingest report: `tmp/agent-reports/<runId>.json`
- Ingest manifest: `tmp/agent-manifests/<runId>.run.json`
- Decision: `tmp/agent-decisions/<runId>.decision.json`
- Optional publish log: `tmp/publish-logs/<runId>.json`

## Commands
```bash
npm run source:totalboardshop -- --run-id tbs-20260101-120000-abcdef
npm run photos:curate -- --run-id <runId>
npm run photos:review -- --run-id <runId> --write-template
npm run photos:review -- --run-id <runId> --validate-only
npm run photos:stage-reviewed -- --run-id <runId> --validate-only
npm run photos:stage-reviewed -- --run-id <runId>
npm run photos:publish-gate -- --run-id <runId> --write-template
npm run photos:publish-gate -- --run-id <runId> --validate-only
npm run photos:publish-gate -- --run-id <runId>
npm run photos:publish-reviewed -- --run-id <runId> --validate-only
npm run photos:publish-reviewed -- --run-id <runId>
npm run photos:publish-reviewed -- --run-id <runId> --clean-room-run-id <cleanRoomRunId>
npm run photos:verify-clean-room-assets-root -- --run-id <cleanRoomRunId>
npm run photos:switch-assets-root -- --run-id <cleanRoomRunId> --backup-id <backupId>
npm run photos:verify-assets-root -- --run-label <runId>
npm run photos:remigrate-clean-room -- --run-id <runId> --clean-room-run-id <cleanRoomRunId> --step full
npm run photos:promote-clean-room-version -- --run-id <cleanRoomRunId> --version-id <versionId>
npm run photos:verify-version-root -- --version-id <versionId>
npm run photos:activate-assets-version -- --version-id <versionId> --source-run-id <runId>
npm run photos:verify-active-assets
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

## Review-First Scope Reminder
The curation layer plus the human review decision layer are review-first only. The review decision manifest is the authoritative human checkpoint and must explicitly mark each included item as `approved`, `rejected`, or `hold`. `approved` items must resolve to exactly one target mode: `map_to_existing` with a valid local product ID, or `new_candidate`.

The approved-only staging layer is a separate executor after that review checkpoint. It:
- processes only `approved` items,
- stages only into `tmp/agent-staging`,
- writes reports only into `tmp/agent-manifests`,
- never publishes,
- never writes to `client/public/images/products`,
- never performs live swaps or DB writes.

The publish gate layer is a second explicit checkpoint after staging. It:
- loads the authoritative review manifest plus the staging execution report,
- considers only successfully staged items,
- computes eligibility from staged outputs,
- records explicit release decisions (`ready_for_publish`, `hold`, `reject_release`),
- writes only to `tmp/publish-gates`,
- still does **not** publish or write live assets.

The explicit manual publish executor is the next and only live-writing layer. It:
- requires a valid publish gate manifest plus the staging execution report,
- selects only items with `releaseDecision = ready_for_publish`, `eligibilityStatus = eligible`, and staging status `staged`,
- validates staged output completeness and path safety before any live swap,
- writes live assets only inside `client/public/images/products`,
- writes execution reports only to `tmp/publish-reports`,
- supports `npm run photos:publish-reviewed -- --run-id <runId> --validate-only` for full planning validation without live writes.
- supports clean-room publishes with `npm run photos:publish-reviewed -- --run-id <runId> --clean-room-run-id <cleanRoomRunId>` into `tmp/remigration/live-targets/<cleanRoomRunId>/products`.
- in clean-room mode, non-empty targets fail closed and default live root is untouched.
- on fail-closed validation errors, the CLI still writes a failure report + summary under `tmp/publish-reports`.

## v2 vs v3 delivery model
- **v2 root-switch**: clean-room publish + root rename cutover + rollback; strongest for strict cutover, small non-atomic window mitigated by lock/marker/preflight/sanity checks.
- **v3 versioned assets**: immutable version roots + active pointer manifest; no live-root rename, pointer activation enables faster rollback by re-pointing version.
- Public storefront URLs remain unchanged (`/images/products/<productId>/<file>`). v3 resolves these URLs through active version pointer in server resolver mode.

## Non-goal Reminder
This pipeline does **not** include style rewriting, LLM copy adaptation, frontend publishing changes, DB writes, blockchain, or non-ZLE catalog crawling.
