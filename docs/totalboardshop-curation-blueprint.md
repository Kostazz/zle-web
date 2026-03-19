# TotalBoardShop Curation Blueprint (KROK 6.1 / 6.2 / 6.3 Foundation)

## Purpose
This layer inserts a strict, deterministic, fail-closed review boundary between:
- the TotalBoardShop source snapshot, and
- the existing staged ingest / publish pipeline.

The first implementation is **review-first only**. It does not publish, stage, mutate the live asset tree, or write to the database.

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
   - Existing staged ingest flow remains separate and unchanged.
   - Not called by the curation CLI.
5. **Publish layer**
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

## CLI
```bash
npm run photos:curate -- --run-id <runId>
npm run photos:review -- --run-id <runId> --write-template
npm run photos:review -- --run-id <runId> --validate-only
npm run photos:curate -- --run-id <runId> --mode incremental-sync
npm run photos:curate -- --run-id <runId> --category mikina --limit 10
```

## Fail-Closed Guarantees
- Missing required source artifacts cause an explicit error.
- Invalid JSON causes an explicit error.
- Run ID mismatches across artifacts cause an explicit error.
- No publish action is executed.
- No staging action is executed.
- Review decisions fail closed on invalid or ambiguous manifests.
- No writes occur outside `tmp/curation` and `tmp/review-decisions`.

## Non-Goals
This foundation does **not** implement:
- auto-publish
- direct live asset writes
- DB writes or migrations
- frontend UI
- runtime product creation
- payment, watchdog, OPS auth, or publish changes
