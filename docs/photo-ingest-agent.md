# ZLE Photo Ingest Agent v1

Lokální ops script pro bezpečný ingest nových produktových fotek z inboxu do standardní produktové struktury.

## Co to dělá

- Rekurzivně načte soubory z `--input` složky.
- Přijímá jen image přípony: `.jpg`, `.jpeg`, `.png`, `.webp`.
- Zkusí konzervativně namatchovat batch souborů na existující product ID.
- Vygeneruje standardní výstupy do `client/public/images/products/<product-id>/`:
  - `cover.jpg`, `cover.webp`
  - `01.jpg`, `01.webp`, `02.jpg`, `02.webp`, ...
- Při nejasném matchi nic nenasazuje do finálních složek a označí soubory jako `unmatched`.
- Vždy uloží JSON report.

## Kam Michal hází fotky

Michal může dávat nové fotky do lokální inbox složky mimo repo nebo v repo rootu, například:

- `../ZLE_UPLOAD_INBOX`
- `./tmp/ZLE_UPLOAD_INBOX`

## Jak spustit dry-run

Dry-run nic nezapisuje do finálních product složek, ale udělá kompletní scan + report.

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --dry-run
```

## Jak spustit real ingest

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX
```

## Jak funguje `--product` override

Pro jednu dávku lze vynutit cílový produkt bez autodetekce:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --product zle-tee-classic
```

## Kam se ukládá report

Výchozí report:

- `tmp/photo-ingest-report.json`

Vlastní cesta:

```bash
npm run photos:ingest -- --input ../ZLE_UPLOAD_INBOX --report ./tmp/my-report.json
```

## Co je `unmatched`

`unmatched` jsou vstupní soubory, které script neumí spolehlivě přiřadit přesně k jednomu produktu. Tyto soubory se záměrně nepromítnou do finální produktové složky.

## Důležitá poznámka

Tento krok **záměrně nepřepíná image references v `client/src/data/products.ts`**. Jde čistě o bezpečný ingest nástroj pro přípravu finálních assetů.
