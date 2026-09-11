// Trimiterile din raspuns, "[Titlu, pag. N]", devin linkuri mici in linie, care deschid PDF-ul
// la pagina respectiva. Se aplica pe HTML-ul deja randat din Markdown (parantezele patrate nu sunt
// atinse de randare). Titlul se potriveste cu citarile deja extrase (cu sursa_id), fara diacritice.
import type { Citare } from "./consum";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Titlul scurt pentru eticheta din text: primele 3 cuvinte, ca sa nu rupa randul.
function scurt(titlu: string): string {
  const cuvinte = titlu.split(/\s+/);
  return cuvinte.length > 3 ? `${cuvinte.slice(0, 3).join(" ")}…` : titlu;
}

export function legaReferinte(html: string, citari: Citare[]): string {
  const cunoscute = citari.map((c) => ({ ...c, n: norm(c.titlu) }));
  return html.replace(/\[([^[\]\n<>]+?),\s*(?:pag|p)\.?\s*(\d+)[^\]\n<>]*\]/g, (tot, brut: string, pag: string) => {
    const n = norm(brut);
    const pagina = Number(pag);
    const c = cunoscute.find((x) => x.n === n) ?? cunoscute.find((x) => x.n.startsWith(n) || n.startsWith(x.n));
    // Titlul din citari e text brut (se escapeaza); cel din HTML e deja escapat (ramane cum e).
    const titluHtml = c ? esc(c.titlu) : brut.trim();
    const eticheta = `${scurt(titluHtml)}, p. ${pagina}`;
    const titluComplet = `${titluHtml}, pagina ${pagina}`;
    if (!c?.sursa_id) return `<span class="ref" title="${titluComplet}">${eticheta}</span>`;
    return `<a class="ref" href="/f/pdf/${encodeURIComponent(c.sursa_id)}#page=${pagina}" target="_blank" rel="noopener" title="${titluComplet}">${eticheta}</a>`;
  });
}
