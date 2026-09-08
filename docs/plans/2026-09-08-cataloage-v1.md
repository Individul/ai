# Plan: Cataloage v1 — ai.dumitru.cloud

## Context

Dumitru vrea pe dumitru.cloud o pagină cu „cataloage” NotebookLM pentru colegi: Legislația penală, Legislația contravențională, Ordine penitenciare etc. Verificat (sept. 2026): NotebookLM (redenumit Gemini Notebook) **nu poate fi încorporat** într-un site terț și **nu are API** pe cont personal (API doar la Enterprise, în Preview, și nici acela fără endpoint de chat). Bibliotecile neoficiale (notebooklm-py) merg pe cookie-uri și nu sunt potrivite pentru un site folosit de colegi.

Decizii luate cu Dumitru:
- **Hub cu login**, nu integrare: hub-ul organizează cataloagele, găzduiește PDF-urile sursă și Audio Overview-urile descărcate din NotebookLM, iar chatul cu citări se face în NotebookLM prin butonul „Deschide în NotebookLM”.
- **Colegi cu login** prin Cloudflare Access (ca la notite). Notebook-urile se partajează din contul Google al lui Dumitru **pe adrese Google specifice**.
- **Interfață de administrare în hub** (doar Dumitru), deci Astro + Cloudflare Workers + D1 + R2, după modelul `/Users/dumitruprisacaru/notite`.
- Nume: repo **`ai`** la `/Users/dumitruprisacaru/ai` (GitHub `Individul/ai`, creat de Claude cu `gh repo create`), Worker `ai`, D1 `ai`, bucket R2 `ai-fisiere`, domeniu `ai.dumitru.cloud`, brand în UI „Cataloage”.
- **Configurarea Cloudflare (D1, R2, Access, secrete, deploy) o face Claude**, nu Dumitru. Wrangler e deja logat (Workers + D1); pentru R2 și Access e nevoie de un API token Cloudflare de la Dumitru. Pentru GitHub e nevoie de `gh auth login` sau un token.
- Un singur admin (`ADMIN_EMAILS`), restul citesc. **Fără coloană `owner`**: datele sunt comune tuturor celor din Access.
- Catalogul se **arhivează**, nu se șterge. Sursele și audio-urile se șterg (întâi obiectul R2, apoi rândul).
- Upload prin `PUT` cu corp brut (stream în R2), nu multipart. Restul admin-ului = formulare HTML clasice (POST + 303).

## Ce se refolosește din `notite`

| Fișier notite | În cataloage |
|---|---|
| `src/lib/access.ts`, `src/lib/identitate.ts` (+test), `src/lib/api.ts`, `src/lib/markdown.ts` (+test), `src/test/env.d.ts`, `tsconfig.json`, `.gitignore`, `.dev.vars.example` | verbatim (`markdown.ts` randează „note de utilizare”) |
| `src/lib/data.ts` | doar `FUS`, `parseDbDate`, `fmtZi` |
| `src/middleware.ts` | adaptat: după identitate, `locals.admin = esteAdmin(email, env.ADMIN_EMAILS)`; 403 pe `/admin*` și `/api/admin*` când nu e admin (JSON pe `/api/`) |
| `src/env.d.ts` | + `FISIERE: R2Bucket`, `ADMIN_EMAILS?: string`, `App.Locals { email; admin }` |
| `src/test/setup.ts`, `vitest.config.ts` | + golire tabele/bucket, `r2Buckets: ["FISIERE"]` |
| `astro.config.mjs`, `wrangler.jsonc`, `package.json` | site/nume/rute noi, + R2, **fără** `@codemirror/*`, `@lezer/markdown` |
| `src/layouts/Base.astro`, `src/components/Bara.astro`, `public/*` | tokens/CSS global verbatim; brand „Cataloage”, linkuri „Cataloage”, „Cum obțin acces”, „Admin” (doar `locals.admin`) |
| `src/pages/n/noua.ts` | tiparul (verificare `Sec-Fetch-Site` + 303) pentru acțiunile admin cu formular |
| `src/lib/db.ts` | tiparul SQL brut, `acum()` strict crescător, CAS pe `actualizat_la` |
| `CLAUDE.md`, `README.md` | adaptate; păstrează capcanele `astro dev` / `wrangler dev` |

