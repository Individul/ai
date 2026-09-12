// Compunerea textului unei pagini din elementele date de pdf.js (browser, la extragere).
//
// Actele Republicii Moldova folosesc articole si litere cu exponent: 217¹, 208⁵, b¹). In PDF,
// exponentul e un element separat, mai mic si ridicat fata de linia de baza (verificat pe Codul
// penal, 12 sept. 2026: inaltime 6,6 fata de 12, linia de baza cu 6 puncte mai sus). Lipit cu
// spatii, "217¹" devenea "217 1", adica 474 de numere de articol stricate in cele trei acte.
// Aici il lipim inapoi, ca in actul tiparit.

export interface ElementPagina {
  text: string;       // item.str
  inaltime: number;   // item.height
  y: number;          // item.transform[5], linia de baza
  rand_nou: boolean;  // item.hasEOL
}

const EXPONENT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

// Exponent = cifra, vizibil mai mica decat vecinul dinainte si ridicata fata de el.
// Cifrele mai mici pe aceeasi linie (note de subsol) sau mai jos (indici) raman cum sunt.
function esteExponent(el: ElementPagina, anterior: ElementPagina): boolean {
  return (
    el.inaltime > 0 && anterior.inaltime > 0 &&
    el.inaltime < anterior.inaltime * 0.8 &&
    el.y > anterior.y &&
    /^\d+$/.test(el.text.trim())
  );
}

export function compunePagina(elemente: ElementPagina[]): string {
  let text = "";
  let anterior: ElementPagina | null = null;
  for (const el of elemente) {
    const gol = !el.text.trim();
    if (!gol && anterior && esteExponent(el, anterior)) {
      // Lipit de numarul dinainte, fara spatiu; spatiul de dupa cade la punctuatie, mai jos.
      text = text.replace(/\s+$/, "") + el.text.trim().replace(/\d/g, (d) => EXPONENT[d]!) + " ";
    } else {
      text += el.text + (el.rand_nou ? "\n" : " ");
    }
    if (!gol) anterior = el;
  }
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/ +([.,;:)\]])/g, "$1")
    .trim();
}
