# SEO_SENTINEL

Run against production URL (replace `$BASE`).

1. `curl -s "$BASE/" | head -c 5000`
   - Check `<link rel="canonical" ...>` exists and is absolute.
2. `curl -s "$BASE/produkt/some-slug" | head -c 12000`
   - Check `<meta property="og:url" ...>` points to canonical product URL.
3. `curl -s "$BASE/kategorie/some-category" | head -c 12000`
   - Check canonical + `og:url` are consistent (no query noise).
4. `curl -s "$BASE/" | rg -n "application/ld\+json|@type|Organization|Product"`
   - Check schema JSON-LD is rendered in initial HTML.
5. `curl -s "$BASE/" | rg -n "<title>|meta name=\"description\"|og:title|og:description"`
   - Check title/description/OpenGraph tags present in server HTML.
