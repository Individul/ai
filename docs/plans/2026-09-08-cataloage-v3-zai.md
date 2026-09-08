# Plan: Cataloage v3 — motor alternativ Z.AI (GLM) lângă Gemini

## Context

Dumitru vrea ca chatul din hub să poată rula și pe GLM (Z.AI), plătit din **planul de coding Lite (18 $/lună)**, ca alternativă mai ieftină la Gemini File Search. Decizii luate cu el pe 8 sept. 2026:

- **Motor alternativ, nu înlocuire.** Adminul alege modelul din `/admin/consum`; modelul decide motorul (Gemini sau Z.AI). Se poate reveni oricând.
- **Regăsire ca în `ai2`** (repo `Individul/ai2`, `retrieve.py`): textul actelor se extrage din PDF la upload; la întrebare, dacă tot catalogul încape în buget, GLM primește **tot textul**; altfel, doar paginile cu cele mai multe potriviri de cuvinte (TF-IDF simplu, fără embeddings). Z.AI nu are File Search.
- **Buget implicit 3.000.000 de caractere**, ajustabil din Admin (10.000 … 3.000.000). Dumitru a văzut cifrele: pe Lite (2.000 credite / 5 h, 10.000 / săptămână, pentru toți colegii la un loc), o întrebare cu 3 M caractere (≈ 1 M tokeni) costă ≈ 230 de credite pe GLM-5.3-Flash, adică ≈ 8 întrebări la 5 ore. A ales totuși 3 M; poate coborî din Admin.
- **Riscuri asumate explicit de Dumitru:** documentația Z.AI limitează planul de coding la unelte suportate oficial (Claude Code, Cursor, Cline…); dintr-o aplicație proprie cererile pot primi „Insufficient Balance” sau pot fi taxate din portofel. GLM-5.3 / 5.3-Flash au gândirea pornită obligatoriu (`thinking` nu se poate opri, doar `reasoning_effort`), deci răspunsurile au și tokeni de gândire.
- **Fără streaming:** caseta arată „se citește catalogul…” până vine răspunsul întreg. La contexte de sute de mii de tokeni pot fi 1–3 minute.
- **Workers Paid** (confirmat): CPU 30 s pe cerere ajunge pentru citirea și filtrarea a 3 M caractere.
- **Cost în Admin:** pentru GLM se numără tokenii, se estimează costul la tariful public (orientativ) **și creditele planului** după formula oficială Z.AI: `credite = (intrare × mI + cache × mC + ieșire × mO) / 10.000`; GLM-5.3-Flash: 2,3 / 0,56 / 8; GLM-5.3: 6,9 / 1,7 / 24. (În afara orelor 14–18 UTC+8 luni–vineri, Z.AI scade 50 % mai puțin; nu modelăm asta.)

Verificat pe viu (docs.z.ai, 8 sept. 2026): endpoint OpenAI-compatibil al planului `https://api.z.ai/api/coding/paas/v4/chat/completions`, `Authorization: Bearer`; corp `{model, messages, temperature, max_tokens, thinking?, reasoning_effort?}`; răspuns `choices[0].message.content` (+ `reasoning_content`), `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`. Context 1 M tokeni, ieșire max 128 k. Tarif public Flash 0,15 / 0,50 $ per M; GLM-5.3 1,40 / 4,40 $.

## Arhitectura (ce se schimbă)

```
upload PDF (admin, browser)
  ├─ pdf-lib normalizează (există)          → PUT /api/admin/surse/:id/fisier → R2 pdf/{id}   (există)
  ├─ pdf.js extrage textul pe pagini (NOU)  → PUT /api/admin/surse/:id/text   → R2 text/{id} + D1 surse.text_pagini/text_caractere
  └─ POST /api/admin/surse/:id/indexeaza   → Gemini File Search (există; 503 fără cheie = doar avertisment)

întrebare (POST /api/chat)  →  lib/motor.ts: raspunde()
  ├─ model gemini-*  → gemini.intreaba (există)
  └─ model glm-*     → R2 text/{id} pentru sursele cu text → lib/context.ts (integral sau filtrat, buget din setari)
                       → lib/zai.ts (REST, fără SDK) → text + tokeni → lib/context.ts extrageCitariText → Citare[]
  jurnal `intrebari`: model, tokeni, cost (tarif public), credite (NOU)
```

Reguli care rămân: R2 se scrie înaintea rândului din D1 și se șterge înaintea lui; `zai.ts` e singurul fișier care vorbește cu Z.AI (ca `gemini.ts` pentru Google); orchestrarea e în `motor.ts`, rutele nu apelează clienții direct; poarta de admin rămâne în middleware.

