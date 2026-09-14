-- Corectorul de documente Word: jurnalul corectarilor (fara textul documentului) si modelul lui.
-- Costurile intrebarilor si ale corectarilor se aduna prin vederea `cheltuieli`; limita pe zi
-- ramane doar pe intrebari (corectarile nu au limita, decizia lui Dumitru din 14 sept. 2026).

CREATE TABLE corectari (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  zi               TEXT NOT NULL,                        -- YYYY-MM-DD in fusul Chisinau
  fisier           TEXT NOT NULL,                        -- numele documentului; continutul nu se pastreaza
  caractere        INTEGER NOT NULL DEFAULT 0,           -- textul de corectat, la pornire
  loturi           INTEGER NOT NULL DEFAULT 0,           -- cereri reusite catre model
  corecturi        INTEGER NOT NULL DEFAULT 0,           -- propuse de model
  aplicate         INTEGER NOT NULL DEFAULT 0,           -- puse in document ca revizii
  model            TEXT NOT NULL,
  tokens_intrare   INTEGER NOT NULL DEFAULT 0,
  tokens_iesire    INTEGER NOT NULL DEFAULT 0,
  cost_microdolari INTEGER NOT NULL DEFAULT 0,
  credite          REAL NOT NULL DEFAULT 0,
  stare            TEXT NOT NULL CHECK (stare IN ('in_curs','ok','eroare')),
  mesaj            TEXT,
  durata_ms        INTEGER,
  creat_la         TEXT NOT NULL,
  actualizat_la    TEXT NOT NULL
);
CREATE INDEX idx_corectari_email ON corectari(email, creat_la);
CREATE INDEX idx_corectari_zi ON corectari(zi);

CREATE VIEW cheltuieli AS
  SELECT email, zi, tokens_intrare, tokens_iesire, cost_microdolari, credite FROM intrebari
  UNION ALL
  SELECT email, zi, tokens_intrare, tokens_iesire, cost_microdolari, credite FROM corectari;

INSERT INTO setari VALUES ('model_corector', 'deepseek-flash');
