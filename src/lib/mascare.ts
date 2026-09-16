// Mascarea datelor personale inainte ca textul sa plece la model (16 sept. 2026, cerinta lui Dumitru).
//
// Fisierul nu pleaca niciodata din calculator, dar textul pleaca intreg, cu nume, IDNP-uri, telefoane si
// adrese — exact datele pe care mentiunea obligatorie din fiecare act le declara protejate. Aici sunt
// inlocuite, inainte de plecare, cu date false dar plauzibile („Cazacu Valeriu” -> „Chiriac Vasile”), iar
// corecturile intoarse de model se desfac inapoi inainte de a fi puse in document. Harta ramane pe loc: in
// browser la hub, in procesul node la aplicatia de Mac. Modelul vede un act firesc, complet, despre altcineva.
//
// De ce nume false si nu semne opace: textul ramane firesc, deci promptul nu se schimba si modelul verifica
// mai departe gramatica din jurul numelui. Riscul — un nume inventat sa ajunga in actul real — il opresc trei
// paznici: corectura care atinge o zona mascata se arunca, corectura in care mai ramane o urma de nume fals se
// arunca, iar inainte de scriere textul inserat se scaneaza inca o data.
//
// E pseudonimizare, nu anonimizare: harta exista, contextul ramane (fapta, penitenciarul, articolul). Sub
// Legea 160 datele raman date personale; ce se castiga e ca identificatorii directi nu ajung la furnizor.

import { caLaCautare, type Corectura } from "./docx";
import { numara, type Observatie } from "./corector";
import {
  DECLANSATORI, DECLANSATORI_RU, GRADE, NUME_FALSE, NU_SUNT_NUME, PRENUME, PRENUME_FALSE_F, PRENUME_FALSE_M,
  PRENUME_M,
} from "./nume-md";

export const NIVELURI = ["fara", "identificatori", "tot"] as const;
export type Nivel = (typeof NIVELURI)[number];
export const NIVEL_IMPLICIT: Nivel = "tot";

export const ETICHETA_NIVEL: Record<Nivel, string> = {
  fara: "Fără mascare",
  identificatori: "Doar identificatorii",
  tot: "Nume și identificatori",
};

export const FELURI = ["persoana", "idnp", "telefon", "email", "iban", "act", "auto", "adresa", "nastere"] as const;
export type Fel = (typeof FELURI)[number];

export const ETICHETA_FEL: Record<Fel, [string, string]> = {
  persoana: ["nume", "nume"],
  idnp: ["IDNP", "IDNP-uri"],
  telefon: ["telefon", "telefoane"],
  email: ["adresă de e-mail", "adrese de e-mail"],
  iban: ["cont bancar", "conturi bancare"],
  act: ["act de identitate", "acte de identitate"],
  auto: ["număr de înmatriculare", "numere de înmatriculare"],
  adresa: ["adresă", "adrese"],
  nastere: ["dată de naștere", "date de naștere"],
};

export interface Entitate {
  fel: Fel;
  i: number;     // paragraful
  de: number;    // pozitia in textul original al paragrafului
  pana: number;
  text: string;  // ce scrie in document
}

export interface Pereche { fel: Fel; adevarat: string; fals: string }

export interface Harta {
  nivel: Nivel;
  perechi: Pereche[];                        // pentru „ce am ascuns”, in ordinea intalnirii
  zone: Map<number, [number, number][]>;     // zonele mascate, in textul MASCAT, per paragraf
  mascate: Map<number, string>;              // textul mascat, per paragraf
  inapoi: [string, string][];                // fals -> adevarat, cele lungi intai
  radacini: Set<string>;                     // radacinile numelor false, pentru paznicul de reziduu
  falsuri: string[];                         // valorile false intregi (identificatori), pentru acelasi paznic
}

const hartaGoala = (nivel: Nivel): Harta => ({
  nivel, perechi: [], zone: new Map(), mascate: new Map(), inapoi: [], radacini: new Set(), falsuri: [],
});

const faraDiacritice = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const RADACINA = 4; // „Cazacu” si „Cazacului” sunt acelasi om: potrivirea se face pe primele litere
const radacina = (s: string) => faraDiacritice(s).replace(/[^\p{L}\p{N}]/gu, "").slice(0, RADACINA);
const cifre = (s: string) => s.replace(/\D/g, "");

