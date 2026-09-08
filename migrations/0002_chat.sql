-- Chat propriu (Gemini File Search) cu jurnal de consum si limite per utilizator.
-- Fiecare catalog are un "magazin" de documente la Google; fiecare sursa cu PDF are un document acolo.

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
  model            TEXT NOT NULL DEFAULT '',
  tokens_intrare   INTEGER NOT NULL DEFAULT 0,
  tokens_iesire    INTEGER NOT NULL DEFAULT 0,
  cost_microdolari INTEGER NOT NULL DEFAULT 0,                 -- calculat din tarifele modelului
  stare            TEXT NOT NULL CHECK (stare IN ('ok','eroare','refuzat')),
  durata_ms        INTEGER,
  creat_la         TEXT NOT NULL
);
CREATE INDEX idx_intrebari_email_zi ON intrebari(email, zi);
CREATE INDEX idx_intrebari_catalog ON intrebari(catalog_id, creat_la);

-- Doar cei cu setari proprii sau cu vizite inregistrate; restul folosesc limita implicita.
CREATE TABLE utilizatori (
  email          TEXT PRIMARY KEY,
  limita_zi      INTEGER,                                      -- NULL = limita implicita
  blocat         INTEGER NOT NULL DEFAULT 0,
  nota           TEXT,
  ultima_vizita  TEXT,                                         -- YYYY-MM-DD
  actualizat_la  TEXT NOT NULL
);

CREATE TABLE setari (cheie TEXT PRIMARY KEY, valoare TEXT NOT NULL);
INSERT INTO setari VALUES ('limita_zi_implicita', '15'), ('model', 'gemini-3.5-flash-lite');
