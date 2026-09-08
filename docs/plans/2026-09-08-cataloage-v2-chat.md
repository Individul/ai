# Plan: Cataloage v2 — chat propriu în hub, cu consum și limite per coleg

(v1, hub-ul cu linkuri spre NotebookLM, e gata și publicat; planul lui e în `docs/plans/2026-09-08-cataloage-v1.md` din repo.)

## Context

Dumitru vrea să vadă cât consumă fiecare coleg și să poată pune limite, ca un utilizator rău intenționat să nu epuizeze cotele. Cu NotebookLM nu se poate: limitele sunt pe contul Google al fiecăruia, nu există API, iar statisticile sunt agregate. Verificat (sept. 2026): niciun abonament (ChatGPT Business, Claude Team, Copilot, Gemini Notebook Enterprise) nu permite plafoane setate de admin per persoană; doar vizibilitate. Singura cale: motor propriu în hub.

Decizia: **Gemini File Search** (RAG gestionat de Google, API oficial): PDF-urile din R2 se indexează într-un „magazin” per catalog; colegii pun întrebări direct pe pagina catalogului; hub-ul știe emailul (Access), numără întrebările și tokenii, aplică limite pe zi și poate bloca. Butonul „Deschide în NotebookLM” rămâne (pentru cine vrea audio și interfața Google).

Decizii luate cu Dumitru (8 sept. 2026): **model implicit `gemini-3.5-flash-lite`** (0,30 $ / 2,50 $ per milion de tokeni intrare / ieșire), **limita implicită 15 întrebări pe zi per coleg**, ambele schimbabile din Admin; alternativa `gemini-3.8-flash` 0,75 $ / 3,75 $ (până la 31 dec. 2026) rămâne selectabilă. Cheia Gemini o creează Dumitru pe un proiect cu facturare și o dă la pasul cu secretul. Indexare 0,15 $ per milion de tokeni, o singură dată; stocare gratuită (1 GB pe nivelul gratuit, 10 GB pe Tier 1). O întrebare tipică (≈7.000 tokeni context regăsit + istoric, ≈600 tokeni răspuns) costă ≈0,5–0,8 cenți pe 3.8 Flash, ≈0,3 cenți pe Flash-Lite. 50 de PDF-uri a 200.000 de tokeni = 1,50 $ la indexare. **Important:** cheia trebuie să fie pe nivelul plătit (cu facturare activată): pe nivelul gratuit Google poate folosi datele pentru antrenare, ceea ce nu e acceptabil pentru ordine interne.

## Ce faci TU manual (restul face Claude)

**Obligatoriu, o singură dată, înainte de pasul 2:**
1. Intră pe https://aistudio.google.com cu contul tău Google → „Get API key” → „Create API key”.
2. Alege sau creează un proiect Google Cloud **cu facturare activată** (Billing → adaugă un card). Fără facturare, cheia e pe nivelul gratuit și Google poate folosi documentele pentru antrenare. Plătești doar consumul (cca 0,3 cenți per întrebare).
3. Copiază cheia (începe cu `AIza…`) și dă-mi-o când ajung la pasul cu secretul. Eu o pun pe Worker cu `wrangler secret put GEMINI_API_KEY` și în `.dev.vars` local; nu apare în cod sau pe GitHub.

**Opțional, după publicare:**
- În Admin, la sursele care au doar link (fără PDF), încarcă PDF-ul actului, altfel nu intră în chat. Indexarea pornește singură.
- În `/admin/consum`, ajustezi limita implicită (15), limita per persoană sau blochezi pe cineva.

Nimic altceva: D1, migrațiile, secretul, deploy-ul, testele le fac eu.

## Ce se schimbă în hub

### Schema D1 (`migrations/0002_chat.sql`)