// ---------------------------------------------------------------- gasirea datelor

interface Tipar { fel: Fel; re: RegExp; grup?: number }

// Identificatorii. Acolo unde tiparul singur ar inghiti si numere de acte sau de articole (telefon, serie,
// numar auto), se cere declansatorul dinainte si se ia doar grupul.
const TIPARE: Tipar[] = [
  { fel: "email", re: /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.[\p{L}]{2,}/gu },
  { fel: "iban", re: /\bMD\d{2}[A-Z0-9]{18}\b/g },
  { fel: "idnp", re: /(?:IDNP|C\.P\.|cod(?:ul)? personal)\D{0,12}(\d{9,15})/gi, grup: 1 },
  { fel: "idnp", re: /\b[0-2]\d{12}\b/g },
  { fel: "telefon", re: /\+373[\s.\-()]*\d[\d\s.\-()]{6,12}\d/g },
  { fel: "telefon", re: /(?:tel|telefon|mob|mobil|fax|cel|тел|телефон|факс|моб)[\p{L}-]*\.?\s*:?\s*([\d+][\d\s.\-()]{6,16}\d)/giu, grup: 1 },
  { fel: "act", re: /(?:seria|buletin(?:ul)? de identitate|pa[sșş]aport(?:ul)?)[^\n]{0,24}?\b([A-Z]{0,2} ?\d{6,9})\b/gi, grup: 1 },
  { fel: "auto", re: /(?:înmatriculare|inmatriculare|automobil(?:ul)?|autoturism(?:ul)?)[^\n]{0,24}?\b([A-Z]{3} ?\d{3})\b/gi, grup: 1 },
  { fel: "adresa", re: /\b(?:[Ss]tr\.|[Ss]trada|[Bb]d\.|[Bb]ulevardul|[SsȘșŞş]os\.|[SsȘșŞş]oseaua)\s+(?:(?:[\p{Lu}]\.|[\p{Lu}][\p{L}-]*|cel|de|la|din)[  ]*){1,4}(?:,?\s*(?:nr\.?\s*)?\d+[A-Za-z]?)?(?:,?\s*ap\.?\s*\d+)?/gu },
  { fel: "nastere", re: /(?:n[aă]scut[ăa]? (?:la|în|in|pe)|a\. ?n\.|d\. ?n\.|data na[sșş]terii)\s*:?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/gi, grup: 1 },
];

interface Cuv { text: string; de: number; pana: number; norm: string; caps: boolean }

