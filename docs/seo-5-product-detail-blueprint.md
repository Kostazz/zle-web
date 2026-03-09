# SEO-5 blueprint: produktový detail `/p/:id`

Interní specifikace pro budoucí implementaci SEO-5. Tento dokument je scaffold: definuje strukturu, povinné SEO prvky a acceptance kritéria bez zavádění finálního marketingového obsahu.

## 1) Route návrh `/p/:id`

- Route: `/p/:id`
- Parametr `id`: stabilní produktový identifikátor použitý i pro canonical URL.
- SSR/HTML výstup musí vracet správný SEO obsah pro konkrétní produkt (title/meta/schema/canonical/OG) přímo v dokumentu.
- Route nesmí měnit stávající checkout/order/payment flow; pouze čte produktová data.

### Datový kontrakt (minimum)

- `id` (string, stabilní)
- `name` (string)
- `shortDescription` (string)
- `price` (number)
- `currency` (ISO, např. `CZK`)
- `availability` (in stock / out of stock / preorder)
- `brand` (string, default `ZLE`)
- `imageMain` (absolutní nebo jasně resolvovatelná URL)
- `slug` nebo jiný stabilní klíč jen pokud je potřeba interně (nepovinné)

## 2) Povinné SEO prvky na detailu produktu

Pro každý existující produkt:

- `<title>`: `{product.name} | ZLE`
- `meta name="description"`: stručný popis produktu bez neověřených claimů
- `link rel="canonical"`: `https://zleshop.cz/p/{id}`
- `meta property="og:title"`: `{product.name} | ZLE`
- `meta property="og:description"`: stejný nebo lehce upravený bezpečný popis
- `meta property="og:url"`: `https://zleshop.cz/p/{id}`
- `meta property="og:image"`: URL hlavní produktové fotky (viz image strategie)

Poznámka: všechny texty mají být věcné, neutrální, bez slibů o dopravě/platebních podmínkách, které nejsou finálně uzamčené.

## 3) Schema.org návrh

Použít `Product` + vnořený `Offer`.

### Povinná pole

- `@type: Product`
- `name`
- `image` (pole nebo single URL)
- `brand` (`Brand` nebo text)
- `offers`:
  - `@type: Offer`
  - `price`
  - `priceCurrency`
  - `availability` (`https://schema.org/InStock`, `OutOfStock`, `PreOrder`)
  - `url` (canonical detailu)

### Podmíněná pole

- `aggregateRating` pouze pokud existují reálná produkční data hodnocení.
- Nesmí se generovat syntetické/fiktivní hodnocení.

### Vazba na SEO-4.2

- `Offer` zůstává kompatibilní s automatickým doplněním `shippingDetails` a `hasMerchantReturnPolicy`.
- Text policy v legal stránkách a schema musí zůstat ve významové shodě.

## 4) Chování pro 404 / neexistující produkt

- Pokud `id` neexistuje:
  - vrátit stránku „Produkt nenalezen“
  - nastavit `noindex`
  - nastavit canonical na `/p/{id}` jen pokud route fyzicky existuje; jinak canonical na bezpečnou fallback stránku dle implementačního standardu
  - neemitovat `Product` schema pro neexistující produkt
- UX: nabídnout návrat na `/shop`.

## 5) Image strategie (finální fotky později)

### Hlavní produktová fotka

- Každý produkt má 1 stabilní hlavní asset (`imageMain`) pro detail i schema.
- URL musí být dlouhodobě stabilní (bez náhodných query parametrů měnících identitu URL).

### Budoucí `og:image`

- Výchozí: `og:image` = `imageMain`, dokud nebude připraven dedikovaný OG render.
- Později lze přidat separátní OG asset per produkt, ale URL musí zůstat stabilní.

### ALT text pravidla

- ALT text má být popisný a věcný: `ZLE {název produktu} – {barva/typ}`.
- Bez keyword stuffing a bez marketingových superlativů.

### Naming a stabilita assetů

- Preferovaný pattern: `zle-{product-id}-main.{ext}`
- Pokud existují varianty, rozšířit suffixem (`-front`, `-detail-01`), ale `-main` musí zůstat konzistentní.

## 6) Acceptance criteria pro SEO-5 implementaci

1. `/p/:id` existuje a renderuje unikátní SEO metadata pro každý existující produkt.
2. Canonical, OG URL a schema `Offer.url` jsou konzistentní a odkazují na stejnou URL detailu.
3. `Product` schema je validní a obsahuje `Offer`, `image`, `brand`, `availability`.
4. `aggregateRating` se objevuje pouze při existenci reálných dat.
5. Neexistující produkt vrací SEO-safe 404 scénář (`noindex`, bez Product schema).
6. Žádné zásahy do checkout/payment/order flow.
7. Implementace nepřidává neověřené business claims (doprava, platby, garance).

## 7) Co doplnit při finalizaci

- Final copy pro product descriptions (po content locku).
- Finální produktové fotografie + případně dedikované OG assety.
- Potvrzené mapování dostupnosti a skladových stavů.
- Případné napojení reálných recenzí (pokud budou).
