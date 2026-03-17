# ZLE Photo Ingest Agent v1

Lokální ops nástroj pro bezpečný ingest produktových fotek. Je to čistě script vrstva – **nezasahuje do runtime references produktů, checkout/payment/DB/routes flow**.

## Co nástroj dělá

- rekurzivně načte `--input`
- vezme pouze `.jpg`, `.jpeg`, `.png`, `.webp`
- konzervativně mapuje každý source soubor na existující product ID
- generuje do `client/public/images/products/<product-id>/`:
  - `cover.jpg` + `cover.webp`
  - `01.jpg` + `01.webp`, `02.jpg` + `02.webp`, ...
- vytváří JSON report s detailní trace (`products` sekce)
- v real run zapisuje i `client/public/images/products/<product-id>/.ingest-meta.json`

## Usage

Dry-run:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --dry-run
```

Real ingest:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX
```

Override produktu:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --product zle-tee-classic
```

Vlastní report path:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --report ./tmp/photo-ingest-report.json
```

Volitelný limit:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --max-images-per-product 8
```

## Append-safe naming

Nástroj čte existující sloty (`cover`, `01`, `02`, ...), drží in-memory rezervace a přiděluje další volný slot. Proto:

- nepřepisuje `cover`, pokud už existuje
- nepřepisuje starší sloty kvůli resetu indexu
- funguje bezpečně i při opakovaném ingestu

## Dry-run chování

V `--dry-run` režimu se **nezapisují finální assets ani metadata**.

Report pravdivě rozlišuje:

- `writtenFiles` = fyzicky zapsané soubory
- `simulatedFiles` = co by se zapsalo
- `skippedUnchangedFiles` = cíle se shodným obsahem

## Lock behavior

Per-product lockfile (`script/.locks/photo-ingest-<product-id>.lock`) brání kolizím při souběžném ingestu stejného produktu.

- lock se čistí ve `finally`
- při lock konfliktu je produkt fail-closed přeskočen a konflikt je v reportu

## Unmatched behavior

Když není match jednoznačný, soubor jde do `unmatchedFiles` a do finální produktové složky se nezapisuje.

## Limit behavior

Default limit je `8` slotů na produkt (včetně `cover`).

Při překročení limitu jsou další source soubory bezpečně přeskočeny (`skippedFiles` + product trace s `limit-reached`).

## Metadata / report trace

- hlavní debug stopa je JSON report (`--report`, default `tmp/photo-ingest-report.json`)
- report obsahuje `products` sekci se source->slot->outputs trace
- v real run vzniká per-product `.ingest-meta.json`; v dry-run se jen simuluje