## Pasul 0 — verificare pe viu a API-ului Z.AI (înainte de cod)

Dumitru pune `ZAI_API_KEY=` în `.dev.vars`. Cu `curl` pe endpointul planului confirmăm și notăm în antetul lui `zai.ts`:
1. dacă `thinking: {type: "disabled"}` e acceptat pe `glm-5.3-flash` (docs contradictorii); altfel folosim `reasoning_effort: "low"`;
2. forma exactă a `usage` (există `prompt_tokens_details.cached_tokens`?);
3. mesajul de eroare la context prea lung (ca retry-ul să îl recunoască);
4. că răspunsul vine din cota planului, nu „Insufficient Balance”.

## Schema — `migrations/0003_zai.sql`

```sql
ALTER TABLE surse ADD COLUMN text_pagini INTEGER;      -- NULL = text neextras; 0 pagini cu text = PDF scanat
ALTER TABLE surse ADD COLUMN text_caractere INTEGER;
ALTER TABLE intrebari ADD COLUMN credite REAL NOT NULL DEFAULT 0;   -- creditele planului Z.AI (0 la Gemini)
INSERT INTO setari VALUES ('buget_context', '3000000');
```
`src/test/setup.ts`: inserează și `buget_context` la reset. `SETARI_IMPLICITE` în `consum.ts` primește `buget_context: "3000000"`.

## Fișiere noi

- **`src/lib/zai.ts`** — clientul Z.AI (REST). `BAZA` implicit `https://api.z.ai/api/coding/paas/v4`, suprascris de `env.ZAI_API_BASE`. Exportă: `PROMPT_SISTEM_ZAI` (regulile + formatul de citare `[Titlul actului, pag. N]`, „nu inventa”, română), `construiesteCerereZai({model, context, istoric, intrebare})` (pur: `system` = prompt + „DOCUMENTE:\n” + context, ca prefixul să fie stabil pentru cache; apoi ultimele 8 schimburi trunchiate ca în `gemini.ts`; ultima = întrebarea; `temperature 0.2`, `max_tokens 4096`, parametrul de gândire stabilit la pasul 0), `extrageRaspunsZai(d)` (pur: `content` fără `reasoning_content`, `tokens_intrare`, `tokens_cache`, `tokens_iesire`), `intreabaZai(cheie, baza, cerere)`, `EroareZai(status, mesaj)` cu `contextPreaLung: boolean` (după mesajul de la pasul 0), `crediteZai(model, intrare, cache, iesire)` (pur, formula de mai sus, rotunjit la 0,01).
- **`src/lib/context.ts`** — pur, portat din `ai2/retrieve.py`: `construiesteContext(surse: {id, titlu, pagini: {pagina, text}[]}[], intrebare, buget)` → `{text, mod: "integral" | "filtrat", caractere, pagini_trimise, pagini_total}`. Antet pe pagină `=== {titlu} | pag. {n} ===`. Filtrat: tokeni fără diacritice, trunchiați la 4 litere, stopwords doar românești (lista din ai2 curățată de engleză), scor TF-IDF cu bonus pentru potrivire în titlu, normalizare pe lungime; pagina 1 a fiecărei surse intră prima (ca modelul să știe ce acte există), apoi paginile după scor până la buget; selecția se trimite în ordinea surselor și a paginilor. `extrageCitariText(text, surse)` → `Citare[]` unice din `[Titlu, pag. N]` / `[Titlu, p. N]`, titlul potrivit fără diacritice/majuscule (exact, apoi prefix); titlu necunoscut → `sursa_id: null`.
- **`src/lib/text.ts`** — textul extras în R2: `cheieText(id) = "text/{id}"`, `valideazaPagini(json)` (array de `{pagina: întreg ≥ 1 strict crescător, text: string}`, ≤ 5.000 pagini, ≤ 10 M caractere total), `scrieText(bucket, id, pagini)`, `citesteText(bucket, id)` (null dacă lipsește), `stergeText(bucket, id)`. JSON-ul trece prin `request.json()`: sunt câțiva MB de text, nu fișier binar; e acceptabil (regula „fără arrayBuffer” e pentru PDF/audio).
- **`src/lib/motor.ts`** — orchestrarea întrebării: `motorModel(model)` (din `validare.ts`), `raspunde(env, {catalog, surse, istoric, intrebare, model, buget})` → `{text, citari, tokens_intrare, tokens_cache, tokens_iesire, credite, mod}`. Gemini → `intreaba` ca acum. Z.AI → `citesteText` în paralel pentru sursele cu `text_caractere > 0`, `construiesteContext`, `intreabaZai`; la `contextPreaLung` reîncearcă **o singură dată** cu bugetul înjumătățit. `disponibilePentruChat(catalog, surse, model)` → numărul de surse utilizabile (Gemini: `indexare = 'gata'` și `magazin`; Z.AI: `text_caractere > 0`), folosit de pagina catalogului și de ruta de chat.
- **`src/pages/api/admin/surse/[id]/text.ts`** — `PUT` (JSON `{pagini}`; `citesteJson`; `valideazaPagini`; `scrieText` apoi `seteazaText` în D1; 403 pe `sec-fetch-site` străin ca la `fisier.ts`). Fără DELETE separat: textul pleacă odată cu PDF-ul.
- **`migrations/0003_zai.sql`**, teste: `src/lib/context.test.ts`, `src/lib/zai.test.ts`, `src/lib/text.test.ts`.