Nu se copiază: `cautare.*`, `scripts/*`, `Editor/PaginaZi/ListaNote.astro`, `pages/zi`, `pages/n`, `pages/cautare`.

## Structura

```
ai/
├── migrations/0001_init.sql
├── docs/plans/2026-09-08-cataloage-v1.md   (copia acestui plan)
└── src/
    ├── env.d.ts, middleware.ts
    ├── lib/ access.ts identitate.ts api.ts markdown.ts data.ts
    │        admin.ts(+test)     esteAdmin(email, lista)
    │        validare.ts(+test)  slug(), TIPURI_SURSA, CULORI, STARI, fmtDurata(), fmtMarime(), limite, urlNotebookValid()
    │        db.ts(+test)        cataloage / surse / audio
    │        fisiere.ts(+test)   cheieR2(), raspunsFisier() cu Range/206, tipMimePermis()
    ├── components/ Bara.astro CardCatalog.astro ListaSurse.astro ListaAudio.astro Pictograma.astro
    ├── scripts/incarcare.ts    client: upload PDF/audio cu progres (XHR) + durata audio
    └── pages/
        ├── index.astro                  grila cataloagelor (activ + în lucru; arhivate doar admin)
        ├── c/[slug].astro               pagina catalogului
        ├── acces.astro                  „Cum obțin acces” (cont Google, cere adăugarea la notebook, OTP pe hub)
        ├── f/pdf/[id].ts                GET: stream PDF din R2 (?descarca=1 -> attachment)
        ├── f/audio/[id].ts              GET: stream audio cu Range (Safari cere 206)
        ├── admin/index.astro            lista + arhivate + „Catalog nou”
        ├── admin/cataloage/nou.astro
        ├── admin/cataloage/[id].astro   editare catalog + secțiuni Surse / Audio
        ├── admin/actiuni/[...].ts       POST formulare -> 303
        └── api/admin/surse/[id]/fisier.ts   PUT/DELETE fișier sursă
            api/admin/audio/index.ts         PUT audio nou
```

## Schema D1 (`migrations/0001_init.sql`)

```sql
CREATE TABLE cataloage (
  id             TEXT PRIMARY KEY,                      -- uuid
  slug           TEXT NOT NULL UNIQUE,                  -- /c/legislatia-penala
  titlu          TEXT NOT NULL,
  descriere      TEXT NOT NULL DEFAULT '',
  pictograma     TEXT NOT NULL DEFAULT 'carte',         -- set fix de SVG in Pictograma.astro
  culoare        TEXT NOT NULL DEFAULT 'violet' CHECK (culoare IN ('coral','teal','violet','verde','galben')),
  stare          TEXT NOT NULL DEFAULT 'in_lucru' CHECK (stare IN ('activ','in_lucru','arhivat')),
  url_notebook   TEXT NOT NULL DEFAULT '',              -- https://notebooklm.google.com/notebook/...
  note_utilizare TEXT NOT NULL DEFAULT '',              -- markdown (intrebari sugerate etc.)
  ordine         INTEGER NOT NULL DEFAULT 0,
  creat_la       TEXT NOT NULL,
  actualizat_la  TEXT NOT NULL
);
CREATE INDEX idx_cataloage_stare_ordine ON cataloage(stare, ordine);

CREATE TABLE surse (
  id            TEXT PRIMARY KEY,
  catalog_id    TEXT NOT NULL REFERENCES cataloage(id) ON DELETE RESTRICT,
  titlu         TEXT NOT NULL,
  tip           TEXT NOT NULL CHECK (tip IN ('lege','cod','ordin','regulament','dispozitie','circulara','instructiune','alt')),
  numar         TEXT,
  data_emiterii TEXT CHECK (data_emiterii IS NULL OR data_emiterii GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  url           TEXT,                                   -- legis.md etc.
  fisier_nume   TEXT,                                   -- NULL = fara PDF; cheia R2 e pdf/{id}
  fisier_marime INTEGER,
  ordine        INTEGER NOT NULL DEFAULT 0,
  creat_la      TEXT NOT NULL,
  actualizat_la TEXT NOT NULL
);
CREATE INDEX idx_surse_catalog ON surse(catalog_id, ordine);

CREATE TABLE audio (
  id          TEXT PRIMARY KEY,
  catalog_id  TEXT NOT NULL REFERENCES cataloage(id) ON DELETE RESTRICT,
  titlu       TEXT NOT NULL,
  descriere   TEXT NOT NULL DEFAULT '',
  durata_s    INTEGER,                                  -- masurata in browser la upload
  data        TEXT NOT NULL,                            -- YYYY-MM-DD, data generarii in NotebookLM
  tip_mime    TEXT NOT NULL,                            -- audio/mpeg | audio/mp4 | audio/wav
  fisier_nume TEXT NOT NULL,
  marime      INTEGER NOT NULL,
  ordine      INTEGER NOT NULL DEFAULT 0,
  creat_la    TEXT NOT NULL
);
CREATE INDEX idx_audio_catalog ON audio(catalog_id, ordine);
```

