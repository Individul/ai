# Cataloage

Culegeri de legislație penitenciară pentru colegi, la [ai.dumitru.cloud](https://ai.dumitru.cloud). În interfață se numesc „culegeri”; în cod, în baza de date și în adrese rămân „cataloage”. Fiecare culegere (Legislația penală, Legislația contravențională, Ordine penitenciare…) adună actele în PDF; colegii pun întrebări direct pe pagina catalogului și primesc răspunsuri cu citări la articol și la pagina din act. Hub-ul găzduiește sursele și rezumatele audio, numără întrebările per persoană, aplică limite pe zi și poate bloca.

Istoric: v1 trimitea spre notebook-uri NotebookLM (fără API pe cont personal, deci fără control per persoană); v2 a adus chatul propriu peste Gemini File Search, iar butonul și linkul NotebookLM au fost scoase (coloana `url_notebook` a rămas în schemă, nefolosită); v3 a adăugat un al doilea motor, Z.AI (GLM) din planul de coding, cu textul extras din PDF-uri. Deciziile: [`docs/plans/2026-09-08-cataloage-v1.md`](docs/plans/2026-09-08-cataloage-v1.md), [`docs/plans/2026-09-08-cataloage-v2-chat.md`](docs/plans/2026-09-08-cataloage-v2-chat.md) și [`docs/plans/2026-09-08-cataloage-v3-zai.md`](docs/plans/2026-09-08-cataloage-v3-zai.md).

## Cum funcționează

- **Astro 7** (`output: 'server'`) pe **Cloudflare Workers**, cu `@astrojs/cloudflare`.
- **D1** (SQLite) ține cataloagele, sursele și metadatele audio; **R2** ține fișierele (`pdf/{sursa}`, `audio/{audio}`).
- **Cloudflare Access** face autentificarea (cod pe e-mail). Serverul verifică semnătura JWT-ului din `Cf-Access-Jwt-Assertion`; fără Access configurat răspunde 503 (eșuează închis).
- **Un singur admin** (`ADMIN_EMAILS` în `wrangler.jsonc`), restul citesc. `/admin*` și `/api/admin*` sunt blocate în middleware pentru toți ceilalți.
- **Admin fără JavaScript**: formulare clasice (POST + 303). Doar încărcarea fișierelor cere JavaScript: corpul brut (nu multipart) se streamează în R2, cu progres.
- **Fișierele** se servesc din R2 cu `Range` (206), ca `<audio>` să meargă și în Safari. PDF-urile se deschid inline sau se descarcă cu `?descarca=1`.
- Catalogul se **arhivează**, nu se șterge (`ON DELETE RESTRICT` pe surse și audio).
- **Chat cu citări (Gemini File Search)**: fiecare catalog are un „magazin” la Google, creat la prima indexare; fiecare PDF încărcat devine un document acolo (Files API + import, cu metadate `sursa`/`titlu`), automat după upload. Întrebările merg la `generateContent` cu unealta `file_search`; citările vin din `groundingMetadata` (sursă + pagină) și deschid PDF-ul la pagina respectivă. Modelul și limita implicită se aleg din `/admin/consum`.
- **Chat pe Z.AI (GLM)**: dacă modelul ales e `glm-*`, întrebarea merge la endpointul planului de coding Z.AI (OpenAI-compatibil, fără File Search). Textul PDF-ului se extrage în browser cu pdf.js la upload (sau din „Extrage textul”) și stă în R2 sub `text/{sursa}`; la întrebare, dacă tot catalogul încape în bugetul de context (implicit 3.000.000 de caractere, din Admin), modelul primește tot textul, altfel paginile care se potrivesc cu întrebarea. Citările vin ca `[Titlu, pag. N]` și deschid PDF-ul la pagină. Consumul se măsoară în creditele planului (formula Z.AI), afișate în Admin față de cota săptămânală; cota reală a planului (pe 5 ore și pe săptămână, cu momentele de resetare) se citește de la Z.AI și apare în bara de sus pentru toți, când motorul activ e Z.AI. Fără streaming: la contexte mari răspunsul poate dura minute.
- **Chat pe DeepSeek (V4 Flash)**: același drum ca la Z.AI (text extras, buget de context, citări `[Titlu, pag. N]`), prin același client OpenAI-compatibil, cu `DEEPSEEK_API_KEY`. Plata e per token, preplătit, fără cotă; cache-ul DeepSeek e automat pe prefix: documentele stau înaintea istoricului în cerere, deci de la a doua întrebare pe aceeași culegere se plătesc la 0,0028 $ per M în loc de 0,14 $. Jurnalul arată tokenii din cache și costul real. Plan: [`docs/plans/2026-09-09-deepseek.md`](docs/plans/2026-09-09-deepseek.md).
- **Consum și limite**: fiecare întrebare se scrie în `intrebari` (email, tokeni, cost estimat, credite Z.AI, stare). Limita pe zi e implicită (setări) sau per persoană; peste limită, 429. Un utilizator blocat primește 403 pe orice pagină (middleware). Fiecare coleg își vede consumul la `/consum`. Sumele apar în lei, la cursul oficial BNM al zilei (citit automat, ținut în setări; dolarii și cursul se văd la hover).
- **Conversația** de pe pagina culegerii vine din jurnal (`/api/chat/istoric`, paginat), deci rămâne pe orice tab și dispozitiv; „șterge conversația” doar o ascunde în browserul respectiv (marcaj în `localStorage`). Contextul trimis modelului: ultimele 8 schimburi vizibile.
- **Două teme**, întunecată și albă, ca variabile CSS în `Base.astro`. Implicit urmează `prefers-color-scheme`; comutatorul din bară scrie `data-theme` pe `<html>` și memorează alegerea în `localStorage` („tema”).
- **Confidențialitate**: cheia Gemini trebuie să fie pe nivelul plătit (proiect cu facturare); pe nivelul gratuit Google poate folosi datele pentru antrenare. Pe Z.AI textul actelor ajunge la Zhipu (China); planul de coding e, după documentația lor, limitat la unelte suportate oficial, iar folosirea din hub e un risc asumat.

## Dezvoltare locală

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_EMAIL, ADMIN_EMAILS, GEMINI_API_KEY, ZAI_API_KEY, DEEPSEEK_API_KEY; nu se comite
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
3. `wrangler.jsonc`: `vars.ACCESS_TEAM_DOMAIN` și `vars.ADMIN_EMAILS`; apoi `npx wrangler secret put ACCESS_AUD`, `npx wrangler secret put GEMINI_API_KEY` (cheie din Google AI Studio, pe un proiect cu facturare) , `npx wrangler secret put ZAI_API_KEY` (consola z.ai, planul de coding) și `npx wrangler secret put DEEPSEEK_API_KEY` (platform.deepseek.com). Pe Windows, nu lipi cheia la promptul interactiv (Ctrl+V poate ajunge ca un caracter de control, iar cererile pică cu „Network connection lost”); trimite-o prin stdin: `(Get-Content .dev.vars | Where-Object { $_ -like 'ZAI_API_KEY=*' }) -replace '^ZAI_API_KEY=','' | npx wrangler secret put ZAI_API_KEY`. `DEV_EMAIL` nu se pune **niciodată** pe Worker.
4. `npm run deploy`. Domeniul custom (DNS + certificat) apare din `routes` la primul deploy. `*.workers.dev` rămâne activ, dar cererile de acolo nu au JWT și primesc 403.

### Chat

- Sursele cu PDF se pregătesc singure după upload: textul se extrage în browser („text: N pag.”), apoi se indexează la Gemini („Gemini: indexat”); „Reindexează” le reface pe amândouă. Sursele încărcate înainte de v3 primesc text din butonul „Extrage textul pentru N surse”. Sursele doar cu link nu intră în chat până nu li se pune PDF-ul; PDF-urile scanate au „fără text” și nu intră în chatul pe Z.AI.
- `/admin/consum`: întrebări per persoană (azi / 7 / 30 zile), tokeni, cost estimat, credite Z.AI pe 7 zile, limită per persoană, blocare, limita implicită, modelul (Gemini sau GLM) și bugetul de context pentru GLM.
- Costuri orientative (sept. 2026): Gemini 3.5 Flash-Lite ≈ 0,3 cenți per întrebare; indexare 0,15 $ per milion de tokeni, o singură dată. GLM-5.3-Flash din planul Lite: (tokeni intrare × 2,3 + din cache × 0,56 + ieșire × 8) / 10.000 credite, din 2.000 la 5 ore și 10.000 pe săptămână; la 3.000.000 de caractere de context ≈ 230 de credite per întrebare.

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
src/lib/zai.ts                  Z.AI (GLM) prin REST: cererea, raspunsul, creditele planului de coding
src/lib/motor.ts                alege motorul dupa model; raspunde() (Gemini sau Z.AI, cu retry la context prea lung)
src/lib/context.ts              contextul pentru GLM: integral sau filtrat pe cuvinte (TF-IDF); citari [Titlu, pag. N]
src/lib/text.ts                 textul extras din PDF, in R2 sub text/{sursa}: validare, scriere, citire
src/lib/consum.ts               jurnalul intrebarilor, limite per utilizator, blocare, raport, credite
src/lib/indexare.ts             R2 + D1 + Gemini: porneste/verifica/scoate indexarea unei surse
src/pages/                      / (grila), c/[slug] (cu chat), consum, acces, f/pdf, f/audio, admin/*, api/*
src/pages/api/chat/             POST intrebare (limite + jurnal), GET ramase, GET istoric (paginat: n, inainte)
src/pages/admin/actiuni/        toate actiunile din formulare (POST + 303)
src/scripts/incarcare.ts        client: upload PDF/audio cu progres, extragere text (pdf.js), indexare, confirmari
src/scripts/chat.ts             client: chatul de pe pagina catalogului (ultimele 5 intrebari, apoi cate 10 mai vechi, pe zile)
```
