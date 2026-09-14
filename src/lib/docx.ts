// Documentele Word (.docx) ale corectorului, in doua sensuri:
// - citire: fiecare paragraf din corpul documentului devine text simplu, trimis modelului;
// - scriere: corecturile ("vechi" -> "nou" intr-un paragraf) intra inapoi ca revizii Word
//   (w:del / w:ins, Track Changes), cu formatarea run-ului din care fac parte; omul le accepta
//   sau le respinge in Word.
//
// Fara DOM, ca sa ruleze si in teste (workerd): XML-ul lui Word e generat de program, deci ajung un
// tokenizer (taguri si text) si un arbore minim peste tokeni. La scriere se rescriu doar run-urile
// atinse; restul tokenilor raman neschimbati. Browserul verifica la final ca XML-ul e bine format.
//
// Textul care se vede, dar nu se corecteaza (corectura iese "blocata"): campurile (cuprins,
// trimiteri, numere de pagina), reviziile existente, casetele de text si caracterele care nu sunt
// text (tab, rand nou). Antetele, subsolurile si notele de subsol nu se trimit deloc.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export class EroareDocx extends Error {}

// ---------------------------------------------------------------- arhiva

export interface Docx {
  intrari: Record<string, Uint8Array>;
  cale: string; // partea principala, de regula word/document.xml
  xml: string;
}

// Partea principala se ia din _rels/.rels (relatia officeDocument), nu se presupune.
function caleDocument(intrari: Record<string, Uint8Array>): string {
  const rels = intrari["_rels/.rels"];
  for (const tag of rels ? strFromU8(rels).match(/<Relationship\b[^>]*>/g) ?? [] : []) {
    if (!/Type="[^"]*\/officeDocument"/.test(tag)) continue;
    const tinta = /Target="([^"]+)"/.exec(tag)?.[1];
    if (tinta) return tinta.replace(/^\//, "");
  }
  return "word/document.xml";
}

export function deschideDocx(octeti: Uint8Array): Docx {
  let intrari: Record<string, Uint8Array>;
  try {
    intrari = unzipSync(octeti);
  } catch {
    throw new EroareDocx("Fișierul nu este un document Word .docx. Dacă e .doc sau are parolă, deschide-l în Word și salvează-l ca .docx, fără parolă.");
  }
  const cale = caleDocument(intrari);
  const parte = intrari[cale];
  if (!parte) throw new EroareDocx("Fișierul nu este un document Word .docx. Dacă e .doc sau are parolă, deschide-l în Word și salvează-l ca .docx, fără parolă.");
  return { intrari, cale, xml: strFromU8(parte) };
}

// Aceeasi arhiva, cu partea principala inlocuita; ordinea intrarilor ramane.
export function salveazaDocx(d: Docx, xml: string): Uint8Array {
  return zipSync({ ...d.intrari, [d.cale]: strToU8(xml) }, { level: 6 });
}

// ---------------------------------------------------------------- XML