Tipurile de sursă urmează `e-biblioteca` (`/Users/dumitruprisacaru/individul-apps/apps/e-biblioteca/backend/documents/models.py`) + `lege`, `cod`, `alt`. `ON DELETE RESTRICT` e plasa pentru „catalogul se arhivează, nu se șterge”. Orice schimbare în surse/audio împinge `actualizat_la` al catalogului (= „ultima actualizare” din UI).

`db.ts` (toate primesc `db`): `listeazaCataloage({cuArhivate})`, `citesteCatalogDupaSlug`, `citesteCatalog`, `creeazaCatalog` (slug din titlu, coliziune → `-2`), `actualizeazaCatalog` (CAS pe `actualizat_la`), `arhiveazaCatalog`, `mutaCatalog(id, ±1)`; `listeazaSurse`, `adaugaSursa`, `actualizeazaSursa`, `seteazaFisierSursa(id, nume|null, marime|null)`, `stergeSursa`, `mutaSursa`; `listeazaAudio`, `adaugaAudio`, `actualizeazaAudio`, `stergeAudio`, `mutaAudio`. Interfețe: `Catalog`, `Sursa`, `Audio`.

## Fișiere (R2)

- `fisiere.ts`: `cheieR2("pdf"|"audio", id)`; `TIPURI_PDF = ["application/pdf"]`, `TIPURI_AUDIO = ["audio/mpeg","audio/mp4","audio/x-m4a","audio/wav"]`; `LIMITA_PDF = 50 MB`, `LIMITA_AUDIO = 95 MB` (sub plafonul de 100 MB al corpului cererii pe Free/Pro).
- `raspunsFisier(obj, cerere, nume, dispozitie)`: `obj.writeHttpMetadata`, `etag`, `accept-ranges: bytes`, `content-disposition` cu `filename*=UTF-8''…`; 206 + `content-range` la Range. Citirea: `env.FISIERE.get(cheie, { range: request.headers, onlyIf: request.headers })`; `null` → 404. Middleware-ul pune `cache-control: no-store` (conținut protejat, corect).
- Upload: `env.FISIERE.put(cheie, request.body, { httpMetadata: { contentType } })` — **stream**, niciodată `arrayBuffer()`/`formData()` (Workerul are 128 MB). `content-length` obligatoriu (R2 cere lungimea la stream; browserul îl pune automat la `body: File`).

## Autentificare, admin, API

Middleware: 1) `identitate(...)` ca în notite → `locals.email`; 2) `locals.admin = esteAdmin(email, env.ADMIN_EMAILS)` (split pe virgulă, trim, lowercase; listă goală → nimeni, eșuează închis); 3) `/admin*` sau `/api/admin*` fără admin → 403.

Acțiuni admin cu formular (`POST`, verifică `Sec-Fetch-Site` ∈ {same-origin, none}, validare din `validare.ts`, 303 înapoi cu `?ok=1` / `?eroare=…`):

| Rută | Efect |
|---|---|
| `POST /admin/actiuni/catalog` | creează |
| `POST /admin/actiuni/catalog/[id]` | actualizează (câmp ascuns `baza`; conflict → 409) |
| `POST /admin/actiuni/catalog/[id]/arhiveaza`, `/muta?dir=sus\|jos` | |
| `POST /admin/actiuni/sursa`, `/sursa/[id]`, `/sursa/[id]/sterge`, `/sursa/[id]/muta` | ștergerea: R2 delete apoi rând |
| `POST /admin/actiuni/audio/[id]`, `/sterge`, `/muta` | crearea audio e doar prin upload |