```sql
ALTER TABLE cataloage ADD COLUMN magazin TEXT;                 -- fileSearchStores/... ; NULL = fara magazin inca
ALTER TABLE surse ADD COLUMN doc_google TEXT;                  -- fileSearchStores/x/documents/y
ALTER TABLE surse ADD COLUMN indexare TEXT NOT NULL DEFAULT 'neindexat'
  CHECK (indexare IN ('neindexat','in_curs','gata','eroare'));
ALTER TABLE surse ADD COLUMN indexare_mesaj TEXT;              -- eroarea, cand e cazul
ALTER TABLE surse ADD COLUMN operatie_google TEXT;             -- operations/... cat timp e in_curs

CREATE TABLE intrebari (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  catalog_id       TEXT NOT NULL REFERENCES cataloage(id) ON DELETE RESTRICT,
  zi               TEXT NOT NULL,                              -- YYYY-MM-DD in fusul Chisinau (limitele pe zi)
  intrebare        TEXT NOT NULL,
  raspuns          TEXT NOT NULL DEFAULT '',
  citari           TEXT NOT NULL DEFAULT '[]',                 -- JSON [{sursa_id, titlu, pagina}]
  tokens_intrare   INTEGER NOT NULL DEFAULT 0,
  tokens_iesire    INTEGER NOT NULL DEFAULT 0,
  cost_microdolari INTEGER NOT NULL DEFAULT 0,                 -- calculat din tarifele modelului
  stare            TEXT NOT NULL CHECK (stare IN ('ok','eroare','refuzat')),
  durata_ms        INTEGER,
  creat_la         TEXT NOT NULL
);
CREATE INDEX idx_intrebari_email_zi ON intrebari(email, zi);
CREATE INDEX idx_intrebari_catalog ON intrebari(catalog_id, creat_la);

CREATE TABLE utilizatori (                                     -- doar cei cu setari; restul folosesc implicitul
  email          TEXT PRIMARY KEY,
  limita_zi      INTEGER,                                      -- NULL = limita implicita
  blocat         INTEGER NOT NULL DEFAULT 0,
  nota           TEXT,
  ultima_vizita  TEXT,
  actualizat_la  TEXT NOT NULL
);

CREATE TABLE setari (cheie TEXT PRIMARY KEY, valoare TEXT NOT NULL);
INSERT INTO setari VALUES ('limita_zi_implicita', '15'), ('model', 'gemini-3.5-flash-lite');
```

### Module noi în `src/lib`

- **`gemini.ts`** (REST prin `fetch`, fără SDK; cheia din `env.GEMINI_API_KEY`):
  - `creeazaMagazin(nume)` → `POST /v1beta/fileSearchStores` `{displayName, embeddingModel: "models/gemini-embedding-2"}` → `name`.
  - `incarcaDocument(magazin, corp: ReadableStream, marime, tip, {sursaId, titlu})` → upload resumable în doi pași: `start` (JSON cu `displayName = sursaId`, `customMetadata: [{key:"sursa", stringValue: sursaId}, {key:"titlu", stringValue}]`, antete `X-Goog-Upload-*`) → URL-ul din `X-Goog-Upload-URL` → `upload, finalize` cu octeții streamați din R2 → `operations/...`.
  - `stareOperatie(op)` → `{done, document?, eroare?}`.
  - `stergeDocument(doc)` (`?force=true`), `stergeMagazin`.
  - `intreaba({model, magazin, sistem, istoric, intrebare})` → apel cu unealta `file_search` pe `file_search_store_names: [magazin]` (Interactions API, `POST /v1beta/interactions`, sau `generateContent` cu `tools:[{file_search:…}]`, de verificat la implementare care e stabil) → `{text, citari: [{sursa_id, titlu, pagina}], tokens_intrare, tokens_iesire}`. Citările vin din `annotations[type=file_citation]` cu `page_number` și `custom_metadata.sursa`.
  - Funcții pure testabile: `construiesteCerere(...)`, `extrageCitari(raspunsJson)`, `costMicrodolari(model, tokensIn, tokensOut)` cu tabelul de tarife din `validare.ts` (`TARIFE[model] = {intrare, iesire, valabil_pana}`).
- **`consum.ts`** (D1): `intrebariAzi(db, email, zi)`, `limitaPentru(db, email)` (utilizator → implicit din `setari`), `esteBlocat(db, email)`, `inregistreazaIntrebare(db, …)`, `raportUtilizatori(db)` (per email: azi / 7 zile / 30 zile / total, tokeni, cost, ultima vizită), `istoricUtilizator(db, email, n)`, `seteazaUtilizator(db, email, {limita_zi, blocat, nota})`, `citesteSetare/seteazaSetare`, `atingeVizita(db, email)`.
- **`data.ts`**: se refolosește `aziChisinau()` pentru coloana `zi`.