## Fișiere modificate

- **`src/lib/validare.ts`** — `TARIFE[model]` primește `motor: "gemini" | "zai"` și, la Z.AI, `credite: {intrare, cache, iesire}`; intrări noi `glm-5.3-flash` (0,15 / 0,50; 2,3 / 0,56 / 8; etichetă „GLM-5.3-Flash · Z.AI, planul de coding”) și `glm-5.3` (1,40 / 4,40; 6,9 / 1,7 / 24). `motorModel(model)`. `LIMITA_BUGET_MIN = 10_000`, `LIMITA_BUGET_MAX = 3_000_000`.
- **`src/lib/db.ts`** — `Sursa` + `COL_SURSA` cu `text_pagini`, `text_caractere`; `seteazaText(db, id, {pagini, caractere} | null)`; `surseCuText(db, catalogId)`.
- **`src/lib/consum.ts`** — `IntrebareNoua`/`Intrebare` cu `credite`; `inregistreazaIntrebare` scrie coloana; `raportUtilizatori` agregă `credite_7`, `credite_30`; `crediteUltimele7Zile(db, azi)` pentru antetul din Admin; `citesteBuget(db)` (număr valid între limite, altfel implicit).
- **`src/pages/api/chat/index.ts`** — citește modelul și bugetul din setări; verifică disponibilitatea prin `disponibilePentruChat`; cheia potrivită motorului (`GEMINI_API_KEY` / `ZAI_API_KEY`, altfel 503 cu mesaj clar); apelează `motor.raspunde`; jurnal cu `credite`; răspunsul include `model` și `mod`.
- **`src/pages/c/[slug].astro`** + **`src/components/Chat.astro`** — numărul de surse disponibile după motorul activ; `data-motor` pe secțiune; textul stării goale devine „Catalogul nu are încă documente pregătite pentru chat”.
- **`src/scripts/chat.ts`** — la Z.AI, starea în timpul așteptării: „se citește catalogul… (poate dura 1–3 minute)”.
- **`src/scripts/incarcare.ts`** — după PUT-ul PDF-ului: extrage textul în browser cu `pdfjs-dist` (`getTextContent` pe fiecare pagină, `hasEOL` → rând nou, spații normalizate), PUT la `/text`, apoi indexarea Gemini ca acum; 503 de la `indexeaza` (fără cheie Gemini) se arată ca avertisment, nu ca eroare, dacă textul a fost salvat. Butonul „reindexează” face și extragerea (ia PDF-ul de la `/f/pdf/{id}`). Buton nou pe catalog „extrage textul pentru sursele fără text” (`data-extrage-toate`) care le ia pe rând.
- **`src/pages/admin/cataloage/[id].astro`** — în meta sursei: „text: N pag.” / „fără text (PDF scanat?)” / „text neextras”; contorul din titlul secțiunii arată sursele disponibile pentru motorul activ; butonul de extragere în masă când există surse cu PDF fără text.
- **`src/pages/api/admin/surse/[id]/fisier.ts`** — la înlocuire și la ștergere: `stergeText` + `seteazaText(null)` înainte de scrierea/ștergerea PDF-ului.
- **`src/pages/admin/actiuni/[...cale].ts`** — `sursa/:id/sterge` șterge și `text/{id}`; `setari` validează și salvează `buget_context`.
- **`src/pages/admin/consum.astro`** — câmp „Buget context (caractere)”; selectul de model listează și GLM cu tarif + multiplicatori; antet cu „credite Z.AI în 7 zile: X din 10.000 (Lite)” și coloană „Credite 7 z.” per utilizator; nota de subsol explică estimarea și planul.
- **`src/env.d.ts`**, **`.dev.vars.example`**, **`wrangler.jsonc`** (comentariu pentru secretul `ZAI_API_KEY`, opțional `ZAI_API_BASE` în `vars`), **`package.json`** (`pdfjs-dist`, versiune fixată), **`CLAUDE.md`** (secțiunea de convenții: `zai.ts`, `text/{id}`, credite, riscul asumat, pasul de deploy), **`README.md`**, **`docs/plans/2026-09-08-cataloage-v3-zai.md`** (acest plan, ca document de proiect).

