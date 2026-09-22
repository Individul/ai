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
- **Chat pe DeepSeek (V4.1 Flash, `deepseek-flash`)**: același drum ca la Z.AI (text extras, buget de context, citări `[Titlu, pag. N]`), prin același client OpenAI-compatibil, cu `DEEPSEEK_API_KEY`. Context de 1 M tokeni, deci o culegere obișnuită încape integral. Plata e per token, preplătit, fără cotă: 0,15 $ intrare / 0,60 $ ieșire per M la orele libere, **dublu la orele de vârf** (01–04 și 06–10 UTC, adică 04–07 și 09–13 ora Chișinăului, luni–vineri); costul din jurnal ține cont de ora întrebării. Cache-ul e automat pe prefix: documentele stau înaintea istoricului în cerere, deci de la a doua întrebare pe aceeași culegere intrarea se plătește la 0,003 $ per M. V4 Flash și V4 Pro au fost retrase de DeepSeek pe 10–14 sept. 2026 și sunt redirecționate spre 4.1 Flash; `deepseek-v4-flash` rămâne în tabel doar pentru costul întrebărilor vechi. Plan: [`docs/plans/2026-09-09-deepseek.md`](docs/plans/2026-09-09-deepseek.md).
- **Încălzire dimineața (DeepSeek)**: cache-ul DeepSeek e pe prefixul cererii și expiră după câteva ore fără folosire, deci prima întrebare a zilei pe o culegere plătește tot contextul la preț întreg (dublu la orele de vârf). Un cron pe Worker (05:00 UTC, luni–vineri) trimite o cerere minimă cu toate actele culegerilor bifate în Admin („Încălzire dimineața”), ca prima întrebare a colegilor să găsească documentele în cache. Costă cât o primă întrebare, apare în tabelul de consum pe „sistem@incalzire”. Are sens doar pentru culegeri care încap integral în buget; în modul filtrat prefixul depinde de întrebare.
- **Corector de documente Word** (`/corector`): colegul încarcă un .docx, iar browserul îl desface și trimite doar textul paragrafelor, pe loturi, la `/api/corector`. Modelul ales în Admin („Model corector”, implicit DeepSeek V4.1 Flash, cu gândirea pornită) întoarce corecturile ca listă (fragment vechi → nou, tip, motiv). Browserul le pune în același document ca modificări urmărite (`w:del` / `w:ins`, autor „Corector AI”), cu formatarea originală, și oferă documentul la descărcare. În pagină apare lista corecturilor; cele care nu s-au putut pune automat (fragment negăsit, text în câmpuri sau în revizii existente) rămân „de verificat”. Două moduri: **Corectură** (corpul documentului, pe loturi, merge și pe documente mari) și **Verificare** (tot documentul odată, cu antete, subsoluri și note, până la 100.000 de caractere), care adaugă **observațiile** ce cer om: date care se contrazic între paragrafe îndepărtate, rubrici necompletate, formatare ruptă, îndoieli juridice. Fiecare observație vine cu o soluție; unde soluția e o înlocuire de text, o accepți sau o lași cu un clic, iar documentul de descărcat se reface pe loc. Documentul nu se păstrează: jurnalul `corectari` ține numele fișierului, contoarele și costul. Corectările nu au limită pe zi, iar costul lor intră în totaluri prin vederea `cheltuieli`. Modelul corectorului poate fi și Claude (Haiku 4.5, Sonnet 5 sau Opus 5, cu cheia `ANTHROPIC_API_KEY`); modelele Claude nu apar la chat, unde contextul culegerilor ar costa câțiva dolari pe întrebare. Pe planurile personale (Claude Pro/Max și Google), abonamentele nu se pot folosi din hub; corectura se face local, cu aplicația **Corector pentru Mac** (două moduri: „Corectură”, doar corpul, rapid, și „Verificare”, tot documentul cu antet și subsol, plus observațiile care cer om: date care se contrazic, rubrici goale, formatare ruptă; două motoare: **Claude** prin Claude Code și **Gemini** prin Antigravity) (`npm run mac -- --instaleaza`: documentele se trag în fereastră, iar la final au butoanele „Deschide în Word” și „Finder”) sau din Terminal (`npm run corecteaza -- \"Document.docx\" [--motor gemini]`). Amândouă folosesc CLI-ul oficial al motorului, logat cu contul propriu, și produc aceleași revizii Word. Și hub-ul, și aplicația verifică mențiunea obligatorie despre datele cu caracter personal: dacă lipsește sau e în altă formă, o pun în forma aprobată, ca modificare urmărită. Tot amândouă **maschează datele personale înainte ca textul să plece la model**: numele, IDNP-ul, telefonul, e-mailul, adresa și data nașterii sunt înlocuite cu date false dar plauzibile, iar corecturile se desfac înapoi la tine (trei niveluri, alese din interfață; harta nu pleacă nicăieri, nici măcar numele fișierului). E pseudonimizare, nu anonimizare: restul actului pleacă așa cum e. Ce nu mai poate vedea modelul se verifică în cod: același om scris în două feluri, IDNP-uri care nu se potrivesc, contacte care diferă între varianta română și cea rusă. Plan: [`docs/plans/2026-09-14-corector.md`](docs/plans/2026-09-14-corector.md).
- **Consum și limite**: fiecare întrebare se scrie în `intrebari` (email, tokeni, cost estimat, credite Z.AI, stare). Limita pe zi e implicită (setări) sau per persoană; peste limită, 429. Un utilizator blocat primește 403 pe orice pagină (middleware). Fiecare coleg își vede consumul la `/consum`. Sumele apar în lei, la cursul oficial BNM al zilei (citit automat, ținut în setări; dolarii și cursul se văd la hover).
- **Gemini Notebook**: fiecare culegere poate avea linkul spre caietul adminului (câmp în Admin, acțiune „Deschide în Gemini Notebook” în antetul paginii). Caietul se partajează din NotebookLM cu adresele colegilor, ca viewer: pot întreba și pot folosi rezumatele audio, hărțile mentale și testele generate de admin; generarea cere drept de editare, iar întrebările de acolo nu se numără în hub. Fără API pentru cont personal, deci doar link.
- **Trimiterile din răspuns** („articolului 13”, apoi eticheta „Codul de executare, p. 2”) deschid sursa într-un panou lateral, la pagina citată, cu articolul, punctul sau alineatul menționat evidențiat în galben (vizor propriu pe pdf.js). Lista „Surse” de sub răspuns face la fel. Săgețile schimbă pagina, Esc închide, „deschide PDF-ul” trece la fișierul complet.
- **Conversația** de pe pagina culegerii vine din jurnal (`/api/chat/istoric`, paginat), deci rămâne pe orice tab și dispozitiv; „șterge conversația” doar o ascunde în browserul respectiv (marcaj în `localStorage`). Contextul trimis modelului: ultimele 8 schimburi vizibile.
- **Două teme**, întunecată și albă, ca variabile CSS în `Base.astro`. Implicit urmează `prefers-color-scheme`; comutatorul din bară scrie `data-theme` pe `<html>` și memorează alegerea în `localStorage` („tema”).
- **Confidențialitate**: cheia Gemini trebuie să fie pe nivelul plătit (proiect cu facturare); pe nivelul gratuit Google poate folosi datele pentru antrenare. Pe Z.AI textul actelor ajunge la Zhipu (China); planul de coding e, după documentația lor, limitat la unelte suportate oficial, iar folosirea din hub e un risc asumat. Corectorul trimite textul documentelor Word modelului ales (pe DeepSeek, servere în China), cu datele personale înlocuite mai întâi cu date false; harta rămâne în browser. Pe Claude, textul ajunge la Anthropic, care, după termenii comerciali ai API-ului, nu folosește datele clienților la antrenare.

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
src/lib/docx.ts                 .docx fara DOM: paragrafele ca text, corecturile inapoi ca revizii Word (w:del / w:ins)
src/lib/corector.ts             corectorul, partea fara retea: prompt, schema raspunsului, loturi, citirea raspunsului JSON
src/lib/mascare.ts              mascarea datelor personale inainte de plecare, desfacerea corecturilor si verificarile ramase in cod
src/lib/nume-md.ts              prenume, cuvinte care nu sunt nume, rezervorul de nume false
src/lib/claude.ts               Claude (Anthropic) prin REST: cererea cu schema impusa si effort, raspunsul, tokenii (doar corectorul)
migrations/0004_corector.sql    jurnalul corectarilor (fara text), vederea cheltuieli, setari.model_corector
src/pages/                      / (grila), c/[slug] (cu chat), consum, acces, f/pdf, f/audio, admin/*, api/*
src/pages/api/chat/             POST intrebare (limite + jurnal), GET ramase, GET istoric (paginat: n, inainte)
src/pages/admin/actiuni/        toate actiunile din formulare (POST + 303)
src/pages/api/corector/         POST pornire, POST {id}/lot (modelul), POST {id}/gata (jurnalul)
src/scripts/incarcare.ts        client: upload PDF/audio cu progres, extragere text (pdf.js), indexare, confirmari
src/scripts/chat.ts             client: chatul de pe pagina catalogului (ultimele 5 intrebari, apoi cate 10 mai vechi, pe zile)
src/scripts/corector.ts         client: desface .docx-ul, trimite loturile, pune reviziile, descarcarea
scripts/corecteaza-local.mts    corectorul pe planurile personale, local: claude -p sau agy -p pe loturi, acelasi .docx cu revizii (--json pentru aplicatie)
mac/Corector/                   aplicatia Corector pentru Mac (SwiftUI): Motor.swift (ruleaza motorul), Stare.swift, Vederi.swift
mac/Instantanee/                utilitar de verificare: iconita, ecranele in stari de exemplu, proba cap la cap cu un claude fals
mac/build.sh                    construieste Corector.app fara Xcode (esbuild + swiftc), optional --instaleaza in ~/Applications
```