### Middleware

După identitate: `atingeVizita` (o dată pe zi, dacă `ultima_vizita` nu e azi) și `esteBlocat` → 403 „Accesul tău a fost suspendat. Vorbește cu Dumitru.” (HTML pe pagini, JSON pe `/api/`). Adminul nu poate fi blocat.

### Rute noi

| Rută | Cine | Ce face |
|---|---|---|
| `POST /api/chat` `{catalog, intrebare, istoric[]}` | toți | verifică: catalog activ cu `magazin`, blocat, `intrebariAzi < limita` (altfel 429 cu `{eroare, ramase: 0}`); apelează Gemini; salvează în `intrebari`; răspunde `{raspuns, citari, ramase}`. Istoricul: ultimele 8 schimburi, trimise de client (stateless). Text max 2.000 caractere. |
| `GET /api/chat/ramase?catalog=` | toți | `{ramase, limita}` pentru afișare |
| `POST /api/admin/surse/:id/indexeaza` | admin | creează magazinul catalogului dacă lipsește; citește PDF-ul din R2 și îl încarcă în Google; `indexare='in_curs'`, `operatie_google` |
| `GET /api/admin/surse/:id/indexare` | admin | interoghează operația; la `done` → `indexare='gata'`, `doc_google`; la eroare → `'eroare'` + mesaj |
| `POST /admin/actiuni/utilizator/[email]` (formular) | admin | `limita_zi`, `blocat`, `nota` |
| `POST /admin/actiuni/setari` (formular) | admin | `limita_zi_implicita`, `model` |

Modificări în rutele existente: `PUT …/fisier` (PDF nou/înlocuit) → dacă exista `doc_google`, îl șterge din Google și pune `indexare='neindexat'`; clientul apelează apoi `indexeaza` automat. `DELETE …/fisier` și `sursa/:id/sterge` → șterg și documentul Google. Arhivarea nu șterge magazinul.

### Pagini

- **`/c/[slug]`**: secțiune nouă „Întreabă catalogul” sub butonul NotebookLM: casetă de întrebare, răspunsuri în ordine, citări ca etichete „Titlul sursei · p. 12” care deschid `/f/pdf/{id}#page=12`, contor „ai N întrebări rămase azi”. Dacă niciun document nu e `gata`: „Catalogul nu are încă documente indexate.” Fără JS: doar textul explicativ. Script `src/scripts/chat.ts` (fetch JSON, istoric în `sessionStorage` per catalog, randare cu escapare, stare „se caută în documente…”).
- **`/consum`** (fiecare coleg): întrebările lui de azi, limita, ultimele 50 de întrebări cu răspunsurile.
- **`/admin/consum`**: tabel per email (azi, 7 zile, 30 zile, total, tokeni, cost estimat, ultima vizită), formular pe rând (limită, blocat, notă), formular setări (limita implicită, model) și costul total pe lună.
- **`/admin/cataloage/[id]`**: la fiecare sursă cu PDF, insigna de indexare (neindexat / în curs / gata / eroare) și butonul „Indexează” / „Reindexează”; la catalog, „Magazin: creat / lipsă”.
- **`/acces`**: paragraf nou: întrebările se pot pune direct aici, fără cont Google; limita zilnică.
- Bara: link „Consum” pentru toți.

### Prompt de sistem (română)

Răspunde doar din documentele regăsite; citează articolul/punctul și documentul; dacă informația nu e în documente, spune clar; concis, fără speculații juridice; limba română. Se pune în `src/lib/gemini.ts` ca constantă.

### Config și secrete

- `wrangler.jsonc` `vars.GEMINI_MODEL` nu e necesar (modelul e în `setari`); secretul **`GEMINI_API_KEY`** pus de Claude cu `wrangler secret put` după ce Dumitru îl creează în Google AI Studio (aistudio.google.com → Get API key) pe un proiect cu facturare activată. Local: `GEMINI_API_KEY` în `.dev.vars`.
- `compatibility_flags` rămân; `fetch` spre `generativelanguage.googleapis.com` e permis.

### Teste

