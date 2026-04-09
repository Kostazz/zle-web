# TotalBoardShop Operator Playbook

## Purpose
This playbook is the operator-facing checklist for the reviewed TotalBoardShop → ZLE publish chain: curation, review, reviewed staging, publish gate, manual publish, and lineage proof.

## Trust boundaries
- `script/curate-totalboardshop.ts` only writes curation artifacts under `tmp/curation/`.
- `script/review-totalboardshop.ts` only writes review artifacts under `tmp/review-decisions/`.
- `script/stage-totalboardshop-reviewed.ts` only writes reviewed staging outputs under `tmp/agent-staging/` and `tmp/agent-manifests/`.
- `script/publish-gate-totalboardshop.ts` only writes release-control artifacts under `tmp/publish-gates/`.
- `script/publish-totalboardshop-reviewed.ts` is the only layer allowed to touch the managed live asset root.
- `script/lineage-proof-totalboardshop.ts` is audit-only and writes under `tmp/lineage/`.

## Standard happy path
1. Run curation for the source run.
2. Generate a review template, complete operator decisions, then validate the review manifest.
3. Run reviewed staging and confirm `staged > 0` with no failed items.
4. Generate and finalize the publish gate manifest, then validate it.
5. Run lineage proof across the source, review, staging, and gate run ids.
6. Execute manual publish only after lineage passes.
7. Verify publish report and summary in `tmp/publish-reports/`.

## Clean remigration path (assets root switch)
1. Run reviewed publish validation:
   - `npm run photos:publish-reviewed -- --run-id <runId> --validate-only`
2. Publish reviewed batch into clean-room target:
   - `npm run photos:publish-reviewed -- --run-id <runId> --clean-room-run-id <cleanRoomRunId>`
3. Verify clean-room target before cutover:
   - `npm run photos:verify-clean-room-assets-root -- --run-id <cleanRoomRunId>`
4. Execute root-level switch (with backup):
   - `npm run photos:switch-assets-root -- --run-id <cleanRoomRunId> --backup-id <backupId>`
5. Run post-switch verify:
   - `npm run photos:verify-assets-root -- --run-label <runId>`

Optional explicit orchestration:
- `npm run photos:remigrate-clean-room -- --run-id <runId> --clean-room-run-id <cleanRoomRunId> --step full`

V2 hardening notes:
- switch uses `tmp/remigration/.switch-lock` (30 min stale recovery) and `tmp/remigration/.switch-in-progress`.
- orchestration persists step state in `tmp/remigration/runs/<runId>.state.json` and resumes incomplete full-runs.
- live verify now blocks non-empty `public/images/products` fallback by default (`--allow-non-empty-fallback` exists only as explicit bypass).
- successful switch writes `client/public/.assets-version.json`; live verify requires valid signal.

## Validate-only path
- Use validate-only when confirming manifest integrity, lineage, or publish readiness without live writes.
- Validate-only publish must produce a publish report but must not add, delete, or overwrite managed live outputs.
- If validate-only exposes missing staged outputs, collisions, or lineage mismatches, stop and fix those artifacts before a live publish attempt.

## What to do on hold
- Treat `hold` as a deliberate stop, not a soft approval.
- Review operator notes in the review or publish gate artifact.
- Resolve the ambiguity, update the artifact, and re-run validation before continuing.

## What to do on reject release
- Do not publish the rejected item.
- Capture the reason in the gate manifest and keep the batch fail-closed.
- Either remove the item from the release batch intentionally or correct the upstream artifact chain and generate a new gate decision.

## What to do on lineage mismatch
- Stop the run immediately.
- Compare `sourceRunId`, `reviewRunId`, `stagingRunId`, and `gateRunId` across the JSON artifacts.
- Rebuild the downstream artifact from the last trusted upstream checkpoint rather than hand-editing lineage fields.
- Re-run lineage proof and proceed only on a `pass` verdict.

## What to do on collision / lock failure
- If manual publish reports an active lock, assume another publish is in progress and do not force through it.
- If a stale lock is recovered automatically, review the publish report before retrying.
- If collisions or cleanup failures occur, treat the publish as failed closed and investigate the managed live target before another attempt.

## What to do on clean-room target guard failure
- If clean-room publish fails with a non-empty target guard, do **not** reuse that target.
- Allocate a new `cleanRoomRunId` (recommended) or manually clear the target and rerun with explicit `--allow-existing-empty-clean-room-target`.
- Never merge or overwrite into existing clean-room content.

## What to do on switch/rollback failure
- Treat switch failure as high priority and consult `tmp/remigration/reports/*.json`.
- If rollback succeeded, live root should still point at previous assets; confirm with post-switch verify.
- If rollback failed, stop all publishes immediately and restore from backup root in `tmp/remigration/backups/<backupId>/` using a controlled maintenance window.

## V3 versioned assets (parallel path)
Use this path only when explicitly adopting v3 resolver mode:
1. Publish reviewed batch to clean-room root (same as v2 pre-cutover).
2. Promote clean-room to immutable version root:
   - `npm run photos:promote-clean-room-version -- --run-id <cleanRoomRunId> --version-id <versionId>`
3. Verify version root:
   - `npm run photos:verify-version-root -- --version-id <versionId>`
4. Activate version pointer:
   - `npm run photos:activate-assets-version -- --version-id <versionId> --source-run-id <runId>`
5. Verify active pointer:
   - `npm run photos:verify-active-assets`

Poznámka:
- Aktivace je fail-closed a vyžaduje validní version root (min. 1 product dir + cover.jpg/cover.webp pro každý product dir).
- `verify-active-assets` je integrity check aktivní verze (ne jen existence pointeru).

Rollback in v3:
- activate previous valid `versionId` again (pointer rewrite only, no live root rename).

## What to do on missing staged outputs
- Treat missing staged outputs as a blocking integrity error.
- Re-run reviewed staging from the approved review artifact instead of copying files manually.
- Rebuild the publish gate manifest after staging is healthy again.

## Recovery after failed run
- Use the failure JSON and markdown summaries emitted by the failing layer as the source of truth for triage.
- Fix the earliest broken layer first.
- Re-run downstream layers in order: review → staging → gate → lineage proof → publish.
- Do not reuse a broken downstream artifact after its upstream dependency changes.

## Managed directories that operators should not hand-edit
- `tmp/curation/`
- `tmp/review-decisions/`
- `tmp/agent-staging/`
- `tmp/agent-manifests/`
- `tmp/publish-gates/`
- `tmp/publish-reports/`
- `tmp/lineage/`
- `tmp/remigration/live-targets/`
- `tmp/remigration/backups/`
- `tmp/remigration/reports/`
- `tmp/remigration/runs/`
- `client/public/.assets-version.json`
- `client/public/.active-product-assets.json`
- `client/public/images/product-versions/`
- `client/public/images/products/`