Upload JSON (apelate din `scripts/incarcare.ts` cu `fetch`/XHR `PUT`, `body: file`):

| Rută | Antete | Comportament |
|---|---|---|
| `PUT /api/admin/surse/:id/fisier` | `content-type: application/pdf`, `content-length`, `x-nume-fisier` (URL-encoded) | 411 fără length; 413 peste limită; 415 tip greșit; put în R2, `seteazaFisierSursa`; `200 { sursa }` |
| `DELETE /api/admin/surse/:id/fisier` | — | R2 delete + `seteazaFisierSursa(null)`; 204 |
| `PUT /api/admin/audio?catalog=<id>` | `content-type: audio/*`, `content-length`, `x-nume-fisier`, `x-titlu`, `x-data`, `x-durata` | `id = randomUUID()`; put sub `audio/{id}`; `adaugaAudio`; dacă INSERT cade → R2 delete; `201 { audio }` |

CSRF: tipurile `application/pdf`/`audio/*` nu sunt „simple” pentru CORS → un site străin nu le poate trimite; plus `Sec-Fetch-Site`. `incarcare.ts`: durata audio via `new Audio(URL.createObjectURL(file))` → `loadedmetadata`; progres cu `XMLHttpRequest.upload.onprogress`; la succes `location.reload()`. Fără JS: „Încărcarea cere JavaScript”.

## Pagini

- `/`: grilă `CardCatalog` (pictogramă, culoare, titlu, descriere, insignă Activ / În lucru, nr. surse, nr. audio, „actualizat la”). Stil: cardurile `tile-*` din portofoliu, tokens din `Base.astro`. Gol: „Niciun catalog încă.”
- `/c/[slug]`: antet + descriere; buton mare „Deschide în NotebookLM” (`target=_blank rel=noopener`; `url_notebook` gol → buton dezactivat „Notebook în pregătire”); **Surse** grupate pe tip (etichete: Lege, Cod, Ordin, Regulament, Dispoziție, Circulară, Instrucțiune, Altele), număr/dată, link extern, „PDF (2,3 MB)” → `/f/pdf/{id}`; **Audio**: `<audio controls preload="none" src="/f/audio/{id}">` + titlu, durată, dată, descărcare; **Note de utilizare** prin `randeazaMarkdown`; subsol „ultima actualizare”. Arhivat → 404 pentru non-admin.
- `/acces`: text static: ai nevoie de cont Google; ceri lui Dumitru adăugarea adresei Google la notebook; pe hub intri cu cod pe e-mail (Access); adresa Google și cea din Access pot diferi.
- `/admin/*`: formulare simple, `<select>` pentru tip/culoare/stare/pictogramă, butoane ↑ ↓, secțiune „Fișier PDF” per sursă, „Audio nou” cu `<input type=file accept="audio/*">` + titlu + dată.
- `<meta name="robots" content="noindex">` peste tot.

## Config

`wrangler.jsonc` (restul verbatim din notite):
```jsonc
"name": "ai",
"routes": [{ "pattern": "ai.dumitru.cloud", "custom_domain": true }],
"d1_databases": [{ "binding": "DB", "database_name": "ai", "database_id": "<din wrangler d1 create>" }],
"r2_buckets": [{ "binding": "FISIERE", "bucket_name": "ai-fisiere" }],
"vars": { "ACCESS_TEAM_DOMAIN": "wandering-firefly-46cf.cloudflareaccess.com", "ADMIN_EMAILS": "<emailul lui Dumitru>" }
```
`ACCESS_AUD` rămâne secret; `DEV_EMAIL` doar în `.dev.vars` (+ `ADMIN_EMAILS=dev@local` în `.dev.vars.example`). `vitest.config.ts`: `d1Databases: ["DB"], r2Buckets: ["FISIERE"]`.

## Teste (Vitest în workerd, TDD pentru modulele pure)

