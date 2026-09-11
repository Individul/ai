// Vocabularul fix al aplicatiei (tipuri, culori, stari, pictograme), validari de formular
// si formatari mici. Fara dependinte, ca sa fie testabil si folosibil pe client.

export const TIPURI_SURSA = ["lege", "cod", "ordin", "regulament", "dispozitie", "circulara", "instructiune", "alt"] as const;
export type TipSursa = (typeof TIPURI_SURSA)[number];
export const ETICHETE_TIP: Record<TipSursa, string> = {
  lege: "Lege", cod: "Cod", ordin: "Ordin", regulament: "Regulament", dispozitie: "Dispoziție",
  circulara: "Circulară", instructiune: "Instrucțiune", alt: "Altele",
};

export const CULORI = ["coral", "teal", "violet", "verde", "galben"] as const;
export type Culoare = (typeof CULORI)[number];

export const STARI = ["activ", "in_lucru", "arhivat"] as const;
export type Stare = (typeof STARI)[number];
// Etichetele sunt la feminin: in interfata, catalogul se numeste „culegere”.
export const ETICHETE_STARE: Record<Stare, string> = { activ: "Activă", in_lucru: "În lucru", arhivat: "Arhivată" };

export const PICTOGRAME = ["carte", "balanta", "ciocan", "document", "lacat", "cheie"] as const;
export type Pictograma = (typeof PICTOGRAME)[number];
export const ETICHETE_PICTOGRAMA: Record<Pictograma, string> = {
  carte: "Carte", balanta: "Balanță", ciocan: "Ciocan", document: "Document", lacat: "Lacăt", cheie: "Cheie",
};

// Modelele disponibile in Admin; modelul decide motorul. Tarifele: $ per milion de tokeni, sept. 2026
// (3.8 Flash creste la 1,50 / 7,50 de la 1 ian. 2027). Modelele Z.AI (GLM) se platesc din planul de
// coding, masurat in credite: (intrare x i + cache x c + iesire x o) / 10.000 (docs.z.ai/devpack/overview);
// tariful lor in $ e cel public (api.z.ai), doar orientativ.
// DeepSeek (sept. 2026): plata per token, cache automat pe prefix, tokenii din cache la intrare_cache.
// `deepseek-flash` e numele din API pentru V4.1 Flash (10 sept. 2026); V4 Flash / V4 Pro sunt retrase si
// redirectionate spre el. Tarifele DeepSeek sunt cele de la orele libere; la orele de varf (`varf`) sunt
// duble. Un model `retras` ramane in tabel pentru costul din jurnal, dar nu mai apare in Admin.
export type Motor = "gemini" | "zai" | "deepseek";
export interface Tarif {
  motor: Motor;
  intrare: number;
  intrare_cache?: number;   // $ per milion pentru tokenii de intrare veniti din cache; lipsa = pret intreg
  iesire: number;
  eticheta: string;
  credite?: { intrare: number; cache: number; iesire: number };
  // Orele de varf (UTC), cu factorul de pret; `doar_lucratoare` = luni-vineri.
  varf?: { factor: number; ore_utc: [number, number][]; doar_lucratoare: boolean };
  retras?: boolean;
}
export const TARIFE: Record<string, Tarif> = {
  "gemini-3.5-flash-lite": { motor: "gemini", intrare: 0.30, iesire: 2.50, eticheta: "Gemini 3.5 Flash-Lite (cel mai ieftin)" },
  "gemini-3.8-flash": { motor: "gemini", intrare: 0.75, iesire: 3.75, eticheta: "Gemini 3.8 Flash (mai bun)" },
  "gemini-3.5-flash": { motor: "gemini", intrare: 1.50, iesire: 9.00, eticheta: "Gemini 3.5 Flash" },
  "glm-5.3-flash": { motor: "zai", intrare: 0.15, intrare_cache: 0.03, iesire: 0.50, eticheta: "GLM-5.3-Flash · Z.AI, planul de coding", credite: { intrare: 2.3, cache: 0.56, iesire: 8 } },
  "glm-5.3": { motor: "zai", intrare: 1.40, intrare_cache: 0.26, iesire: 4.40, eticheta: "GLM-5.3 · Z.AI, planul de coding (scump în credite)", credite: { intrare: 6.9, cache: 1.7, iesire: 24 } },
  "deepseek-flash": {
    motor: "deepseek", intrare: 0.15, intrare_cache: 0.003, iesire: 0.60,
    eticheta: "DeepSeek V4.1 Flash · plată per token, cache automat; preț dublu la orele de vârf",
    varf: { factor: 2, ore_utc: [[1, 4], [6, 10]], doar_lucratoare: true },
  },
  "deepseek-v4-flash": { motor: "deepseek", intrare: 0.14, intrare_cache: 0.0028, iesire: 0.28, eticheta: "DeepSeek V4 Flash (retras, redirecționat spre 4.1)", retras: true },
};
// Modelele selectabile in Admin (fara cele retrase).
export const MODELE = Object.keys(TARIFE).filter((m) => !TARIFE[m]!.retras);

