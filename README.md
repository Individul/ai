# Cataloage

Cataloage de legislație penitenciară pentru colegi, la [ai.dumitru.cloud](https://ai.dumitru.cloud). Fiecare catalog (Legislația penală, Legislația contravențională, Ordine penitenciare…) are un notebook NotebookLM în care se pun întrebări și se primesc răspunsuri cu trimitere la articol. Hub-ul organizează cataloagele, găzduiește sursele (cu PDF) și rezumatele audio (Audio Overview) descărcate din NotebookLM, și trimite spre notebook.

NotebookLM (redenumit Gemini Notebook) nu poate fi încorporat într-un site terț și nu are API pe cont personal, de aceea chatul rămâne pe notebooklm.google.com. Vezi deciziile în [`docs/plans/2026-09-08-cataloage-v1.md`](docs/plans/2026-09-08-cataloage-v1.md).

## Cum funcționează

- **Astro 7** (`output: 'server'`) pe **Cloudflare Workers**, cu `@astrojs/cloudflare`.
- **D1** (SQLite) ține cataloagele, sursele și metadatele audio; **R2** ține fișierele (`pdf/{sursa}`, `audio/{audio}`).
- **Cloudflare Access** face autentificarea (cod pe e-mail). Serverul verifică semnătura JWT-ului din `Cf-Access-Jwt-Assertion`; fără Access configurat răspunde 503 (eșuează închis).
- **Un singur admin** (`ADMIN_EMAILS` în `wrangler.jsonc`), restul citesc. `/admin*` și `/api/admin*` sunt blocate în middleware pentru toți ceilalți.
- **Admin fără JavaScript**: formulare clasice (POST + 303). Doar încărcarea fișierelor cere JavaScript: corpul brut (nu multipart) se streamează în R2, cu progres.
- **Fișierele** se servesc din R2 cu `Range` (206), ca `<audio>` să meargă și în Safari. PDF-urile se deschid inline sau se descarcă cu `?descarca=1`.
- Catalogul se **arhivează**, nu se șterge (`ON DELETE RESTRICT` pe surse și audio).

## Dezvoltare locală

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_EMAIL=dev@local, ADMIN_EMAILS=dev@local; nu se comite
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
3. `wrangler.jsonc`: `vars.ACCESS_TEAM_DOMAIN` și `vars.ADMIN_EMAILS`; apoi `npx wrangler secret put ACCESS_AUD`. `DEV_EMAIL` nu se pune **niciodată** pe Worker.
4. `npm run deploy`. Domeniul custom (DNS + certificat) apare din `routes` la primul deploy. `*.workers.dev` rămâne activ, dar cererile de acolo nu au JWT și primesc 403.

### Colegi noi

- **Pe hub**: adaugă adresa în policy-ul aplicației Access (Zero Trust → Access → Applications → Cataloage → Policies).
- **În notebook**: în NotebookLM, Share → adaugă adresa Google a colegului (Viewer) la fiecare catalog de care are nevoie. Poate fi altă adresă decât cea de pe hub.

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
src/pages/                      / (grila), c/[slug], acces, f/pdf, f/audio, admin/*, api/admin/*
src/pages/admin/actiuni/        toate actiunile din formulare (POST + 303)
src/scripts/incarcare.ts        client: upload PDF/audio cu progres, durata audio, confirmari
```