- `gemini.test.ts` (pure): `construiesteCerere` produce JSON-ul corect (magazin, istoric, prompt); `extrageCitari` mapează `file_citation` → `{sursa_id, titlu, pagina}` și ignoră citările fără `sursa`; `costMicrodolari("gemini-3.5-flash-lite", 7000, 600)` = 3.600 (0,36 cenți); `costMicrodolari("gemini-3.8-flash", 7000, 600)` = 7.500.
- `consum.test.ts` (D1): limita implicită vs. per utilizator; `intrebariAzi` numără doar ziua și emailul dat; blocat; raportul agregă corect pe 7/30 zile; `atingeVizita` idempotentă pe zi.
- Migrația 0002 se aplică peste 0001 în `setup.ts` (deja `readD1Migrations`).
- Rutele: `curl` local cu cheie reală și un PDF mic: indexare → `gata`; întrebare → răspuns cu citare; a 31-a întrebare → 429; utilizator blocat → 403.

### Ordinea implementării (un commit fiecare)

1. Migrația 0002 + `consum.ts` (TDD) + setări.
2. `gemini.ts` (funcții pure cu teste; apelurile REST) + secretul local.
3. Indexare: rutele admin + insignele + butonul; hook în upload/ștergere PDF.
4. `POST /api/chat` + limite + jurnal; middleware cu blocare și ultima vizită.
5. UI chat pe `/c/[slug]` + `scripts/chat.ts`; `/consum`.
6. `/admin/consum` + acțiunile de utilizator și setări.
7. README, CLAUDE.md, plan în `docs/plans/2026-09-09-cataloage-v2-chat.md`; deploy; secretul pe Worker; indexarea PDF-urilor existente din admin.

## Verificare end-to-end

Local (`npm run dev:worker`, `.dev.vars` cu `GEMINI_API_KEY`):
- `npm test` verde, `npm run check` curat.
- Admin: încarci un PDF → se indexează singur → insigna „gata” după câteva secunde.
- Pagina catalogului: pui o întrebare în română → răspuns cu cel puțin o citare care deschide PDF-ul la pagina indicată; contorul scade.
- Setezi limita implicită 2 → a 3-a întrebare e refuzată cu mesaj; setezi limita 10 pe emailul tău → merge; blochezi un email → 403 pe orice pagină.
- `/admin/consum` arată întrebările, tokenii și costul; `/consum` arată doar propriile întrebări.
- Ștergi PDF-ul → documentul dispare din Google (verificat prin listare `GET /v1beta/fileSearchStores/{magazin}/documents`).

Producție: deploy, `wrangler secret put GEMINI_API_KEY`, indexezi PDF-urile reale, o întrebare de probă, `npx wrangler tail` fără 5xx.

## Riscuri

- **API-ul Google evoluează** (Interactions API vs `generateContent`); `gemini.ts` izolează apelurile într-un singur fișier.
- **Confidențialitate**: cheie pe nivel plătit; documentele stau la Google indexate (ca și în NotebookLM acum).
- **Surse fără PDF** (doar link legis.md) nu se indexează în v2; se adaugă PDF-ul.
- **Timp de răspuns** 3–10 s per întrebare; UI-ul arată starea. Workerul nu ține nimic în memorie (streaming din R2 spre Google).
- **Costuri**: plafonate de limita zilnică × colegi; `/admin/consum` arată totalul lunar.

## Fișiere critice

- `/Users/dumitruprisacaru/ai/migrations/0002_chat.sql`
- `/Users/dumitruprisacaru/ai/src/lib/gemini.ts`, `src/lib/consum.ts` (+ teste)
- `/Users/dumitruprisacaru/ai/src/pages/api/chat/index.ts`, `src/pages/api/admin/surse/[id]/indexeaza.ts`, `.../indexare.ts`
- `/Users/dumitruprisacaru/ai/src/pages/c/[slug].astro` + `src/scripts/chat.ts`
- `/Users/dumitruprisacaru/ai/src/pages/admin/consum.astro`, `src/pages/consum.astro`
- `/Users/dumitruprisacaru/ai/src/middleware.ts` (blocare, ultima vizită); `src/pages/admin/actiuni/[...cale].ts` (utilizator, setări)
- Refolosite: `src/lib/fisiere.ts` (`cheieR2`, `serveste`), `src/lib/db.ts`, `src/lib/api.ts`, `src/lib/data.ts` (`aziChisinau`), tiparul de formulare POST + 303.
