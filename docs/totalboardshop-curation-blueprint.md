# TotalBoardShop Curation Blueprint (KROK 6.1 / 6.2 / 6.3 Foundation)

## Purpose
This layer inserts a strict, deterministic, fail-closed review boundary between:
- the TotalBoardShop source snapshot, and
- the existing staged ingest / publish pipeline.

The first implementation is **review-first only**. The follow-up executor adds an approved-only staging step, and the next release-authority layer adds a publish gate, but neither layer publishes, mutates the live asset tree, or writes to the database.

## Layer Separation
1. **Source layer**
   - Collects a trusted ZLE-only source snapshot into `tmp/source-datasets/<runId>/`.
   - Implemented by the existing source agent.
2. **Curation layer**
   - Reads source artifacts and local catalog context.
   - Reuses deterministic reconciliation logic to propose local mappings.
   - Produces a curation report and a human review queue.
   - Writes only to `tmp/curation/`.
3. **Review decision layer**
   - Loads curation artifacts and constructs or validates a human-editable review manifest.
   - The review manifest is the authoritative human checkpoint before any future staging work.
   - Writes only to `tmp/review-decisions/`.
   - Never stages or publishes.
4. **Staging layer**
   - `script/stage-totalboardshop-reviewed.ts` runs after authoritative review.
   - It stages only approved items and writes only to `tmp/agent-staging/` and `tmp/agent-manifests/`.
   - It is not called by the curation CLI.
5. **Publish gate / release authority layer**
   - `script/publish-gate-totalboardshop.ts` runs only after authoritative review and successful staging.
   - It validates release decisions for staged items and writes only to `tmp/publish-gates/`.
   - It never calls publish code or writes live assets.
6. **Publish layer**
   - Existing publish path remains separate and unchanged.
   - Never called by the curation layer.

## Deterministic Curation Decisions
Per product, the curation layer returns one of:
- `ACCEPT_CANDIDATE`
- `REVIEW_REQUIRED`
- `REJECTED`

The rules are intentionally conservative:
- non-`zle` brand => `REJECTED`
- malformed or unstable source identity => `REJECTED`
- reconciliation review outcome => `REVIEW_REQUIRED`
- ambiguous/conflicting mapping signals => `REVIEW_REQUIRED`
- weak signals never auto-accept
- clean deterministic matching or valid new candidate => `ACCEPT_CANDIDATE`

## Artifacts
For a run ID `<runId>` the curation layer writes:
- `tmp/curation/<runId>.curation.json`
- `tmp/curation/<runId>.review-queue.json`
- `tmp/curation/<runId>.summary.md`

Human review decision artifacts are represented by:
- `tmp/review-decisions/<runId>.review.json`
- `tmp/review-decisions/<runId>.summary.md`

Approved-only staging artifacts are represented by:
- `tmp/agent-manifests/<runId>.staging.json`
- `tmp/agent-manifests/<runId>.staging-summary.md`
- `tmp/agent-staging/<runId>/...`

Publish gate artifacts are represented by:
- `tmp/publish-gates/<runId>.publish-gate.json`
- `tmp/publish-gates/<runId>.summary.md`


## Human Review Decision Manifest (KROK 6.4)
The review decision layer formalizes authoritative human choices for items that require review or are eligible for explicit override. The manifest is strict, minimal, and human-editable:

```json
{
  "runId": "<runId>",
  "createdAt": "<iso8601>",
  "sourceRunId": "<sourceRunId>",
  "decisions": [
    {
      "sourceProductKey": "<sourceProductKey>",
      "decision": "hold",
      "resolutionType": null,
      "operatorNotes": "optional"
    }
  ]
}
```

Decision semantics:
- `approved` => must also choose exactly one resolution type:
  - `map_to_existing` with `approvedLocalProductId` pointing at an existing local catalog product
  - `new_candidate` with no `approvedLocalProductId`
- `rejected` => item is explicitly declined and cannot carry a target product ID
- `hold` => item remains unresolved and cannot carry a target product ID