- `identitate.test.ts`, `markdown.test.ts`: copiate.
- `admin.test.ts`: listă goală/undefined → false; majuscule/spații normalizate; virgule multiple.
- `validare.test.ts`: `slug("Legislația penală") === "legislatia-penala"`; tip invalid respins; `url_notebook` doar `https://notebooklm.google.com/…` sau gol; `fmtDurata(754) === "12:34"`; `fmtMarime(2_400_000) === "2,3 MB"`; `2026-02-30` respinsă.
- `db.test.ts`: slug unic (`-2`); listarea ascunde arhivatele; `muta` schimbă ordinea și e no-op la capăt; CAS conflict; sursa nouă împinge `actualizat_la`; arhivarea nu șterge sursele; RESTRICT blochează DELETE brut.
- `fisiere.test.ts`: put în `env.FISIERE` → `raspunsFisier` fără Range → 200 + `content-length` + `accept-ranges`; `Range: bytes=0-3` → 206 + `content-range` + 4 octeți; `content-disposition` cu diacritice encodate.
- Rutele API se verifică cu `curl` (adaptorul Astro nu rulează în pool).

## Ordinea implementării (un commit fiecare)

1. Schelet: copiile verbatim + config adaptate, `index.astro` placeholder; `npm install && npm run build && npm run check`.
2. `migrations/0001_init.sql` + `migrate:local`.
3. `vitest.config.ts` (+R2), `setup.ts`, `admin.ts`, `validare.ts` (TDD).
4. `db.ts` (TDD).
5. Middleware + `env.d.ts` + gating admin; `curl` 200/403/503.
6. `fisiere.ts` (TDD) + `/f/pdf`, `/f/audio`.
7. Layout, `Bara`, `CardCatalog`, `/`, `/c/[slug]`, `/acces`.
8. Admin: pagini + acțiuni cu formular.
9. Upload: `api/admin/*` + `scripts/incarcare.ts`.
10. README, CLAUDE.md, plan în `docs/plans`, deploy, card în portofoliu.

## Configurare GitHub + Cloudflare (făcută de Claude)

Stare verificată (8 sept. 2026):
- **GitHub**: `gh` logat pe contul `Individul`, scope `repo` prezent. Repo-ul `Individul/ai` va fi **public** (decizia lui Dumitru).
- **Cloudflare**: token dedicat „ai” exportat ca `CLOUDFLARE_API_TOKEN` în `~/.zshrc` linia 3 (linia 2 e tokenul vechi, de șters de Dumitru; shell-ul Claude face `source ~/.zshrc` înaintea comenzilor Cloudflare/wrangler). Verificat prin API: Workers Scripts, D1, Access apps, Account, User, Memberships, zona `dumitru.cloud` (DNS, Workers Routes, SSL) → toate OK. Wrangler folosește acest token în locul OAuth. **R2 e activat pe cont** (verificat: `/r2/buckets` → OK, fără bucket-uri încă). Nimic nu mai blochează configurarea.
- Cont Cloudflare: `820175030a3273a778bdd45cf5a185a6`. Tokenul se folosește doar din shell, nu se comite nicăieri.
- Lista de adrese e-mail ale colegilor pentru policy-ul Access: la început doar `prisacarudumitru@gmail.com`; colegii se adaugă ulterior din dashboard sau prin API.

Pași (Claude):
1. `gh repo create Individul/ai --private --clone` la `/Users/dumitruprisacaru/ai` (confirm vizibilitatea cu Dumitru; implicit privat).
2. `npx wrangler d1 create ai` → `database_id` în `wrangler.jsonc`; `npx wrangler r2 bucket create ai-fisiere` (cu `CLOUDFLARE_API_TOKEN`); `npm run migrate:remote`.
3. Aplicația Access prin API (`POST /accounts/{id}/access/apps`): tip `self_hosted`, nume „Cataloage”, domeniu `ai.dumitru.cloud`, sesiune `730h`, `allowed_idps` doar One-time PIN; policy „Colegi” (`decision: allow`, `include: [{email: ...}]`). Din răspuns se ia `aud` → `npx wrangler secret put ACCESS_AUD`. Team domain rămâne `wandering-firefly-46cf.cloudflareaccess.com` (același ca notite).
4. `wrangler.jsonc` `vars.ADMIN_EMAILS = prisacarudumitru@gmail.com`; `npm run deploy` → domeniul custom + certificatul apar din `routes`.
5. Verificare în browser (fereastră privată): pagina OTP Access pe `https://ai.dumitru.cloud`.

