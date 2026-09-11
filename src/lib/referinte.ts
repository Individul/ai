// Trimiterile din raspuns, "[Titlu, pag. N]", devin linkuri mici in linie, care deschid PDF-ul
// la pagina respectiva (in vizorul din pagina, cu textul evidentiat; fara JavaScript, in tab nou).
// Se aplica pe HTML-ul deja randat din Markdown (parantezele patrate nu sunt atinse de randare).
// Titlul se potriveste cu citarile deja extrase (cu sursa_id), fara diacritice.
import type { Citare } from "./consum";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Titlul scurt pentru eticheta din text: primele 3 cuvinte, ca sa nu rupa randul.
function scurt(titlu: string): string {
  const cuvinte = titlu.split(/\s+/);
  return cuvinte.length > 3 ? `${cuvinte.slice(0, 3).join(" ")}…` : titlu;
}

// Ce sa evidentieze vizorul: ultimul articol / punct / alineat mentionat inaintea trimiterii,
// ca "art:13", "pct:218", "alin:2". Un alineat vine cu articolul sau punctul lui, in ordine
// ("art:91;alin:2"): vizorul cauta articolul, apoi alineatul in interiorul lui. Textul primit e HTML.
export function termenCautare(htmlInainte: string): string | null {
  const text = htmlInainte.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").slice(-220);
  const re = /\b(?:(art(?:icol(?:ul|ului|ele)?)?\.?)\s*(\d+[¹²³⁰-⁹]*)|(pct\.?|punct(?:ul|ele)?)\s*(\d+[¹²³⁰-⁹]*)|(alin(?:\.|eat(?:ul|ele))?)\s*\(?(\d+)\)?)/gi;
  let parinte: string | null = null; // ultimul articol sau punct
  let alineat: string | null = null; // alineatul de dupa el
  for (const m of text.matchAll(re)) {
    if (m[2]) { parinte = `art:${m[2]}`; alineat = null; }
    else if (m[4]) { parinte = `pct:${m[4]}`; alineat = null; }
    else if (m[6]) alineat = `alin:${m[6]}`;
  }
  if (parinte && alineat) return `${parinte};${alineat}`;
  return parinte ?? alineat;
}

// Termenii de cautare pentru fiecare (sursa, pagina) citata in raspuns, adunati de la toate
// trimiterile spre acea pagina; pentru lista "Surse" de sub raspuns, care nu are text inainte.
export function termeniPeCitare(text: string, citari: Citare[]): Record<string, string> {
  const cunoscute = citari.map((c) => ({ ...c, n: norm(c.titlu) }));
  const rezultat: Record<string, Set<string>> = {};
  for (const m of text.matchAll(/\[([^[\]\n<>]+?),\s*(?:pag|p)\.?\s*(\d+)[^\]\n<>]*\]/g)) {
    const n = norm(m[1]!);
    const c = cunoscute.find((x) => x.n === n) ?? cunoscute.find((x) => x.n.startsWith(n) || n.startsWith(x.n));
    if (!c?.sursa_id) continue;
    const termen = termenCautare(text.slice(Math.max(0, m.index! - 600), m.index!));
    if (!termen) continue;
    const cheie = `${c.sursa_id}|${Number(m[2])}`;
    (rezultat[cheie] ??= new Set()).add(termen);
  }
  return Object.fromEntries(Object.entries(rezultat).map(([k, v]) => [k, [...v].join(";")]));
}

export function legaReferinte(html: string, citari: Citare[]): string {
  const cunoscute = citari.map((c) => ({ ...c, n: norm(c.titlu) }));
  return html.replace(
    /\[([^[\]\n<>]+?),\s*(?:pag|p)\.?\s*(\d+)[^\]\n<>]*\]/g,
    (tot, brut: string, pag: string, pozitie: number) => {
      const n = norm(brut);
      const pagina = Number(pag);
      const c = cunoscute.find((x) => x.n === n) ?? cunoscute.find((x) => x.n.startsWith(n) || n.startsWith(x.n));
      // Titlul din citari e text brut (se escapeaza); cel din HTML e deja escapat (ramane cum e).
      const titluHtml = c ? esc(c.titlu) : brut.trim();
      const eticheta = `${scurt(titluHtml)}, p. ${pagina}`;
      const titluComplet = `${titluHtml}, pagina ${pagina}`;
      if (!c?.sursa_id) return `<span class="ref" title="${titluComplet}">${eticheta}</span>`;
      const cauta = termenCautare(html.slice(Math.max(0, pozitie - 600), pozitie));
      const dateVizor = ` data-vizor="${encodeURIComponent(c.sursa_id)}" data-pagina="${pagina}" data-titlu="${titluHtml}"${cauta ? ` data-cauta="${cauta}"` : ""}`;
      return `<a class="ref" href="/f/pdf/${encodeURIComponent(c.sursa_id)}#page=${pagina}" target="_blank" rel="noopener" title="${titluComplet}"${dateVizor}>${eticheta}</a>`;
    }
  );
}
