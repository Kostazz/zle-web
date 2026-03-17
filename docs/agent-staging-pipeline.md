# Agent staging pipeline

## Purpose

Pipeline je staged-first a fail-closed pro ingest produktových assetů.

## Safety contract

- Inbox je untrusted data zone.
- Inbox sidecar (`.txt/.md/.json`) nikdy neřídí publish stav, output path ani product routing.
- Prompt-injection text v názvech/metadata se jen reportuje jako suspicious input.
- Symlinky se nepoužijí pro ingest.
- Path traversal/escape pokusy jsou blokované canonical path kontrolou.
- Každý write (assets/report/summary/review/manifest) se validuje těsně před zápisem, včetně kontroly symlink parent chain.

## Directory layers

- `tmp/agent-staging/<runId>` – staged outputs
- `tmp/agent-reports/<runId>.json` + `.summary.md` – machine/human report
- `tmp/agent-manifests/<runId>.run.json` – run manifest
- `tmp/agent-review/<runId>/review.json` – review queue pro unmatched/suspicious/errors

## Publish guard

- Výchozí ingest je staged.
- Live write je možný jen s explicitním `--direct`.
- `--direct` výstup je hard-whitelisted na `client/public/images/products` (ne libovolná cesta).
- legacy pattern `staged:false` bez explicitního direct módu je rejectnutý (nelze tím obejít live guard).
- Nejednoznačný/unmatched/suspicious vstup se nikdy nepublikuje.

## Operator workflow (safe)

1. Spustit staged ingest.
2. Zkontrolovat JSON + summary report.
3. Zpracovat review queue položky.
4. Teprve po kontrole spustit explicitní direct režim.
