# Cataloage

Cataloage de legislație penitenciară pentru colegi, la [ai.dumitru.cloud](https://ai.dumitru.cloud). Fiecare catalog (Legislația penală, Legislația contravențională, Ordine penitenciare…) adună actele în PDF; colegii pun întrebări direct pe pagina catalogului și primesc răspunsuri cu citări la articol și la pagina din act. Hub-ul găzduiește sursele și rezumatele audio, numără întrebările per persoană, aplică limite pe zi și poate bloca.

Istoric: v1 trimitea spre notebook-uri NotebookLM (fără API pe cont personal, deci fără control per persoană); v2 a adus chatul propriu peste Gemini File Search, iar butonul și linkul NotebookLM au fost scoase (coloana `url_notebook` a rămas în schemă, nefolosită). Deciziile: [`docs/plans/2026-09-08-cataloage-v1.md`](docs/plans/2026-09-08-cataloage-v1.md) și [`docs/plans/2026-09-08-cataloage-v2-chat.md`](docs/plans/2026-09-08-cataloage-v2-chat.md).

## Cum funcționează

- **Astro 7** (`output: 'server'`) pe **Cloudflare Workers**, cu `@astrojs/cloudflare`.
- **D1** (SQLite) ține cataloagele, sursele și metadatele audio; **R2** ține fișierele (`pdf/{sursa}`, `audio/{audio}`).
- **Cloudflare Access** face autentificarea (cod pe e-mail). Serverul verifică semnătura JWT-ului din `Cf-Access-Jwt-Assertion`; fără Access configurat răspunde 503 (eșuează închis).
- **Un singur admin** (`ADMIN_EMAILS` în `wrangler.jsonc`), restul citesc. `/admin*` și `/api/admin*` sunt blocate în middleware pentru toți ceilalți.
- **Admin fără JavaScript**: formulare clasice (POST + 303). Doar încărcarea fișierelor cere JavaScript: corpul brut (nu multipart) se streamează în R2, cu progres.
- **Fișierele** se servesc din R2 cu `Range` (206), ca `<audio>` să meargă și în Safari. PDF-urile se deschid inline sau se descarcă cu `?descarca=1`.
- Catalogul se **arhivează**, nu se șterge (`ON DELETE RESTRICT` pe surse și audio).
- **Chat cu citări (Gemini File Search)**: fiecare catalog are un „magazin” la Google, creat la prima indexare; fiecare PDF încărcat devine un document acolo (Files API + import, cu metadate `sursa`/`titlu`), automat după upload. Întrebările merg la `generateContent` cu unealta `file_search`; citările vin din `groundingMetadata` (sursă + pagină) și deschid PDF-ul la pagina respectivă. Modelul și limita implicită se aleg din `/admin/consum`.
- **Consum și limite**: fiecare întrebare se scrie în `intrebari` (email, tokeni, cost estimat, stare). Limita pe zi e implicită (setări) sau per persoană; peste limită, 429. Un utilizator blocat primește 403 pe orice pagină (middleware). Fiecare coleg își vede consumul la `/consum`.
- **Confidențialitate**: cheia Gemini trebuie să fie pe nivelul plătit (proiect cu facturare); pe nivelul gratuit Google poate folosi datele pentru antrenare.

## Dezvoltare locală

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_EMAIL, ADMIN_EMAILS, GEMINI_API_KEY; nu se comite
npm run migrate:local
npm run dev:worker               # build + wrangler dev pe http://localhost:8787
```

- `npm test` rulează testele (vitest în workerd, cu D1 și R2 locale și migrațiile aplicate).
- `npm run check` verifică tipurile.
- `npm run dev:worker` e cel mai aproape de producție; folosește D1 și R2 locale din `.wrangler/state/v3`. Dacă rulezi `npm run build` cât timp serverul merge, repornește-l (își face lista de assets o singură dată).
- `npm run dev:retea` ascultă și pe rețea, pentru probă de pe telefon.

Local, identitatea vine din `DEV_EMAIL` (doar în `astro dev` sau pe `localhost`). Schimbă `ADMIN_EMAILS` în `.dev.vars` ca să vezi aplicația ca un coleg fără admin.

## Configurare Cloudflare (o singură dată)

Stare (8 septembrie 2026): făcută. D1 `ai` (id în `wrangler.jsonc`), bucket R2 `ai-fisiere`, aplicația Access „Cataloage” pe `ai.dumitru.cloud` (echipa `wandering-firefly-46cf`, One-time PIN), secretul `ACCESS_AUD` pe Worker. Pașii rămân ca referință.

1. `npx wrangler d1 create ai` → `database_id` în `wrangler.jsonc`; `npx wrangler r2 bucket create ai-fisiere`; `npm run migrate:remote`.
2. Zero Trust → Access → Applications → Self-hosted: nume `Cataloage`, domeniu `ai.dumitru.cloud`, sesiune 1 lună, doar One-time PIN. Policy „Colegi”: Allow, Include → Emails. Copiază **Application Audience (AUD) Tag**.
3. `wrangler.jsonc`: `vars.ACCESS_TEAM_DOMAIN` și `vars.ADMIN_EMAILS`; apoi `npx wrangler secret put ACCESS_AUD` și `npx wrangler secret put GEMINI_API_KEY` (cheie din Google AI Studio, pe un proiect cu facturare). `DEV_EMAIL` nu se pune **niciodată** pe Worker.
4. `npm run deploy`. Domeniul custom (DNS + certificat) apare din `routes` la primul deploy. `*.workers.dev` rămâne activ, dar cererile de acolo nu au JWT și primesc 403.

### Chat

- Sursele cu PDF se indexează singure după upload (insigna „indexat” în Admin); „Reindexează” reface documentul. Sursele doar cu link nu intră în chat până nu li se pune PDF-ul.
- `/admin/consum`: întrebări per persoană (azi / 7 / 30 zile), tokeni, cost estimat, limită per persoană, blocare, limita implicită și modelul.
- Costuri orientative (sept. 2026): Gemini 3.5 Flash-Lite ≈ 0,3 cenți per întrebare; indexare 0,15 $ per milion de tokeni, o singură dată.

### Colegi noi

- Adaugă adresa în policy-ul aplicației Access (Zero Trust → Access → Applications → Cataloage → Policies). Apare în `/admin/consum` după prima vizită.

### Verificare după deploy

- Fereastră privată → `https://ai.dumitru.cloud` arată pagina cu cod pe e-mail; alt e-mail e refuzat.
- Ca admin: „Admin” în bară, `/admin` merge. Ca alt e-mail din policy: fără „Admin”, `/admin` → 403.
- `curl -H "Cf-Access-Jwt-Assertion: xyz" https://ai.<cont>.workers.dev/` → 403.
- `curl -r 0-99 https://ai.dumitru.cloud/f/audio/<id>` (cu cookie-ul Access) → 206.
- `npx wrangler tail` fără 5xx la un upload de câteva zeci de MB.

## Structură

```
migrations/0001_init.sql        cataloage, surse, audio
src/lib/validare.ts             vocabular (tipuri, culori, stari), validari de formular, slug, formatari
src/lib/db.ts                   acces la date (fara owner; ordonare, CAS pe catalog)
src/lib/fisiere.ts              R2: chei, tipuri permise, verificare upload, raspuns cu Range
src/lib/admin.ts                esteAdmin(email, ADMIN_EMAILS)
src/lib/identitate.ts           cine face cererea: Access JWT | DEV_EMAIL | 503
src/middleware.ts               identitate + poarta de admin, Cache-Control: no-store
src/lib/gemini.ts               Gemini File Search prin REST: magazine, documente, intrebari cu citari, cost
src/lib/consum.ts               jurnalul intrebarilor, limite per utilizator, blocare, raport
src/lib/indexare.ts             R2 + D1 + Gemini: porneste/verifica/scoate indexarea unei surse
src/pages/                      / (grila), c/[slug] (cu chat), consum, acces, f/pdf, f/audio, admin/*, api/*
src/pages/api/chat/             POST intrebare (limite + jurnal), GET ramase
src/pages/admin/actiuni/        toate actiunile din formulare (POST + 303)
src/scripts/incarcare.ts        client: upload PDF/audio cu progres, indexare, confirmari
src/scripts/chat.ts             client: chatul de pe pagina catalogului (istoric in sessionStorage)
```
