import { describe, expect, it } from "vitest";
import { asemanareMentiune, BUCATI_MENTIUNE, cautaMentiune, MENTIUNE_DATE_PERSONALE } from "./mentiune";

// Textul dat de Dumitru pe 15 sept. 2026, copiat exact: o schimbare aici trebuie sa fie intentionata.
const APROBAT =
  "Atenție: Documentul conține date cu caracter personal prelucrate în conformitate cu principiile de confidențialitate și securitate. Orice utilizare, stocare sau transfer ulterior al acestor date este permis strict în condițiile și limitele stabilite de Legea Republicii Moldova nr. 160 din 30.07.2026 privind protecția datelor cu caracter personal prelucrate în scopul prevenirii și combaterii infracțiunilor.";

// Mentiunile vechi, din actele reale (septembrie 2026: art.84.4 Cozma, Căușeni sediul Bender).
const VECHE_133 =
  "Atenţie! Documentul conţine date cu caracter personal, prelucrate în cadrul sistemului de evidență nr. 0000175 – 001, înregistrat în Registrul de evidență al operatorilor de date cu caracter personal www.registru.datepersonale.md. Prelucrarea ulterioară a acestor date poate fi efectuată numai în condiţiile prevăzute de Legea nr. 133 din 08.07.2011, privind protecţia datelor cu caracter personal.";
const VECHE_195 =
  "Atenție! Documentul conține date cu caracter personal. Prelucrarea ulterioară a acestor date poate fi efectuată numai în condițiile prevăzute în Legea nr. 195 din 25.07.2024 privind protecția datelor cu caracter personal.";

describe("mentiunea despre datele cu caracter personal", () => {
  it("textul din cod e exact cel aprobat, cu numele legii in bold", () => {
    expect(MENTIUNE_DATE_PERSONALE).toBe(APROBAT);
    expect(BUCATI_MENTIUNE.filter((b) => b.bold).map((b) => b.text)).toEqual(["Legea Republicii Moldova nr. 160 din 30.07.2026"]);
  });

  it("o recunoaste ca prezenta si cu ş/ţ cu sedila, cu spatii fixe sau cu alt text in jur", () => {
    const cuSedila = APROBAT.replace(/ț/g, "ţ").replace(/ș/g, "ş").replace(/ /g, (spatiu, poz: number) => (poz % 7 ? spatiu : " "));
    expect(cautaMentiune([{ i: 0, text: "Semnătura" }, { i: 4, text: cuSedila }])).toEqual({ stare: "prezenta", i: 4 });
    expect(cautaMentiune([{ i: 2, text: `Anexă pe 3 file. ${APROBAT}` }]).stare).toBe("prezenta");
  });

  it("gaseste formularile vechi sau schimbate si le cere inlocuite", () => {
    const altaLege = APROBAT.replace("nr. 160 din 30.07.2026", "nr. 133 din 08.07.2011");
    for (const vechi of [VECHE_133, VECHE_195, altaLege]) {
      const r = cautaMentiune([{ i: 0, text: "Directorul Penitenciarului nr. 6" }, { i: 9, text: vechi }]);
      expect(r).toMatchObject({ stare: "diferita", i: 9, text: vechi });
    }
  });

  it("nu ia drept mentiune un paragraf obisnuit despre date personale", () => {
    const obisnuit = "Deținutul a refuzat să semneze acordul privind prelucrarea datelor cu caracter personal.";
    expect(asemanareMentiune(obisnuit)).toBeLessThan(0.5);
    expect(cautaMentiune([{ i: 3, text: obisnuit }])).toEqual({ stare: "lipsa" });
    expect(cautaMentiune([])).toEqual({ stare: "lipsa" });
  });
});