// Starea orelor de varf pentru pagini: daca acum e varf, pana cand (UTC, ca Date) si intervalele.
// `null` pentru modelele fara ore de varf. Orele din intervale sunt UTC; paginile le formateaza in fus.
export interface StareVarf { activ: boolean; factor: number; panaLa: Date | null; intervale: [number, number][]; doar_lucratoare: boolean }
export function stareVarf(model: string, moment: Date = new Date()): StareVarf | null {
  const v = TARIFE[model]?.varf;
  if (!v) return null;
  const factor = factorTarif(model, moment);
  let panaLa: Date | null = null;
  if (factor > 1) {
    const ora = moment.getUTCHours() + moment.getUTCMinutes() / 60;
    const interval = v.ore_utc.find(([de, pana]) => ora >= de && ora < pana);
    if (interval) {
      panaLa = new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate(), interval[1], 0, 0));
    }
  }
  return { activ: factor > 1, factor, panaLa, intervale: v.ore_utc, doar_lucratoare: v.doar_lucratoare };
}

// Factorul de pret la momentul dat (UTC): `varf.factor` in intervalele de varf, altfel 1.
export function factorTarif(model: string, moment: Date = new Date()): number {
  const v = TARIFE[model]?.varf;
  if (!v) return 1;
  const zi = moment.getUTCDay();
  if (v.doar_lucratoare && (zi === 0 || zi === 6)) return 1;
  const ora = moment.getUTCHours() + moment.getUTCMinutes() / 60;
  return v.ore_utc.some(([de, pana]) => ora >= de && ora < pana) ? v.factor : 1;
}
export function esteModel(s: string): boolean { return s in TARIFE; }
export function motorModel(model: string): Motor | null { return TARIFE[model]?.motor ?? null; }
export const NUME_MOTOR: Record<Motor, string> = { gemini: "Gemini", zai: "Z.AI", deepseek: "DeepSeek" };

// Bugetul de context pentru GLM (caractere trimise modelului), setabil din Admin.
// 3 M caractere ~ 1 M tokeni, plafonul GLM-5.3 / 5.3-Flash.
export const LIMITA_BUGET_MIN = 10_000;
export const LIMITA_BUGET_MAX = 3_000_000;

export const LIMITA_INTREBARE = 2000;
export const LIMITA_TITLU = 200;
export const LIMITA_DESCRIERE = 2000;
export const LIMITA_NOTE = 20_000;
export const LIMITA_PDF = 50 * 1024 * 1024;
export const LIMITA_AUDIO = 95 * 1024 * 1024; // sub plafonul de 100 MB al corpului cererii

export function esteTip(s: string): s is TipSursa { return (TIPURI_SURSA as readonly string[]).includes(s); }
export function esteCuloare(s: string): s is Culoare { return (CULORI as readonly string[]).includes(s); }
export function esteStare(s: string): s is Stare { return (STARI as readonly string[]).includes(s); }
export function estePictograma(s: string): s is Pictograma { return (PICTOGRAME as readonly string[]).includes(s); }

// "Legislația penală" -> "legislatia-penala". Fara diacritice, doar [a-z0-9-].
export function slug(titlu: string): string {
  const s = titlu
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "catalog";
}

// Regex plus round-trip prin Date.UTC, ca "2026-02-30" sa nu treaca.
export function ziValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, l, z] = s.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a, l - 1, z));
  return d.getUTCFullYear() === a && d.getUTCMonth() === l - 1 && d.getUTCDate() === z;
}

// Gol (notebook in pregatire) sau un link de NotebookLM. Google a redenumit produsul
// "Gemini Notebook" si a mutat adresa pe notebook.google.com; acceptam ambele domenii.
export function urlNotebookValid(url: string): boolean {
  return url === "" || /^https:\/\/(notebooklm|notebook)\.google\.com\/[^\s]*$/.test(url);
}

// Linkurile externe ale surselor: doar http(s).
export function urlValid(url: string): boolean {
  return /^https?:\/\/[^\s]+$/.test(url);
}

