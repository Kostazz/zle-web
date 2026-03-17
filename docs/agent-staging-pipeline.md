# Agent staging pipeline

## Purpose

This project now contains a safe filesystem-based staging pipeline for two future agents:

1. **Asset Router Agent**
   - Reads product photos from a source (future Google Drive for `zleshop.admin@gmail.com`).
   - Classifies, deduplicates and matches assets to product IDs.
   - Works only through staged review flow.

2. **Product Enricher Agent**
   - Proposes text metadata (`title`, `description`, `sizes`, `price`, `sourceUrl`, aliases, notes).
   - Writes only draft/review payloads.
   - Never performs direct live publish.

## Why staging/review/publish

Direct publish from source inbox is intentionally blocked because ingest is noisy and requires human validation. The pipeline is split into strict layers:

- source ingestion
- matching and dedupe
- review metadata
- approval state
- publish

**Inbox/staging can never publish directly to production assets.**

## Local directories

- `tmp/agent-staging` - staged image outputs by run ID
- `tmp/agent-manifests` - run manifests + asset index for dedupe
- `tmp/agent-reports` - detailed ingest reports

## Suggested Google Drive folder layout (future)

- `00_INBOX`
- `10_STAGING_MATCHED`
- `20_REVIEW`
- `30_APPROVED`
- `40_PUBLISHED`
- `90_UNMATCHED`
- `99_ERRORS`

The adapter boundary already supports this model, but no live Google Drive auth/client is implemented in this step.

## Approval guard

Publish is explicit and fail-closed:

- `pending` or `rejected` run => publish denied.
- only `approved` run => allowed to publish.
- publish route is separated from ingest and is the authoritative path to final assets.