interface Nod {
  nume: string; // "w:p", "w:r", "#text"
  de: number;   // tokenul de deschidere
  pana: number; // tokenul de inchidere; egal cu `de` la tagurile auto-inchise si la text
  copii: Nod[];
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
const numeTag = (t: string) => /^<\/?([^\s/>]+)/.exec(t)?.[1] ?? "";

function arbore(tokeni: string[]): Nod {
  const radacina: Nod = { nume: "#document", de: -1, pana: tokeni.length, copii: [] };
  const stiva: Nod[] = [radacina];
  for (let k = 0; k < tokeni.length; k++) {
    const t = tokeni[k]!;
    const sus = stiva[stiva.length - 1]!;
    if (t[0] !== "<") { sus.copii.push({ nume: "#text", de: k, pana: k, copii: [] }); continue; }
    if (t[1] === "?" || t[1] === "!") continue;
    const nume = numeTag(t);
    if (t[1] === "/") {
      for (let s = stiva.length - 1; s > 0; s--) {
        if (stiva[s]!.nume !== nume) continue;
        stiva[s]!.pana = k;
        stiva.length = s;
        break;
      }
      continue;
    }
    const nod: Nod = { nume, de: k, pana: k, copii: [] };
    sus.copii.push(nod);
    if (!t.endsWith("/>")) stiva.push(nod);
  }
  return radacina;
}

const contine = (nod: Nod, nume: string): boolean => nod.copii.some((c) => c.nume === nume || contine(c, nume));

const ENTITATI: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function decodeaza(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_t, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITATI[e]!
  );
}
const escapeaza = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeazaAtribut = (s: string) => escapeaza(s).replace(/"/g, "&quot;");

// ---------------------------------------------------------------- citire

export interface ParagrafText {
  i: number; // indicele paragrafului in document (AnalizaDocx.paragrafe)
  text: string;
}

interface Bucata {
  nod: Nod;
  fel: "text" | "alt"; // w:t sau orice alt copil al run-ului (tab, desen, camp)
  de: number;          // pozitia in textul paragrafului
  text: string;        // textul w:t; la "alt", caracterul care il reprezinta ("\t", "\n" sau nimic)
}

interface Run {
  nod: Nod;
  rPr: Nod | null;
  bucati: Bucata[];
}

interface Paragraf {
  text: string;
  editabil: boolean[]; // per caracter: se poate corecta
  runuri: Run[];
}

export interface AnalizaDocx {
  tokeni: string[];
  paragrafe: Paragraf[];
}

// Containerele prin care un run ramane corectabil. Oricare altul pe drum (w:ins, w:fldSimple,
// mc:Choice) face textul doar vizibil: un w:ins in alt w:ins nu e valid.
const EDITABILE = new Set(["w:hyperlink", "w:smartTag", "w:sdt", "w:sdtContent", "w:customXml", "w:dir", "w:bdo"]);
// Ce nu se vede ca text: textul deja sters, varianta de rezerva, proprietatile.
const SARITE = new Set(["w:del", "w:moveFrom", "mc:Fallback", "w:pPr", "w:rPr", "w:sdtPr", "w:sdtEndPr"]);
const REPREZENTARI: Record<string, string> = { "w:tab": "\t", "w:ptab": "\t", "w:br": "\n", "w:cr": "\n", "w:noBreakHyphen": "-" };

function analizeazaParagraf(tokeni: string[], p: Nod, camp: { adancime: number }): Paragraf {
  const runuri: Run[] = [];
  const editabil: boolean[] = [];
  let text = "";
  const adauga = (s: string, ed: boolean) => {
    text += s;
    for (let k = 0; k < s.length; k++) editabil.push(ed);
  };
  const run = (r: Nod, permis: boolean): Run => {
    const casetaText = contine(r, "w:p");
    const rezultat: Run = { nod: r, rPr: null, bucati: [] };
    for (const c of r.copii) {
      if (c.nume === "#text") continue;
      if (c.nume === "w:rPr") { rezultat.rPr = c; continue; }
      if (c.nume === "w:fldChar") {
        const tip = /w:fldCharType="(\w+)"/.exec(tokeni[c.de]!)?.[1];
        if (tip === "begin") camp.adancime++;
        if (tip === "end") camp.adancime = Math.max(0, camp.adancime - 1);
      }
      if (c.nume === "w:t") {
        const s = decodeaza(c.copii.filter((x) => x.nume === "#text").map((x) => tokeni[x.de]).join(""));
        rezultat.bucati.push({ nod: c, fel: "text", de: text.length, text: s });
        adauga(s, permis && !casetaText && camp.adancime === 0);
        continue;
      }
      const rep = REPREZENTARI[c.nume] ?? "";
      rezultat.bucati.push({ nod: c, fel: "alt", de: text.length, text: rep });
      adauga(rep, false);
    }
    return rezultat;
  };
  const coboara = (nod: Nod, permis: boolean) => {
    for (const c of nod.copii) {
      if (c.nume === "w:r") runuri.push(run(c, permis));
      else if (c.nume !== "w:p" && c.nume !== "#text" && !SARITE.has(c.nume) && c.copii.length) coboara(c, permis && EDITABILE.has(c.nume));
    }
  };
  coboara(p, true);
  return { text, editabil, runuri };
}

export function analizeazaDocument(xml: string): AnalizaDocx {
  const tokeni = xml.match(TOKEN) ?? [];
  const paragrafe: Paragraf[] = [];
  const camp = { adancime: 0 }; // campurile pot trece peste paragrafe (cuprinsul)
  const cauta = (nod: Nod) => {
    for (const c of nod.copii) {
      if (c.nume === "w:p") paragrafe.push(analizeazaParagraf(tokeni, c, camp));
      if (c.copii.length) cauta(c); // si paragrafele din tabele si casete de text
    }
  };
  cauta(arbore(tokeni));
  return { tokeni, paragrafe };
}

// Paragrafele de trimis modelului: cu cel putin un cuvant si cu text corectabil.
export function paragrafeDeCorectat(a: AnalizaDocx): ParagrafText[] {
  return a.paragrafe.flatMap((p, i) => (/\p{L}{2}/u.test(p.text) && p.editabil.includes(true) ? [{ i, text: p.text }] : []));
}

// ---------------------------------------------------------------- diferente

// Echivalente caracter la caracter (lungimea nu se schimba, deci pozitiile raman valabile).
// STRICT: ce nu e o corectura (ş/ţ cu sedila fata de ș/ț cu virgula, spatiul fix).
// LARG: in plus, ce modelul poate copia altfel cand citeaza fragmentul (ghilimele, tab, rand nou).
const STRICT: Record<string, string> = { "ş": "ș", "ţ": "ț", "Ş": "Ș", "Ţ": "Ț", " ": " ", " ": " " };
const LARG: Record<string, string> = {
  ...STRICT, "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "’": "'", "‘": "'", "\t": " ", "\n": " ",
};
const DE_NORMALIZAT = /[şţŞŢ  „“”«»’‘\t\n]/g;
const normalizeaza = (s: string, tabel: Record<string, string>) => s.replace(DE_NORMALIZAT, (c) => tabel[c] ?? c);

export interface Operatie {
  de: number;   // [de, pana) din textul vechi se sterge
  pana: number;
  ins: string;  // si in locul lui se pune asta (de == pana: inserare pura)
}

const CUVINTE = /[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu;

// Diferentele pe cuvinte (LCS), ca revizia sa marcheze "sa" -> "să", nu toata fraza.
export function diferente(vechi: string, nou: string): Operatie[] {
  const a = [...vechi.matchAll(CUVINTE)].map((m) => ({ t: normalizeaza(m[0], STRICT), de: m.index!, pana: m.index! + m[0].length }));
  const b = [...nou.matchAll(CUVINTE)].map((m) => m[0]);
  const bn = b.map((t) => normalizeaza(t, STRICT));
  const n = a.length, m = b.length;
  if (n * m > 250_000) return [{ de: 0, pana: vechi.length, ins: nou }];
  const lat = m + 1;
  const dp = new Uint32Array((n + 1) * lat);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * lat + j] = a[i]!.t === bn[j] ? dp[(i + 1) * lat + j + 1]! + 1 : Math.max(dp[(i + 1) * lat + j]!, dp[i * lat + j + 1]!);
    }
  }
  const ops: Operatie[] = [];
  let curenta: Operatie | null = null;
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i]!.t === bn[j]) {
      if (curenta) { ops.push(curenta); curenta = null; }
      i++; j++;
      continue;
    }
    const poz = i < n ? a[i]!.de : vechi.length;
    curenta ??= { de: poz, pana: poz, ins: "" };
    if (j >= m || (i < n && dp[(i + 1) * lat + j]! >= dp[i * lat + j + 1]!)) { curenta.pana = a[i]!.pana; i++; }
    else { curenta.ins += b[j]; j++; }
  }
  if (curenta) ops.push(curenta);
  return ops;
}