Rămâne la Dumitru (nu se poate automatiza): în NotebookLM, pentru fiecare catalog, Share → adaugă adresele Google ale colegilor (Viewer); lipește linkul în `url_notebook` din admin. Descarcă Audio Overview-urile și încarcă-le în hub.

## Portofoliu (`/Users/dumitruprisacaru/portofoliu/index.html`, commit separat)

Nu există încă `tile-violet` (nici cardul Notițe). Adaugă în `<style>` `.tile-violet` (gradient pe `179,147,242`, `.icon` pe `var(--violet)`, `.tile-host` pe `var(--violet)`) și un bloc `<a class="tile tile-violet" href="https://ai.dumitru.cloud">` înaintea cardului „Pe masa de lucru”: `status-wip` „În lucru”, nume „Cataloage”, host `ai.dumitru.cloud`, descriere „Cataloage de legislație penitenciară, cu notebook-uri NotebookLM și rezumate audio pentru colegi.”, pictogramă SVG de carte deschisă (stroke 2.2). Dacă și Notițe primește card, alege altă culoare pentru unul dintre ele.

## Verificare end-to-end

Local (`.dev.vars` cu `DEV_EMAIL` + `ADMIN_EMAILS=dev@local`; `npm run dev:worker` pe 8787 pentru vizual):
- `npm test` verde; `npm run check` curat.
- `/admin` → creezi „Legislația penală” → apare pe `/` și `/c/legislatia-penala`; adaugi 2 surse (una cu PDF 5 MB), un audio MP3 → PDF se deschide inline și se descarcă cu `?descarca=1`; `<audio>` redă, `curl -r 0-99 localhost:8787/f/audio/<id>` → 206.
- Schimbi `ADMIN_EMAILS` la alt email → `/admin` și `PUT /api/admin/...` → 403; paginile publice merg.
- Arhivezi catalogul → dispare din `/`, `/c/...` → 404 pentru non-admin; DELETE brut pe catalog cu surse → eroare RESTRICT.
- Fără `.dev.vars` → 503 peste tot.

Producție:
- Fereastră privată → `https://ai.dumitru.cloud` → pagina OTP Access; email neautorizat refuzat; coleg autorizat vede cataloagele, fără „Admin” în bară, `/admin` → 403.
- `curl -H "Cf-Access-Jwt-Assertion: xyz" https://ai.<cont>.workers.dev/` → 403.
- Upload audio de 30 MB din admin; `npx wrangler tail` fără 5xx.
- Butonul „Deschide în NotebookLM” deschide notebook-ul; un coleg adăugat în notebook poate pune întrebări acolo.

## Riscuri

- **Corp cerere ≤ 100 MB** (Free/Pro); Audio Overview tipic 10–30 MB, ok. Peste: URL-uri presemnate R2 (în afara v1).
- **Memorie Worker 128 MB**: upload/descărcare doar stream.
- **Range/206** obligatoriu pentru `<audio>` în Safari/iOS.
- **Cookie-ul Access** merge pe `<audio src>` same-origin, nu în playere externe → utilizatorul descarcă fișierul.
- **Identități diferite** (Access OTP vs. cont Google la notebook) → explicat pe `/acces`.
- **Dependență de NotebookLM**: linkurile pot deveni invalide dacă Google schimbă produsul; hub-ul păstrează oricum sursele și audio-urile.
- Gratuit: R2 10 GB, D1 5 GB, Access 50 utilizatori — suficient.

## Fișiere critice

- `/Users/dumitruprisacaru/ai/migrations/0001_init.sql`
- `/Users/dumitruprisacaru/ai/src/lib/db.ts` (tipar: `/Users/dumitruprisacaru/notite/src/lib/db.ts`)
- `/Users/dumitruprisacaru/ai/src/middleware.ts` + `src/lib/admin.ts` (bază: `/Users/dumitruprisacaru/notite/src/middleware.ts`, `src/lib/identitate.ts`)
- `/Users/dumitruprisacaru/ai/src/lib/fisiere.ts` + `src/pages/api/admin/audio/index.ts`
- `/Users/dumitruprisacaru/ai/wrangler.jsonc` + `vitest.config.ts` (bază: cele din notite)
- `/Users/dumitruprisacaru/portofoliu/index.html` (cardul)
