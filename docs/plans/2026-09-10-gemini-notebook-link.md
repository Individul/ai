# Design: linkul spre caietul Gemini Notebook al culegerii

**Scop (Dumitru, 10 sept. 2026):** colegii să ajungă dintr-un clic la caietul Gemini Notebook al fiecărei culegeri, pentru uneltele Studio (rezumat audio, video, hartă mentală, teste). Caietele sunt ale lui Dumitru; colegii au drept de vizualizare: pot întreba și pot folosi materialele generate de el, nu pot genera.

**Ce nu se poate (verificat sept. 2026):** Gemini Notebook pentru cont personal nu are API și nu se poate încadra în pagină; în caiete partajate, generarea de materiale Studio cere drept de editare. Deci hub-ul oferă doar linkul; partajarea (adresele colegilor, ca viewer) se face în NotebookLM. Întrebările puse acolo se numără în contul Google al fiecăruia, nu în jurnalul hub-ului.

**Design**
- Coloana `cataloage.url_notebook` și validarea `urlNotebookValid` (notebook.google.com / notebooklm.google.com / gol) există din v1; fără migrație.
- `FormularCatalog.astro`: câmpul „Caiet Gemini Notebook (link)” revine, cu lămurirea „Partajează caietul cu adresele colegilor, ca viewer; gol = fără link”.
- `c/[slug].astro`: în antet, sub descriere, când linkul e pus: „Deschide în Gemini Notebook ↗” (`target=_blank`, `rel=noopener`) și lămurirea „rezumate audio, hărți mentale și teste; întrebările de acolo nu se numără aici”.
- Fără contorizare, fără apeluri la Google.

**Verificare:** `npm test`, `npm run check`; local: linkul se salvează din Admin și apare în antet; fără link, nimic. Deploy.
