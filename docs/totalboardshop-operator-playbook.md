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
- `client/public/images/products/`
