import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { analizeazaIntreg, type Docx } from "./docx";
import { aplicaCuMentiune, asemanareMentiune, BUCATI_MENTIUNE, cautaMentiune, despreMentiune, MENTIUNE_DATE_PERSONALE } from "./mentiune";

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

const REV = { autor: "Corector AI", data: "2026-09-15T10:00:00Z" };
const document = (...paragrafe: string[]): Docx => {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragrafe
    .map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`;
  return { intrari: { "word/document.xml": strToU8(xml) }, cale: "word/document.xml", xml };
};
// Textul paragrafelor dupa „Accepta tot” in Word.
const acceptat = (xml: string) =>
  [...xml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "").matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((m) => [...m[1]!.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));

describe("aplicaCuMentiune (acelasi cod in hub si in aplicatie)", () => {
  it("mentiunea corecta ramane; corecturile modelului pe ea se arunca, celelalte intra", () => {
    const d = document("Deținutii au fost informati.", APROBAT);
    const r = aplicaCuMentiune(d, analizeazaIntreg(d), [
      { i: 0, vechi: "informati", nou: "informați", tip: "ortografie", motiv: "" },
      { i: 1, vechi: "Atenție:", nou: "ATENȚIE!", tip: "formulare", motiv: "" },
    ], REV);
    expect(r.mentiune).toBe("prezenta");
    expect(r.aplicari.map((a) => a.nou)).toEqual(["informați"]);
    expect(acceptat(r.xml["word/document.xml"]!)).toEqual(["Deținutii au fost informați.", APROBAT]);
  });

  it("mentiunea veche se aduce la forma aprobata, caracter cu caracter", () => {
    const d = document("Directorul", VECHE_133);
    const r = aplicaCuMentiune(d, analizeazaIntreg(d), [], REV);
    expect(r.mentiune).toBe("corectata");
    expect(acceptat(r.xml["word/document.xml"]!)).toEqual(["Directorul", APROBAT]);
  });

  it("mentiunea lipsa se adauga la sfarsitul corpului", () => {
    const d = document("Nota informativă.", "Șef secție");
    const r = aplicaCuMentiune(d, analizeazaIntreg(d), [], REV);
    expect(r.mentiune).toBe("adaugata");
    expect(acceptat(r.xml["word/document.xml"]!)).toEqual(["Nota informativă.", "Șef secție", APROBAT]);
  });

  it("recunoaste observatiile modelului despre mentiune", () => {
    expect(despreMentiune({ text: "„Atenție: Documentul conține date cu caracter personal” trimite la o lege recentă; de verificat." })).toBe(true);
    expect(despreMentiune({ text: "Lipsesc datele de identificare ale condamnatului." })).toBe(false);
  });
});
