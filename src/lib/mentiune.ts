// Mentiunea obligatorie despre datele cu caracter personal (decizia lui Dumitru, 15 sept. 2026): trebuie sa
// fie la toate actele verificate, exact in forma aprobata. Verificarea e in cod, nu la model: textul e fix,
// iar un model l-ar putea „imbunatati”. Trei cazuri, vazute in actele reale:
//   - prezenta: textul aprobat exista (de regula ultimul paragraf din corp, ca in demersul Cazacu);
//   - diferita: exista o mentiune veche sau altfel formulata („Atenţie! ... Legea nr. 133 din 08.07.2011”,
//     „... Legea nr. 195 din 25.07.2024”) -> se inlocuieste cu textul aprobat, ca revizie;
//   - lipsa: se adauga la sfarsitul corpului, ca revizie, cu formatarea din actele care o au deja.

import type { ParagrafIntreg } from "./docx";

// Bucatile textului aprobat, cu formatarea din actele care il au deja (demersul Cazacu, 15 sept. 2026):
// 10 pt, aliniat stanga-dreapta, numele legii in bold.
export const BUCATI_MENTIUNE: { text: string; bold?: boolean }[] = [
  { text: "Atenție: Documentul conține date cu caracter personal prelucrate în conformitate cu principiile de confidențialitate și securitate. Orice utilizare, stocare sau transfer ulterior al acestor date este permis strict în condițiile și limitele stabilite de " },
  { text: "Legea Republicii Moldova nr. 160 din 30.07.2026", bold: true },
  { text: " privind protecția datelor cu caracter personal prelucrate în scopul prevenirii și combaterii infracțiunilor." },
];
export const MENTIUNE_DATE_PERSONALE = BUCATI_MENTIUNE.map((b) => b.text).join("");
export const MARIME_MENTIUNE = 20; // jumatati de punct: 10 pt

export type StareMentiune = "prezenta" | "diferita" | "lipsa";

export interface CautareMentiune {
  stare: StareMentiune;
  i?: number;        // paragraful cu mentiunea (prezenta sau diferita)
  text?: string;     // textul lui, cand e diferita
  asemanare?: number;
}

// Egal „in fond”: ş/ţ cu sedila = ș/ț cu virgula, spatiul fix = spatiu, spatiile multiple = unul.
const egalizeaza = (s: string) =>
  s.replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț").replace(/[  \s]+/g, " ").trim();

// Pentru asemanare: fara diacritice, litere mici, doar cuvinte.
const cuvinte = (s: string) =>
  new Set(s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

const CANONIC = egalizeaza(MENTIUNE_DATE_PERSONALE);
const CUVINTE_CANONIC = cuvinte(MENTIUNE_DATE_PERSONALE);

// Coeficientul Dice pe multimile de cuvinte: 1 = aceleasi cuvinte, 0 = niciunul comun.
export function asemanareMentiune(text: string): number {
  const a = cuvinte(text);
  if (!a.size) return 0;
  let comune = 0;
  for (const c of a) if (CUVINTE_CANONIC.has(c)) comune++;
  return (2 * comune) / (a.size + CUVINTE_CANONIC.size);
}

// O mentiune veche incepe cu „Atenție” si vorbeste despre date cu caracter personal; atunci ajunge o
// asemanare mica (variantele reale au 0,3–0,4). Fara „Atenție” in fata, cerem mult mai mult, ca un paragraf
// obisnuit care pomeneste datele personale sa nu fie luat drept mentiune.
const PRAG_CU_ATENTIE = 0.2;
const PRAG_FARA_ATENTIE = 0.5;

export function cautaMentiune(paragrafe: Pick<ParagrafIntreg, "i" | "text">[]): CautareMentiune {
  for (const p of paragrafe) {
    if (egalizeaza(p.text).includes(CANONIC)) return { stare: "prezenta", i: p.i };
  }
  let cel: CautareMentiune | null = null;
  for (const p of paragrafe) {
    const fara = p.text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (!fara.includes("caracter personal") || p.text.length > MENTIUNE_DATE_PERSONALE.length * 3) continue;
    const asemanare = asemanareMentiune(p.text);
    const prag = /^\W*atentie/.test(fara) ? PRAG_CU_ATENTIE : PRAG_FARA_ATENTIE;
    if (asemanare >= prag && (!cel || asemanare > (cel.asemanare ?? 0))) {
      cel = { stare: "diferita", i: p.i, text: p.text, asemanare };
    }
  }
  return cel ?? { stare: "lipsa" };
}
