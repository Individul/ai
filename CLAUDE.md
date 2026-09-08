# Cataloage

Hub de cataloage de legislație pentru colegi (ai.dumitru.cloud). Astro `output: 'server'` pe Cloudflare Workers, D1 pentru date, R2 pentru fișiere, Cloudflare Access pentru autentificare. NotebookLM nu se integrează (nu are API pe cont personal): hub-ul doar trimite spre notebook și găzduiește ce s-a descărcat de acolo. Planul complet: `docs/plans/2026-09-08-cataloage-v1.md`.

## Convenții

- Totul în română: UI cu diacritice; comentarii, mesaje de commit și nume de fișiere fără diacritice; identificatori în română (`creeazaCatalog`, `verificaUpload`).
- Fără `owner`: datele sunt comune tuturor celor din Access. Scrierea e doar pentru admin, iar poarta e **în middleware** (`/admin*`, `/api/admin*`), nu în pagini. Paginile nu citesc `env.ACCESS_*` / `env.ADMIN_EMAILS` direct; identitatea vine din `Astro.locals.email` / `Astro.locals.admin`.
- Fișierele nu trec niciodată prin `arrayBuffer()` sau `formData()`: upload = `request.body` streamat în `FISIERE.put`, descărcare = `obj.body` în `Response`. Workerul are 128 MB.
- Obiectul din R2 se scrie înaintea rândului din D1 (audio) și se șterge înaintea rândului (surse, audio); un rând fără fișier nu trebuie să existe.
- Catalogul se arhivează (`stare = 'arhivat'`), nu se șterge; `ON DELETE RESTRICT` e plasa de siguranță.
- Formularele de admin sunt clasice (POST → `/admin/actiuni/*` → 303 cu `?ok=1` / `?eroare=`). Doar upload-ul are JavaScript (`src/scripts/incarcare.ts`).
- Modulele pure din `src/lib` au teste (`vitest` cu `@cloudflare/vitest-pool-workers`, D1 + R2 locale). Rutele Astro se verifică cu `curl` (formularele cer antetul `Origin`, altfel Astro răspunde 403).

## Development

Prima dată: `cp .dev.vars.example .dev.vars` și `npm run migrate:local`.

Pentru verificări vizuale folosește `npm run dev:worker` (port 8787), care servește build-ul real. `astro dev` cu adaptorul Cloudflare servește uneori paginile fără stiluri (rulează în workerd și pierde mediul de dev la pornire rece); rutele, middleware-ul și API-ul merg corect.

Capcana: `wrangler dev` își face lista de assets o singură dată, la pornire, din `dist`. Dacă rulezi `npm run build` cât timp serverul merge, răspunde 404 la CSS și JavaScript. Repornește `npm run dev:worker`. Prima cerere cu corp după pornire poate pica cu „Network connection lost” în proxy-ul local; a doua merge.

Teste: `npm test`. Tipuri: `npm run check`. Deploy: `npm run deploy` (tokenul Cloudflare e în `CLOUDFLARE_API_TOKEN`, din `~/.zshrc`).

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
