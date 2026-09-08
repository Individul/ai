-- Motor alternativ Z.AI (GLM): textul PDF-urilor se extrage in browser si sta in R2 (text/{sursa.id});
-- aici doar contoarele lui. Intrebarile pe GLM se platesc din planul de coding, masurat in credite.

ALTER TABLE surse ADD COLUMN text_pagini INTEGER;      -- NULL = text neextras; 0 pagini cu text = PDF scanat
ALTER TABLE surse ADD COLUMN text_caractere INTEGER;

ALTER TABLE intrebari ADD COLUMN credite REAL NOT NULL DEFAULT 0;   -- creditele planului Z.AI (0 la Gemini)

INSERT INTO setari VALUES ('buget_context', '3000000');             -- caractere trimise modelului GLM