Validation is fail-closed:
- every decision must reference an existing `sourceProductKey` from the curation report
- duplicate decisions fail
- malformed JSON, unknown fields, or invalid shapes fail
- non-review-eligible rejected items cannot be reintroduced here
- conflicting approvals that map multiple source items to the same local product fail

This layer still does **not** execute staging or publish work.

## Approved-Only Staging Executor (KROK 6.5)
The new staging executor is a distinct downstream layer after review authority:

- Inputs:
  - `tmp/source-datasets/<runId>/...`
  - `tmp/curation/<runId>.curation.json`
  - `tmp/review-decisions/<reviewRunId>.review.json`
- Output roots:
  - `tmp/agent-staging`
  - `tmp/agent-manifests`

Rules:
- only `approved` review items are selected
- `rejected` and `hold` items are ignored
- `map_to_existing` requires a valid local product ID
- `new_candidate` must not include a local product ID
- missing or malformed source image paths fail closed per item
- staging target collisions fail closed
- any path outside the allowed tmp roots fails closed
- no publish code is invoked
- no writes are allowed to `client/public/images/products`

This keeps review authority and execution authority separated: the human manifest decides eligibility, and the staging executor performs only the bounded staging work.


## Publish Gate / Release Authority Layer (KROK 6.6)
The publish gate is a separate authority checkpoint after both review approval and approved-only staging. Its job is to decide which already staged items are allowed to enter a future publish batch. It does **not** publish.

Inputs:
- `tmp/review-decisions/<runId>.review.json`
- `tmp/agent-manifests/<runId>.staging.json`
- `tmp/curation/<runId>.curation.json` for lineage validation

Outputs:
- `tmp/publish-gates/<runId>.publish-gate.json`
- `tmp/publish-gates/<runId>.summary.md`

Rules:
- only review-`approved` items with staging status `staged` are eligible for gate consideration
- each staged item must appear exactly once in the publish gate manifest
- release decisions are limited to `ready_for_publish`, `hold`, or `reject_release`
- `ready_for_publish` is allowed only when staged outputs are complete and fully match the planned outputs
- missing or mismatched staged outputs block release approval
- batch target/output collisions fail closed
- malformed JSON, unknown fields, or shape violations fail closed
- all writes are restricted to `tmp/publish-gates`

This keeps review approval and release approval as distinct checkpoints: human review authorizes staging, and the publish gate authorizes only a future publish candidate set.

## CLI
```bash
npm run photos:curate -- --run-id <runId>
npm run photos:review -- --run-id <runId> --write-template
npm run photos:review -- --run-id <runId> --validate-only
npm run photos:stage-reviewed -- --run-id <runId> --validate-only
npm run photos:stage-reviewed -- --run-id <runId>
npm run photos:publish-gate -- --run-id <runId> --write-template
npm run photos:publish-gate -- --run-id <runId> --validate-only
npm run photos:publish-gate -- --run-id <runId>
npm run photos:curate -- --run-id <runId> --mode incremental-sync
npm run photos:curate -- --run-id <runId> --category mikina --limit 10
```

## Fail-Closed Guarantees
- Missing required source artifacts cause an explicit error.
- Invalid JSON causes an explicit error.
- Run ID mismatches across artifacts cause an explicit error.
- No publish action is executed.
- Review/curation layers execute no staging action.
- Approved-only staging writes only to `tmp/agent-staging` and `tmp/agent-manifests`.
- Publish gate writes only to `tmp/publish-gates`.
- Review decisions fail closed on invalid or ambiguous manifests.
- Publish gate decisions fail closed on invalid, blocked, or colliding release batches.
- No live asset writes occur.
- No writes occur outside the designated tmp roots for each layer.

## Non-Goals
This foundation does **not** implement:
- auto-publish
- direct live asset writes
- DB writes or migrations
- frontend UI
- runtime product creation
- payment, watchdog, OPS auth, or publish changes
