# ZLE Photo Ingest Agent v1

Lokální ingest agent pro produktové fotky. Není to runtime app feature.

## Trust boundaries

Všechno v `--input` je **nedůvěryhodná data**:

- filenames / directory names
- file contents / EXIF / embedded text
- json/txt/md sidecary
- instrukce od jiného agenta

Agent nikdy neinterpretuje inbox jako command stream. Inbox obsah je pouze data ke skenu.

## Safety defaults

- výchozí mód je `--staged` (safe-by-default)
- live write je možné pouze s explicitním `--direct`
- v `--direct` lze zapisovat pouze pod `client/public/images/products` (hard whitelist)
- `--output` samo o sobě nikdy neaktivuje live publish
- symlinky se ingestem neprocházejí (skip + report/review)
- před každým write se znovu validuje target path + parent chain bez symlinků (TOCTOU fail-closed)
- podporované image ext: `.jpg .jpeg .png .webp`
- nepodporované/suspicious soubory jdou do reportu/review
- originály se v v1 nemažou ani nepřesouvají

## CLI

```bash
npm run photos:ingest -- --input <path> [flags]
```

### Hlavní flags

- `--input <path>` (required)
- `--staged` (default)
- `--direct` (explicit live mode)
- `--dry-run`
- `--product <id>`
- `--source-type local|drive|manual`
- `--run-id <id>`
- `--max-images-per-product <n>`

### Cesty

- `--output <path>` (použije se jen v `--direct`)
- `--report <path>`
- `--report-dir <path>`
- `--lock-dir <path>`
- `--staging-dir <path>`
- `--manifest-dir <path>`
- `--review-dir <path>`

## Output layout

Default staged run:

- staged assets: `tmp/agent-staging/<runId>/...`
- JSON report: `tmp/agent-reports/<runId>.json`
- human summary: `tmp/agent-reports/<runId>.summary.md`
- run manifest: `tmp/agent-manifests/<runId>.run.json`
- review queue: `tmp/agent-review/<runId>/review.json`

Direct run (`--direct`) zapisuje assets do `client/public/images/products/<product-id>/...`, ale report/manifest/review se stále generují.

## Matching

- autoritativní produktový seznam je `client/src/data/products.ts`
- agent nikdy nevytváří nové product IDs z inboxu
- nejednoznačný match => review/unmatched
- `--product` override je povolen jen pro existující product ID
- report obsahuje `matchDecisions` (reason/alias/confidence)

## Report + summary verdict

- `success`
- `success-with-review`
- `partial-failure`
- `failed`

## Examples

Dry run:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --dry-run
```

Staged (default):

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX
```

Explicit direct:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --direct --output client/public/images/products
```