// 754 -> "12:34"; 3723 -> "1:02:03".
export function fmtDurata(secunde: number): string {
  const s = Math.max(0, Math.round(secunde));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dd(m)}:${dd(r)}` : `${m}:${dd(r)}`;
}

// 2_400_000 -> "2,3 MB". Virgula zecimala, ca in romana.
export function fmtMarime(octeti: number): string {
  if (octeti < 1024) return `${octeti} B`;
  if (octeti < 1024 * 1024) return `${Math.round(octeti / 1024)} KB`;
  const mb = octeti / (1024 * 1024);
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

// --- Validari de formular. Primesc campurile ca siruri (FormData) si intorc datele curate.

export type Validat<T> = { ok: true; date: T } | { ok: false; eroare: string };

export interface DateCatalog {
  titlu: string; descriere: string; pictograma: Pictograma; culoare: Culoare; stare: Stare;
  url_notebook: string; note_utilizare: string;
}

const camp = (f: Record<string, string | undefined>, nume: string) => (f[nume] ?? "").trim();

export function valideazaCatalog(f: Record<string, string | undefined>): Validat<DateCatalog> {
  const titlu = camp(f, "titlu");
  if (!titlu) return { ok: false, eroare: "Titlul este obligatoriu." };
  if (titlu.length > LIMITA_TITLU) return { ok: false, eroare: `Titlul are peste ${LIMITA_TITLU} de caractere.` };
  const descriere = camp(f, "descriere");
  if (descriere.length > LIMITA_DESCRIERE) return { ok: false, eroare: "Descrierea este prea lungă." };
  const pictograma = camp(f, "pictograma") || "carte";
  if (!estePictograma(pictograma)) return { ok: false, eroare: "Pictogramă necunoscută." };
  const culoare = camp(f, "culoare") || "violet";
  if (!esteCuloare(culoare)) return { ok: false, eroare: "Culoare necunoscută." };
  const stare = camp(f, "stare") || "in_lucru";
  if (!esteStare(stare)) return { ok: false, eroare: "Stare necunoscută." };
  const url_notebook = camp(f, "url_notebook");
  if (!urlNotebookValid(url_notebook)) return { ok: false, eroare: "Linkul trebuie să fie de la notebook.google.com sau notebooklm.google.com (sau gol)." };
  const note_utilizare = (f.note_utilizare ?? "").replace(/\r\n?/g, "\n").trim();
  if (note_utilizare.length > LIMITA_NOTE) return { ok: false, eroare: "Notele de utilizare sunt prea lungi." };
  return { ok: true, date: { titlu, descriere, pictograma, culoare, stare, url_notebook, note_utilizare } };
}

export interface DateSursa {
  titlu: string; tip: TipSursa; numar: string | null; data_emiterii: string | null; url: string | null;
}

export function valideazaSursa(f: Record<string, string | undefined>): Validat<DateSursa> {
  const titlu = camp(f, "titlu");
  if (!titlu) return { ok: false, eroare: "Titlul sursei este obligatoriu." };
  if (titlu.length > LIMITA_TITLU) return { ok: false, eroare: `Titlul are peste ${LIMITA_TITLU} de caractere.` };
  const tip = camp(f, "tip");
  if (!esteTip(tip)) return { ok: false, eroare: "Tip de sursă necunoscut." };
  const numar = camp(f, "numar") || null;
  if (numar && numar.length > 100) return { ok: false, eroare: "Numărul este prea lung." };
  const data_emiterii = camp(f, "data_emiterii") || null;
  if (data_emiterii && !ziValida(data_emiterii)) return { ok: false, eroare: "Data emiterii nu este validă (AAAA-LL-ZZ)." };
  const url = camp(f, "url") || null;
  if (url && !urlValid(url)) return { ok: false, eroare: "Linkul trebuie să înceapă cu http:// sau https://." };
  return { ok: true, date: { titlu, tip, numar, data_emiterii, url } };
}

export interface DateAudio { titlu: string; descriere: string; data: string; durata_s: number | null }

export function valideazaAudio(f: Record<string, string | undefined>): Validat<DateAudio> {
  const titlu = camp(f, "titlu");
  if (!titlu) return { ok: false, eroare: "Titlul audio-ului este obligatoriu." };
  if (titlu.length > LIMITA_TITLU) return { ok: false, eroare: `Titlul are peste ${LIMITA_TITLU} de caractere.` };
  const descriere = camp(f, "descriere");
  if (descriere.length > LIMITA_DESCRIERE) return { ok: false, eroare: "Descrierea este prea lungă." };
  const data = camp(f, "data");
  if (!ziValida(data)) return { ok: false, eroare: "Data nu este validă (AAAA-LL-ZZ)." };
  const d = camp(f, "durata_s");
  const durata_s = d === "" ? null : Number(d);
  if (durata_s !== null && (!Number.isFinite(durata_s) || durata_s < 0 || durata_s > 86_400)) {
    return { ok: false, eroare: "Durata nu este validă." };
  }
  return { ok: true, date: { titlu, descriere, data, durata_s: durata_s === null ? null : Math.round(durata_s) } };
}