// ---------------------------------------------------------------- scriere

export interface Corectura {
  i: number;
  vechi: string;
  nou: string;
  tip: string;
  motiv: string;
}

// aplicata: e in document ca revizie; negasita: "vechi" nu apare in paragraf; suprapusa: apare doar
// peste o corectura deja aplicata; blocata: atinge text care nu se poate corecta (camp, revizie, tab);
// fara_schimbare: "nou" spune acelasi lucru.
export type StareAplicare = "aplicata" | "negasita" | "suprapusa" | "blocata" | "fara_schimbare";

export interface Aplicare extends Corectura {
  stare: StareAplicare;
  inainte: string; // contextul din paragraf, pentru lista din pagina
  dupa: string;
}

export interface Revizie {
  autor: string;
  data: string; // ISO fara milisecunde: 2026-09-14T10:00:00Z
}

// Caractere pe care XML-ul nu le accepta; tab-ul si randul nou dintr-o inserare devin spatiu.
const curataInserat = (s: string) => s.replace(/[\t\n\r]/g, " ").replace(/[ --￾￿]/g, "");

function idMaxim(tokeni: string[]): number {
  let max = 0;
  for (const t of tokeni) {
    if (t[0] !== "<" || !t.includes("w:id=")) continue;
    for (const m of t.matchAll(/\bw:id="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// Run-ul rescris: bucatile lui in ordine, cu textul sters in w:del si cel nou in w:ins, fiecare in
// run-uri cu aceleasi proprietati (rPr) ca originalul.
function refaRun(
  tokeni: string[], r: Run, sterse: Uint8Array, inainte: Map<number, string>, dupa: Map<number, string>,
  rev: Revizie, contor: { id: number }
): string {
  const deschidere = tokeni[r.nod.de]!;
  const rPr = r.rPr ? tokeni.slice(r.rPr.de, r.rPr.pana + 1).join("") : "";
  type Piesa = { fel: "n" | "d" | "i"; text?: string; xml?: string };
  const piese: Piesa[] = [];
  for (const b of r.bucati) {
    if (b.fel === "alt") { piese.push({ fel: "n", xml: tokeni.slice(b.nod.de, b.nod.pana + 1).join("") }); continue; }
    for (let k = 0; k < b.text.length; k++) {
      const x = b.de + k;
      if (inainte.has(x)) piese.push({ fel: "i", text: inainte.get(x) });
      piese.push({ fel: sterse[x] ? "d" : "n", text: b.text[k] });
      if (dupa.has(x)) piese.push({ fel: "i", text: dupa.get(x) });
    }
  }
  let iesire = "";
  for (let k = 0; k < piese.length; ) {
    const fel = piese[k]!.fel;
    let continut = "";
    let text = "";
    const goleste = () => {
      if (!text) return;
      continut += fel === "d"
        ? `<w:delText xml:space="preserve">${escapeaza(text)}</w:delText>`
        : `<w:t xml:space="preserve">${escapeaza(text)}</w:t>`;
      text = "";
    };
    for (; k < piese.length && piese[k]!.fel === fel; k++) {
      const p = piese[k]!;
      if (p.xml !== undefined) { goleste(); continut += p.xml; } else text += p.text;
    }
    goleste();
    const runXml = `${deschidere}${rPr}${continut}</w:r>`;
    if (fel === "n") { iesire += runXml; continue; }
    const tag = fel === "d" ? "w:del" : "w:ins";
    iesire += `<${tag} w:id="${contor.id++}" w:author="${escapeazaAtribut(rev.autor)}" w:date="${rev.data}">${runXml}</${tag}>`;
  }
  return iesire;
}

// Pune corecturile in document ca revizii. Fiecare "vechi" se cauta in paragraful lui (prima
// aparitie care nu se suprapune cu o corectura aplicata deja); diferenta pe cuvinte fata de "nou"
// devine w:del / w:ins. Corecturile care nu se pot pune raman in lista, cu starea lor.
export function aplicaCorecturi(a: AnalizaDocx, corecturi: Corectura[], rev: Revizie): { xml: string; aplicari: Aplicare[] } {
  const tokeni = a.tokeni.slice();
  const contor = { id: idMaxim(a.tokeni) + 1 };
  const aplicari: Aplicare[] = corecturi.map((c) => ({ ...c, stare: "negasita", inainte: "", dupa: "" }));
  const pePar = new Map<number, number[]>();
  corecturi.forEach((c, k) => pePar.set(c.i, [...(pePar.get(c.i) ?? []), k]));

  for (const [i, indici] of pePar) {
    const p = a.paragrafe[i];
    if (!p) continue;
    const L = p.text.length;
    const text = normalizeaza(p.text, LARG);
    const ocupat = new Uint8Array(L);
    const sterse = new Uint8Array(L);
    const inainte = new Map<number, string>();
    const dupa = new Map<number, string>();

    for (const k of indici) {
      const c = corecturi[k]!;
      const ap = aplicari[k]!;
      if (normalizeaza(c.vechi, STRICT) === normalizeaza(c.nou, STRICT)) { ap.stare = "fara_schimbare"; continue; }
      const cautat = normalizeaza(c.vechi, LARG);
      let poz = -1;
      let aparitii = 0;
      for (let de = text.indexOf(cautat); de !== -1; de = text.indexOf(cautat, de + 1)) {
        aparitii++;
        if (!ocupat.subarray(de, de + cautat.length).includes(1)) { poz = de; break; }
      }
      if (poz < 0) { ap.stare = aparitii ? "suprapusa" : "negasita"; continue; }
      const sfarsit = poz + cautat.length;
      ap.vechi = p.text.slice(poz, sfarsit);
      ap.inainte = p.text.slice(Math.max(0, poz - 40), poz);
      ap.dupa = p.text.slice(sfarsit, sfarsit + 40);

      const stergeri: [number, number][] = [];
      const inserari: { unde: Map<number, string>; poz: number; text: string }[] = [];
      let valid = true;
      for (const o of diferente(ap.vechi, c.nou)) {
        const de = poz + o.de, pana = poz + o.pana, ins = curataInserat(o.ins);
        if (pana > de) {
          for (let x = de; x < pana; x++) if (!p.editabil[x]) valid = false;
          stergeri.push([de, pana]);
          if (ins) inserari.push({ unde: dupa, poz: pana - 1, text: ins });
        } else if (!ins) {
          continue;
        } else if (de > 0 && p.editabil[de - 1]) {
          inserari.push({ unde: dupa, poz: de - 1, text: ins });
        } else if (de < L && p.editabil[de]) {
          inserari.push({ unde: inainte, poz: de, text: ins });
        } else {
          valid = false;
        }
      }
      if (!valid) { ap.stare = "blocata"; continue; }
      if (!stergeri.length && !inserari.length) { ap.stare = "fara_schimbare"; continue; }
      for (const [de, pana] of stergeri) sterse.fill(1, de, pana);
      for (const x of inserari) x.unde.set(x.poz, (x.unde.get(x.poz) ?? "") + x.text);
      ocupat.fill(1, poz, sfarsit);
      ap.stare = "aplicata";
    }

    for (const r of p.runuri) {
      const atins = r.bucati.some((b) => {
        if (b.fel !== "text") return false;
        for (let x = b.de; x < b.de + b.text.length; x++) if (sterse[x] || inainte.has(x) || dupa.has(x)) return true;
        return false;
      });
      if (!atins) continue;
      tokeni[r.nod.de] = refaRun(a.tokeni, r, sterse, inainte, dupa, rev, contor);
      for (let k = r.nod.de + 1; k <= r.nod.pana; k++) tokeni[k] = "";
    }
  }
  return { xml: tokeni.join(""), aplicari };
}
