-- Corectorul: caracterele trimise efectiv modelului, adunate pe loturi. Serverul le compara cu
-- bugetul declarat la pornire (caractere), ca un client rau intentionat sa nu poata folosi
-- ruta de lot ca poarta libera spre model.

ALTER TABLE corectari ADD COLUMN caractere_trimise INTEGER NOT NULL DEFAULT 0;
