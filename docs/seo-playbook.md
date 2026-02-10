# SEO playbook (ZLE)

Tento dokument převádí SEO checklist do konkrétního setupu v projektu.

## 1) Foundation setup

### Search Console / Bing / GA4
- Nastav `VITE_GOOGLE_SITE_VERIFICATION` a `VITE_BING_SITE_VERIFICATION`.
- Nastav `VITE_GA_MEASUREMENT_ID` (např. `G-XXXXXXXXXX`).
- Po deployi ověř:
  - vlastnictví domény v Google Search Console
  - vlastnictví domény v Bing Webmaster Tools
  - příjem pageview eventů v GA4 Realtime

### Sitemap + robots
- `client/public/sitemap.xml` obsahuje indexovatelné veřejné stránky.
- `client/public/robots.txt` blokuje neveřejné URL (`/admin`, `/ops`, `/account`, `/checkout`).

### HTTPS + bezpečnost
- V produkci vynucuj HTTPS a HSTS na úrovni hostingu/reverse proxy.
- Udržuj závislosti aktuální (`npm audit`, pravidelné aktualizace).
- CSP řeš ideálně v HTTP hlavičkách (meta CSP je fallback).

## 2) Keyword a obsah

### Keyword analýza a mapování
- Pro každou hlavní URL (`/`, `/shop`, `/story`, `/crew`, `/contact`) drž 1 primární téma + long-tail varianty.
- Vyhýbej se kanibalizaci: stejné hlavní KW nepoužívej jako fokus na více URL.

### E-E-A-T
- Doplňuj reálné zkušenosti (story, proces, behind-the-scenes).
- U klíčových článků uváděj autora/zdroj a datum aktualizace.

## 3) On-page SEO
- Route-level title/description/noindex řeší `SeoManager`.
- Canonical URL řeší `Canonical` komponenta.
- Strukturovaná data řeší `StructuredData` komponenta.
- Obrázky: doplň ALT texty v komponentách, kde chybí.
- Interní prolinkování: preferuj odkazy mezi `/story`, `/crew`, `/shop`.

## 4) Technické SEO
- Sleduj Core Web Vitals (LCP/INP/CLS) přes GA4 + Lighthouse.
- Komprese obrázků, lazy-loading médií a code-splitting jsou priorita.
- Kontroluj 404/redirecty po každém release.

## 5) Off-page a autorita
- Buduj odkazy z relevantních webů (komunity, média, partnerské projekty).
- Pravidelně porovnávej backlink profil konkurence.

## 6) Lokální SEO (pokud relevantní)
- Pokud má značka fyzické místo, založ a vyplň Google Business profil.
- Drž konzistentní NAP údaje napříč katalogy.

## 7) Měření a optimalizace
- KPI: organická návštěvnost, CTR, pozice KW, konverzní poměr, bounce/engagement.
- Měsíční SEO audit: indexace, technické chyby, obsahové mezery, návrh oprav.
- A/B testuj důležité obsahové změny (title/description, CTA, layout sekcí).