## Teste (vitest, pool workers)

- `context.test.ts`: integral când încape; filtrat alege paginile cu cuvintele întrebării (diacritice/flexiuni), include pagina 1 a fiecărei surse, respectă bugetul, păstrează ordinea; citări: `pag.`/`p.`, titlu cu diacritice, titlu necunoscut → `sursa_id null`, dedupe.
- `zai.test.ts`: forma cererii (context în system, max 8 schimburi, întrebarea ultima); `extrageRaspunsZai` ignoră `reasoning_content`, citește tokenii și cache-ul; `crediteZai("glm-5.3-flash", 1_000_000, 0, 1_000)` ≈ 230,8; `costMicrodolari("glm-5.3-flash", 100_000, 1_000)` = 15.500.
- `text.test.ts`: `valideazaPagini` respinge forme greșite; scriere/citire/ștergere în R2 local.
- `db.test.ts`: `seteazaText`, `surseCuText`. `consum.test.ts`: creditele se agregă pe 7/30 zile. `validare.test.ts`: `motorModel`.
- Rutele: `curl` cu `Origin`/`Sec-Fetch-Site` (PUT text, POST chat pe Z.AI, setări).

## Ordinea implementării

1. Pasul 0 (curl pe Z.AI) → notele din antetul `zai.ts`.
2. Migrația + `db.ts` + `consum.ts` + `validare.ts` + teste.
3. `text.ts` + ruta `PUT /text` + `incarcare.ts` (pdf.js) + admin catalog + ștergerile din `fisier.ts` și acțiuni.
4. `context.ts` + teste. 5. `zai.ts` + teste. 6. `motor.ts` + ruta de chat + pagina catalogului + `chat.ts`.
7. Admin consum (buget, model, credite). 8. Documentație. 9. Verificare cap-coadă, commit.

## Verificare

- `npm test`, `npm run check`.
- `npm run dev:worker` (port 8787): în `/admin/cataloage/:id` încarci un PDF de pe legis.md → apare „text: N pag.”; „extrage textul” pe o sursă veche funcționează. În `/admin/consum` alegi `glm-5.3-flash` și un buget mic (ex. 50.000) → pe pagina catalogului o întrebare răspunde cu citări `[Titlu, pag. N]` care deschid PDF-ul la pagină; jurnalul arată tokeni, cost, credite; cu buget 3.000.000 pe un catalog mic modul e „integral”. Revii la Gemini → chatul merge ca înainte.
- Deploy: Wrangler e autentificat pe acest calculator prin OAuth (`wrangler whoami`: workers write, d1 write), deci pașii se pot rula de aici, **doar cu acordul explicit al lui Dumitru la momentul respectiv**: `npx wrangler secret put ZAI_API_KEY` (valoarea o introduce Dumitru), `npm run migrate:remote`, `npm run deploy`. `ZAI_API_KEY` local e deja în `.dev.vars` (verificat, fără a afișa valoarea).

## Rezultatul implementării (8 sept. 2026)

- Pasul 0, pe viu: `thinking: {type: "disabled"}` e acceptat pe `glm-5.3-flash` și `glm-5.3` (reasoning_tokens = 0); `usage` are `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`; contextul prea lung dă HTTP 400 cu codul `1261` „Prompt exceeds max length”; cererile au ieșit din cota planului, nu „Insufficient Balance”.
- Bug găsit pe drum, în cod existent: `curataPdf` întorcea un flux fără lungime cunoscută, iar R2 îl refuza („Provided readable stream must have a known length”), deci upload-ul de PDF pica. Reparat cu `FixedLengthStream`, cu test.
- Citările GLM vin și ca `[Titlu, pag. N, Articolul X]` sau `[Titlu, art. X, pag. N]`; parserul le acceptă pe toate.
- Verificat local: extragerea textului în browser (pdf.js), comutarea modelului din Admin, o întrebare pe GLM-5.3-Flash cu răspuns în ≈ 4 s, mod integral, 0,2 credite în jurnal.