const CUVANT = /[\p{L}][\p{L}'’-]*/gu;
const LIPIT = /^[ \u00a0]{1,2}$/; // doar un spatiu intre cuvintele aceluiasi nume

function cuvinteDin(text: string): Cuv[] {
  return [...text.matchAll(CUVANT)].map((m) => ({
    text: m[0], de: m.index!, pana: m.index! + m[0].length,
    norm: faraDiacritice(m[0]), caps: m[0].length >= 3 && m[0] === m[0].toUpperCase(),
  }));
}

const DECLANSATOR = new Set([...DECLANSATORI, "lui"]);
const DECLANSATOR_RU = new Set(DECLANSATORI_RU);
const CHIRILIC = /\p{Script=Cyrillic}/u;
const GRAD = new Set(GRADE);
const cuMajuscula = (c: Cuv) => c.text[0] !== c.text[0]!.toLowerCase();

// Un sir de cuvinte cu majuscula, lipite doar prin spatii, e candidat la nume.
function siruri(text: string, cuv: Cuv[]): Cuv[][] {
  const rezultat: Cuv[][] = [];
  let curent: Cuv[] = [];
  for (const c of cuv) {
    const lipit = curent.length > 0 && LIPIT.test(text.slice(curent[curent.length - 1]!.pana, c.de));
    if (cuMajuscula(c) && (lipit || !curent.length)) curent.push(c);
    else {
      if (curent.length) rezultat.push(curent);
      curent = cuMajuscula(c) ? [c] : [];
    }
  }
  if (curent.length) rezultat.push(curent);
  return rezultat;
}

// Cuvintele dinaintea sirului: „dlui Cazacu”, „în privința lui Cazacu”, „Șef Cazacu”.
function inainte(cuv: Cuv[], sir: Cuv[]): [string, string] {
  const k = cuv.indexOf(sir[0]!);
  return [cuv[k - 1]?.norm ?? "", cuv[k - 2]?.norm ?? ""];
}

function esteNume(cuv: Cuv[], sir: Cuv[]): boolean {
  const utile = sir.filter((c) => !NU_SUNT_NUME.has(c.norm) && c.text.length >= 3);
  if (!utile.length) return false;
  const [unu, doi] = inainte(cuv, sir);
  if (utile.every((c) => CHIRILIC.test(c.text))) return DECLANSATOR_RU.has(unu) || DECLANSATOR_RU.has(doi);
  if (utile.some((c) => PRENUME.has(c.norm))) return true;
  // MAJUSCULELE confirma un nume doar cand nu pot fi o abreviere: „BUZILĂ Anatolie”, nu „IDNP”.
  if (utile.some((c) => c.caps && (c.text.length >= 5 || utile.length >= 2))) return true;
  const taiate = sir.filter((c) => !utile.includes(c)).map((c) => c.norm);
  return [...taiate, unu, doi].some((w) => DECLANSATOR.has(w) || GRAD.has(w));
}

// Sirul curatat de cuvintele care sigur nu sunt nume („Domnul Cazacu Valeriu” -> „Cazacu Valeriu”).
function taie(sir: Cuv[]): Cuv[] {
  let a = 0, b = sir.length;
  while (a < b && NU_SUNT_NUME.has(sir[a]!.norm)) a++;
  while (b > a && NU_SUNT_NUME.has(sir[b - 1]!.norm)) b--;
  return sir.slice(a, b);
}

function potrivite(text: string, i: number, tipar: Tipar): Entitate[] {
  const gasite: Entitate[] = [];
  for (const m of text.matchAll(tipar.re)) {
    const intreg = m[0];
    const bucata = tipar.grup ? m[tipar.grup] : intreg;
    if (!bucata) continue;
    const decalaj = tipar.grup ? intreg.indexOf(bucata) : 0;
    const curat = bucata.trimEnd();
    gasite.push({ fel: tipar.fel, i, de: m.index! + decalaj, pana: m.index! + decalaj + curat.length, text: curat });
  }
  return gasite;
}

// Lista fara suprapuneri: cand doua tipare prind acelasi loc, ramane cel mai lung.
function faraSuprapuneri(lista: Entitate[]): Entitate[] {
  const ordonate = [...lista].sort((a, b) => a.i - b.i || a.de - b.de || b.pana - a.pana);
  const rezultat: Entitate[] = [];
  for (const e of ordonate) {
    const ultima = rezultat[rezultat.length - 1];
    if (ultima && ultima.i === e.i && e.de < ultima.pana) continue;
    rezultat.push(e);
  }
  return rezultat;
}

export function gasesteDate(paragrafe: { i: number; text: string }[], mereu: string[] = []): Entitate[] {
  const identificatori: Entitate[] = [];
  for (const p of paragrafe) for (const t of TIPARE) identificatori.push(...potrivite(p.text, p.i, t));
  const curate = faraSuprapuneri(identificatori);
  const acoperit = (i: number, de: number, pana: number) =>
    curate.some((e) => e.i === i && de < e.pana && e.de < pana);

  // Pasul 1: sirurile pe care le confirma un declansator, un prenume cunoscut sau MAJUSCULELE.
  const radacini = new Set(mereu.map(radacina).filter(Boolean));
  const cuvintePe = new Map<number, Cuv[]>();
  for (const p of paragrafe) {
    const cuv = cuvinteDin(p.text);
    cuvintePe.set(p.i, cuv);
    for (const s of siruri(p.text, cuv)) {
      if (!esteNume(cuv, s)) continue;
      const taiat = taie(s);
      if (!taiat.length || acoperit(p.i, taiat[0]!.de, taiat[taiat.length - 1]!.pana)) continue;
      for (const c of taiat) if (radacina(c.text)) radacini.add(radacina(c.text));
    }
  }

  // Pasul 2: odata stiute radacinile, se mascheaza si „Cazacu” singur, oriunde mai apare.
  const persoane: Entitate[] = [];
  for (const p of paragrafe) {
    const cuv = cuvintePe.get(p.i)!;
    let k = 0;
    while (k < cuv.length) {
      if (!radacini.has(radacina(cuv[k]!.text)) || NU_SUNT_NUME.has(cuv[k]!.norm)) { k++; continue; }
      let j = k;
      while (j + 1 < cuv.length && radacini.has(radacina(cuv[j + 1]!.text)) &&
             LIPIT.test(p.text.slice(cuv[j]!.pana, cuv[j + 1]!.de))) j++;
      const de = cuv[k]!.de, pana = cuv[j]!.pana;
      if (!acoperit(p.i, de, pana)) persoane.push({ fel: "persoana", i: p.i, de, pana, text: p.text.slice(de, pana) });
      k = j + 1;
    }
  }
  return faraSuprapuneri([...curate, ...persoane]);
}

// ---------------------------------------------------------------- valorile false

// Rezervorul nu are voie sa se atinga de document: un nume fals care seamana cu un cuvant din act ar face
// paznicul de reziduu sa arunce corecturi bune.
function liber(lista: string[], ocupate: Set<string>, folosite: Set<string>): string[] {
  return lista.filter((n) => !ocupate.has(radacina(n)) && !folosite.has(radacina(n)));
}

function valoareFalsa(fel: Fel, k: number): string {
  const n = String(k + 1).padStart(3, "0");
  switch (fel) {
    case "idnp": return `2900000000${n}`;
    case "telefon": return `+373 22 900 ${n}`;
    case "email": return `persoana${k + 1}@exemplu.md`;
    case "iban": return `MD24AG0000000000000${n}`;
    case "act": return `AB${n}0000`;
    case "auto": return `ABC ${n}`;
    case "adresa": return `str. Exemplu ${k + 1}`;
    case "nastere": return `0${(k % 9) + 1}.0${(k % 9) + 1}.198${k % 10}`;
    default: return `Persoana ${k + 1}`;
  }
}

// Scrierea cuvantului fals o ia de la cel adevarat: MAJUSCULELE raman MAJUSCULE.
const caInDocument = (adevarat: string, fals: string) =>
  adevarat.length >= 3 && adevarat === adevarat.toUpperCase() ? fals.toUpperCase() : fals;

export function mascheaza<T extends { i: number; text: string }>(
  paragrafe: T[], nivel: Nivel, entitati: Entitate[]
): { paragrafe: T[]; harta: Harta } {
  const harta = hartaGoala(nivel);
  const alese = nivel === "fara" ? [] : entitati.filter((e) => nivel === "tot" || e.fel !== "persoana");
  if (!alese.length) return { paragrafe, harta };

  // Cuvintele documentului, ca rezervorul sa nu dea un nume care exista deja in act.
  const ocupate = new Set<string>();
  for (const p of paragrafe) for (const c of cuvinteDin(p.text)) ocupate.add(radacina(c.text));

  const folosite = new Set<string>();
  const pentruCuvant = new Map<string, string>();  // radacina cuvantului -> cuvantul fals
  const pentruValoare = new Map<string, string>(); // fel + valoare normalizata -> valoarea falsa
  const perechi = new Map<string, Pereche>();
  let contor = 0;

  const numeFals = (cuvant: string): string => {
    const cheie = radacina(cuvant);
    const stiut = pentruCuvant.get(cheie);
    if (stiut) return caInDocument(cuvant, stiut);
    const norm = faraDiacritice(cuvant);
    const lista = PRENUME.has(norm) ? (PRENUME_M.has(norm) ? PRENUME_FALSE_M : PRENUME_FALSE_F) : NUME_FALSE;
    const libere = liber(lista, ocupate, folosite);
    const ales = libere[0] ?? `${lista[0]}${folosite.size}`;
    folosite.add(radacina(ales));
    pentruCuvant.set(cheie, ales);
    return caInDocument(cuvant, ales);
  };

  const falsulPentru = (e: Entitate): string => {
    if (e.fel === "persoana") return e.text.replace(CUVANT, (c) => numeFals(c));
    const cheie = `${e.fel}:${cifre(e.text) || faraDiacritice(e.text)}`;
    const stiut = pentruValoare.get(cheie);
    if (stiut) return stiut;
    const v = valoareFalsa(e.fel, contor++);
    pentruValoare.set(cheie, v);
    return v;
  };

  const iesire = paragrafe.map((p) => {
    const ale = alese.filter((e) => e.i === p.i).sort((a, b) => a.de - b.de);
    if (!ale.length) return p;
    const zone: [number, number][] = [];
    let text = "";
    let ultim = 0;
    for (const e of ale) {
      if (e.de < ultim) continue;
      text += p.text.slice(ultim, e.de);
      const v = falsulPentru(e);
      zone.push([text.length, text.length + v.length]);
      text += v;
      ultim = e.pana;
      perechi.set(`${v} ${e.text}`, { fel: e.fel, adevarat: e.text, fals: v });
    }
    text += p.text.slice(ultim);
    harta.zone.set(p.i, zone);
    harta.mascate.set(p.i, text);
    return { ...p, text };
  });

  harta.perechi = [...perechi.values()];
  harta.inapoi = harta.perechi.map((x): [string, string] => [x.fals, x.adevarat]).sort((a, b) => b[0].length - a[0].length);
  for (const p of harta.perechi) {
    if (p.fel === "persoana") for (const c of p.fals.match(CUVANT) ?? []) harta.radacini.add(radacina(c));
    else harta.falsuri.push(p.fals);
  }
  return { paragrafe: iesire, harta };
}

// Totul intr-un pas: gaseste datele, mascheaza paragrafele si spune ce a fost ascuns.
export function pregateste<T extends { i: number; text: string }>(
  paragrafe: T[], nivel: Nivel, mereu: string[] = []
): { paragrafe: T[]; harta: Harta; entitati: Entitate[] } {
  const entitati = gasesteDate(paragrafe, mereu);
  const { paragrafe: mascate, harta } = mascheaza(paragrafe, nivel, entitati);
  return { paragrafe: mascate, harta, entitati };
}

// ---------------------------------------------------------------- desfacerea si paznicii

export function desfaceText(s: string, harta: Harta): string {
  let text = s;
  for (const [fals, adevarat] of harta.inapoi) {
    if (text.includes(fals)) text = text.split(fals).join(adevarat);
  }
  return text;
}

// A mai ramas vreo urma de nume fals? „Rusului”, „RUSU”, „Rusu-ului” pornesc de la aceeasi radacina.
export function reziduu(s: string, harta: Harta): boolean {
  if (harta.falsuri.some((f) => s.includes(f))) return true;
  if (!harta.radacini.size) return false;
  return (s.match(CUVANT) ?? []).some((c) => harta.radacini.has(radacina(c)));
}

function atingeZonaMascata(c: { i: number; vechi: string }, harta: Harta): boolean {
  const mascat = harta.mascate.get(c.i);
  const zone = harta.zone.get(c.i);
  if (!mascat || !zone?.length) return false;
  const poz = caLaCautare(mascat).indexOf(caLaCautare(c.vechi));
  if (poz < 0) return false; // nu se stie unde cade; ramane paznicul de reziduu
  const pana = poz + c.vechi.length;
  return zone.some(([a, b]) => poz < b && a < pana);
}

// Corectura modelului, adusa inapoi la textul adevarat. `null` = nu intra in document.
export function desfaceCorectura<T extends { i: number; vechi: string; nou: string }>(c: T, harta: Harta): T | null {
  if (harta.nivel === "fara" || !harta.perechi.length) return c;
  if (atingeZonaMascata(c, harta)) return null;
  const vechi = desfaceText(c.vechi, harta);
  const nou = desfaceText(c.nou, harta);
  if (reziduu(vechi, harta) || reziduu(nou, harta)) return null;
  return { ...c, vechi, nou };
}

export function desfaceCorecturi(lista: Corectura[], harta: Harta): { corecturi: Corectura[]; sarite: number } {
  const corecturi: Corectura[] = [];
  let sarite = 0;
  for (const c of lista) {
    const desfacuta = desfaceCorectura(c, harta);
    if (desfacuta) corecturi.push(desfacuta); else sarite++;
  }
  return { corecturi, sarite };
}

// Observatia se arata omului, deci textul ei se desface la fel. Daca vorbeste despre date false chiar si dupa
// desfacere, se arunca: l-ar trimite pe om sa caute in act un nume care nu exista.
export function desfaceObservatii(lista: Observatie[], harta: Harta): { observatii: Observatie[]; sarite: number } {
  if (harta.nivel === "fara" || !harta.perechi.length) return { observatii: lista, sarite: 0 };
  const observatii: Observatie[] = [];
  let sarite = 0;
  for (const o of lista) {
    const text = desfaceText(o.text, harta);
    const solutie = desfaceText(o.solutie, harta);
    if (reziduu(text, harta) || reziduu(solutie, harta)) { sarite++; continue; }
    const corectura = o.corectura ? desfaceCorectura(o.corectura, harta) ?? undefined : undefined;
    observatii.push({ ...o, text, solutie, corectura });
  }
  return { observatii, sarite };
}

// Ultimul paznic, inainte de scriere: nimic fals nu are voie sa ajunga in actul real.
export function scapatInDocument(aplicari: { nou: string }[], harta: Harta): boolean {
  return harta.nivel !== "fara" && aplicari.some((a) => reziduu(a.nou, harta));
}

export function rezumatMascare(harta: Harta): string {
  if (!harta.perechi.length) return "";
  const pe = new Map<Fel, number>();
  for (const p of harta.perechi) pe.set(p.fel, (pe.get(p.fel) ?? 0) + 1);
  const bucati = FELURI.filter((f) => pe.has(f)).map((f) => numara(pe.get(f)!, ETICHETA_FEL[f][0], ETICHETA_FEL[f][1]));
  const ultima = bucati.pop()!;
  return bucati.length ? `${bucati.join(", ")} și ${ultima}` : ultima;
}

// ---------------------------------------------------------------- verificarile care raman in cod
//
// Mascarea ii ia modelului tocmai observatiile de tip „date”: numele scris in doua feluri, IDNP-urile care nu
// se potrivesc. Aici se fac in cod, pe datele adevarate, care nu pleaca nicaieri.

const cuvinteNume = (s: string) => new Set((faraDiacritice(s).match(/[a-z]{2,}/g) ?? []).map((c) => c.slice(0, RADACINA)));

function asemanare(a: Set<string>, b: Set<string>): number {
  let comune = 0;
  for (const c of a) if (b.has(c)) comune++;
  return (2 * comune) / (a.size + b.size);
}

const subMultime = (a: Set<string>, b: Set<string>) => [...a].every((c) => b.has(c));

const ZILE = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function verificaDate(entitati: Entitate[], paragrafe: { i: number; text: string }[] = []): Observatie[] {
  const observatii: Observatie[] = [];
  const valori = (fel: Fel) => [...new Set(entitati.filter((e) => e.fel === fel).map((e) => e.text.trim()))];
  const texte = new Map(paragrafe.map((p) => [p.i, p.text]));
  // Actele au antetul in doua limbi; ce e scris inaintea datei spune in care din ele se afla.
  const rusa = (e: Entitate) => CHIRILIC.test((texte.get(e.i) ?? "").slice(Math.max(0, e.de - 24), e.de));

  // Acelasi om scris in doua feluri. Forma scurta („Cazacu Valeriu” fata de „Cazacu Valeriu Simion”) e
  // fireasca, deci se semnaleaza doar cand niciuna nu e cuprinsa in cealalta.
  const nume = valori("persoana").filter((n) => (n.match(CUVANT) ?? []).length >= 2);
  for (let a = 0; a < nume.length; a++) {
    for (let b = a + 1; b < nume.length; b++) {
      const x = cuvinteNume(nume[a]!), y = cuvinteNume(nume[b]!);
      if (subMultime(x, y) || subMultime(y, x) || asemanare(x, y) < 0.5) continue;
      observatii.push({
        tip: "date",
        text: `Numele apare scris în două feluri: „${nume[a]}” și „${nume[b]}”.`,
        solutie: "Compară cu actul de identitate și scrie-l la fel peste tot în document.",
      });
    }
  }

  const idnpuri = valori("idnp");
  for (const x of idnpuri) {
    const n = cifre(x);
    if (n.length === 13) continue;
    observatii.push({
      tip: "date",
      text: `IDNP-ul „${x}” are ${numara(n.length, "cifră", "cifre")}, nu 13.`,
      solutie: "Verifică IDNP-ul în actul de identitate și scrie-l cu 13 cifre.",
    });
  }
  for (let a = 0; a < idnpuri.length; a++) {
    for (let b = a + 1; b < idnpuri.length; b++) {
      const x = cifre(idnpuri[a]!), y = cifre(idnpuri[b]!);
      if (x.length !== y.length) continue;
      let diferite = 0;
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) diferite++;
      if (diferite === 0 || diferite > 2) continue;
      observatii.push({
        tip: "date",
        text: `Două IDNP-uri aproape la fel, în locuri diferite: „${idnpuri[a]}” și „${idnpuri[b]}”.`,
        solutie: "Vezi care e cel din actul de identitate și corectează-l pe celălalt.",
      });
    }
  }

  for (const t of valori("telefon")) {
    const n = cifre(t).replace(/^373/, "").replace(/^0/, "");
    if (n.length === 8) continue;
    observatii.push({
      tip: "date",
      text: `Numărul de telefon „${t}” are ${numara(n.length, "cifră", "cifre")} după prefixul de țară, nu 8.`,
      solutie: "Verifică numărul și scrie-l întreg.",
    });
  }

  // Contactele din varianta romana fata de cele din varianta rusa: chiar nepotrivirea pe care mascarea i-ar
  // lua-o modelului (la demersul din septembrie 2026, faxul difera intre cele doua antete).
  for (const fel of ["telefon", "email"] as const) {
    const cheie = (e: Entitate) => (fel === "email" ? e.text.trim().toLowerCase() : cifre(e.text).replace(/^373/, "").replace(/^0/, ""));
    const arata = (lista: Entitate[]) => [...new Set(lista.map((e) => e.text.trim()))].join("”, „");
    // Doar in acelasi paragraf: antetul tine cele doua variante una langa alta, iar o alta adresa din
    // document (cea din blocul de semnatura) n-are ce cauta in comparatie.
    for (const i of new Set(entitati.filter((e) => e.fel === fel).map((e) => e.i))) {
      const ale = entitati.filter((e) => e.fel === fel && e.i === i);
      const ro = ale.filter((e) => !rusa(e));
      const ru = ale.filter(rusa);
      if (!ro.length || !ru.length) continue;
      const laFel = [...new Set(ro.map(cheie))].join("|") === [...new Set(ru.map(cheie))].join("|");
      if (laFel) continue;
      observatii.push({
        tip: "date",
        text: `${fel === "email" ? "Adresa de e-mail din varianta română nu se potrivește cu cea" : "Numărul de telefon din varianta română nu se potrivește cu cel"} din varianta rusă: „${arata(ro)}” față de „${arata(ru)}”.`,
        solutie: "Vezi care e cel bun și scrie-l la fel în ambele antete.",
      });
    }
  }

  const telefoane = valori("telefon");
  for (let a = 0; a < telefoane.length; a++) {
    for (let b = a + 1; b < telefoane.length; b++) {
      const x = cifre(telefoane[a]!).replace(/^373/, "").replace(/^0/, "");
      const y = cifre(telefoane[b]!).replace(/^373/, "").replace(/^0/, "");
      if (x.length !== y.length || x === y) continue;
      let diferite = 0;
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) diferite++;
      if (diferite > 2) continue;
      observatii.push({
        tip: "date",
        text: `Două numere de telefon aproape la fel, în locuri diferite: „${telefoane[a]}” și „${telefoane[b]}”.`,
        solutie: "Vezi care e cel bun și scrie-l la fel peste tot, inclusiv în varianta rusă.",
      });
    }
  }

  for (const d of valori("nastere")) {
    const [zi, luna] = d.split(/[.\/-]/).map(Number);
    if (zi && luna && luna <= 12 && zi <= (ZILE[luna - 1] ?? 31)) continue;
    observatii.push({
      tip: "date",
      text: `Data nașterii „${d}” nu poate exista.`,
      solutie: "Scrie data din actul de identitate, în forma zz.ll.aaaa.",
    });
  }
  return observatii;
}
