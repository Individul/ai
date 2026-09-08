-- Cataloage de legislatie: fiecare catalog are un notebook NotebookLM, surse (documente)
-- si Audio Overview-uri descarcate. Fisierele stau in R2 (pdf/{sursa.id}, audio/{audio.id});
-- aici doar metadatele. Fara owner: datele sunt comune tuturor celor din Access.
CREATE TABLE cataloage (
  id             TEXT PRIMARY KEY,                      -- uuid
  slug           TEXT NOT NULL UNIQUE,                  -- /c/legislatia-penala
  titlu          TEXT NOT NULL,
  descriere      TEXT NOT NULL DEFAULT '',
  pictograma     TEXT NOT NULL DEFAULT 'carte',         -- cheie din setul fix de SVG (Pictograma.astro)
  culoare        TEXT NOT NULL DEFAULT 'violet' CHECK (culoare IN ('coral','teal','violet','verde','galben')),
  stare          TEXT NOT NULL DEFAULT 'in_lucru' CHECK (stare IN ('activ','in_lucru','arhivat')),
  url_notebook   TEXT NOT NULL DEFAULT '',              -- https://notebooklm.google.com/notebook/...
  note_utilizare TEXT NOT NULL DEFAULT '',              -- markdown (intrebari sugerate etc.)
  ordine         INTEGER NOT NULL DEFAULT 0,
  creat_la       TEXT NOT NULL,                         -- ISO 8601 UTC cu ms, generat de aplicatie
  actualizat_la  TEXT NOT NULL                          -- idem; concurenta optimista + "ultima actualizare"
);
CREATE INDEX idx_cataloage_stare_ordine ON cataloage(stare, ordine);

-- Catalogul se arhiveaza, nu se sterge: RESTRICT e plasa de siguranta.
CREATE TABLE surse (
  id            TEXT PRIMARY KEY,
  catalog_id    TEXT NOT NULL REFERENCES cataloage(id) ON DELETE RESTRICT,
  titlu         TEXT NOT NULL,
  tip           TEXT NOT NULL CHECK (tip IN ('lege','cod','ordin','regulament','dispozitie','circulara','instructiune','alt')),
  numar         TEXT,                                   -- "nr. 218"
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
  data        TEXT NOT NULL CHECK (data GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- data generarii in NotebookLM
  tip_mime    TEXT NOT NULL,                            -- audio/mpeg | audio/mp4 | audio/wav
  fisier_nume TEXT NOT NULL,
  marime      INTEGER NOT NULL,
  ordine      INTEGER NOT NULL DEFAULT 0,
  creat_la    TEXT NOT NULL
);
CREATE INDEX idx_audio_catalog ON audio(catalog_id, ordine);
