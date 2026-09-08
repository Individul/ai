// Contextul trimis modelului GLM (Z.AI nu are File Search). Portat din ai2/retrieve.py.
//
// Daca textul intregului catalog incape in buget, modelul primeste tot (calitate maxima).
// Altfel: TF-IDF simplu pe cuvinte trunchiate la 4 litere (prinde flexiunile romanesti:
// liberare/liberarii -> "libe"), fara diacritice, fara cuvinte de legatura; pagina 1 a fiecarei
// surse intra prima (modelul afla ce acte exista), apoi paginile cu scorul cel mai mare, pana la
// buget. Bugetul numara doar textul paginilor, nu antetele.
//
// Fiecare pagina are antetul "=== Titlu | pag. N ===", iar modelul citeaza "[Titlu, pag. N]";
// extrageCitariText leaga citarile inapoi de surse (pentru linkurile la PDF).

import type { Citare } from "./consum";
import type { Pagina } from "./text";

export interface SursaText {
  id: string;
  titlu: string;
  pagini: Pagina[];
}

export interface Context {
  text: string;
  mod: "integral" | "filtrat";
  caractere: number;
  pagini_trimise: number;
  pagini_total: number;
}

const STOP = new Set(
  `si de la in un o pe ce care este sunt era a al ai ale cu din nu mai unui unei acest aceasta acesta
   dar sau ca prin despre cum unde cand sa se iar ori fie daca ci pentru catre spre sub peste intre lor
   lui ei el ea noi voi ii le il isi va vor fi fost avea are au am ati cel cea cei cele acel acea tot
   toate toti orice mult foarte asa atat decat dupa pana fara insa deci apoi ma te ne vi`.split(/\s+/)
);
const STEM = 4;

function faraDiacritice(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// "Liberarea condiționată" -> ["libe", "cond"]
export function tokeni(text: string): string[] {
  const cuvinte = faraDiacritice(text).match(/[a-z0-9]{2,}/g) ?? [];
  return cuvinte.filter((c) => !STOP.has(c)).map((c) => c.slice(0, STEM));
}

export function antetPagina(titlu: string, pagina: number): string {
  return `=== ${titlu} | pag. ${pagina} ===`;
}

function numara(lista: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of lista) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export function construiesteContext(surse: SursaText[], intrebare: string, buget: number): Context {
  interface Intrare { sursa: number; pagina: Pagina; titlu: string; prima: boolean }
  const intrari: Intrare[] = [];
  surse.forEach((s, i) => s.pagini.forEach((p, k) => intrari.push({ sursa: i, pagina: p, titlu: s.titlu, prima: k === 0 })));
  const total = intrari.reduce((n, e) => n + e.pagina.text.length, 0);
  const compune = (alese: Intrare[]) => alese.map((e) => `${antetPagina(e.titlu, e.pagina.pagina)}\n${e.pagina.text}`).join("\n\n");

  if (total <= buget) {
    return { text: compune(intrari), mod: "integral", caractere: total, pagini_trimise: intrari.length, pagini_total: intrari.length };
  }

  const q = numara(tokeni(intrebare));
  const tf = intrari.map((e) => numara(tokeni(e.pagina.text)));
  const df = new Map<string, number>();
  for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + intrari.length / (1 + (df.get(t) ?? 0)));
  const titluri = surse.map((s) => new Set(tokeni(s.titlu)));

  const scor = (i: number): number => {
    const e = intrari[i]!;
    let s = 0;
    for (const [t, qw] of q) {
      const f = tf[i]!.get(t);
      if (f) s += qw * idf(t) * f;
      if (titluri[e.sursa]!.has(t)) s += qw * idf(t) * 3;
    }
    return s / Math.max(e.pagina.text.length, 1) ** 0.2;
  };

  const ordine = intrari.map((_, i) => i).sort((a, b) => scor(b) - scor(a) || a - b);
  const prime = intrari.map((_, i) => i).filter((i) => intrari[i]!.prima);
  const candidati = [...prime, ...ordine.filter((i) => !intrari[i]!.prima)];

  const alese = new Set<number>();
  let folosit = 0;
  for (const i of candidati) {
    const marime = intrari[i]!.pagina.text.length;
    if (folosit + marime > buget) continue;
    alese.add(i);
    folosit += marime;
    if (folosit >= buget) break;
  }
  const selectie = [...alese].sort((a, b) => a - b).map((i) => intrari[i]!);
  return { text: compune(selectie), mod: "filtrat", caractere: folosit, pagini_trimise: selectie.length, pagini_total: intrari.length };
}

// "[Titlu, pag. N]" / "[Titlu, p. N]" din raspuns -> citari unice, in ordinea aparitiei.
// GLM mai pune si articolul in paranteza ("[Titlu, pag. 2, Articolul 3]", "[Titlu, art. 7, pag. 3]"):
// ce e dupa pagina se ignora, iar ce e inaintea ei intra in titlu si se potriveste prin prefix.
// Titlul se potriveste fara diacritice si majuscule; daca modelul il scurteaza, prefixul ajunge.
export function extrageCitariText(text: string, surse: { id: string; titlu: string }[]): Citare[] {
  const norm = (s: string) => faraDiacritice(s).replace(/\s+/g, " ").trim();
  const catalog = surse.map((s) => ({ ...s, n: norm(s.titlu) }));
  const citari: Citare[] = [];
  const vazute = new Set<string>();
  for (const m of text.matchAll(/\[([^[\]\n]+?),\s*(?:pag|p)\.?\s*(\d+)[^\]\n]*\]/g)) {
    const brut = m[1]!.trim();
    const pagina = Number(m[2]);
    const n = norm(brut);
    const sursa = catalog.find((s) => s.n === n) ?? catalog.find((s) => s.n.startsWith(n) || n.startsWith(s.n));
    const cheie = `${sursa?.id ?? n}|${pagina}`;
    if (vazute.has(cheie)) continue;
    vazute.add(cheie);
    citari.push({ sursa_id: sursa?.id ?? null, titlu: sursa?.titlu ?? brut, pagina });
  }
  return citari;
}
