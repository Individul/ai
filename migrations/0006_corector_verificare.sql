-- Corectorul are doua moduri: `corectura` (corpul, pe loturi) si `verificare` (tot documentul intr-o
-- singura cerere, cu antete si observatii). Jurnalul tine modul si cate observatii au iesit; costul
-- intra in totaluri tot prin vederea `cheltuieli`, care nu se schimba.

ALTER TABLE corectari ADD COLUMN mod TEXT NOT NULL DEFAULT 'corectura' CHECK (mod IN ('corectura','verificare'));
ALTER TABLE corectari ADD COLUMN observatii INTEGER NOT NULL DEFAULT 0;
