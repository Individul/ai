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

// Modelele disponibile in Admin; modelul decide motorul. Tarifele: $ per milion de tokeni.
// Din 22 oct. 2026 raman doar trei (decizia lui Dumitru: chatul pe Claude Sonnet 5.5, restul scos din cod):
// Gemini (File Search), GLM (Z.AI) si Claude-urile vechi (Haiku 4.5, Sonnet 5, Opus 5) nu mai exista.
// Jurnalul pastreaza costul calculat la momentul cererii, deci randurile vechi nu au nevoie de tarif.
// DeepSeek: plata per token, cache automat pe prefix, tokenii din cache la intrare_cache. `deepseek-flash`
// e numele din API pentru V4.1 Flash; tariful e cel de la orele libere, iar la orele de varf (`varf`) e dublu.
// Claude (platform.claude.com/docs/en/about-claude/pricing): plata per token, cache la 0,1x, se plateste din
// creditele API lunare ale abonamentului Max.
export type Motor = "deepseek" | "claude";
export interface Tarif {
  motor: Motor;
  intrare: number;
  intrare_cache?: number;   // $ per milion pentru tokenii de intrare veniti din cache; lipsa = pret intreg
  iesire: number;
  eticheta: string;
  // Orele de varf (UTC), cu factorul de pret; `doar_lucratoare` = luni-vineri.
  varf?: { factor: number; ore_utc: [number, number][]; doar_lucratoare: boolean };
  // Doar pentru corector: la chat, Opus ar costa prea mult pe intrebare.
  doar_corector?: boolean;
  // Claude: output_config.effort (adancimea gandirii adaptive); lipsa = modelul nu il accepta.
  efort?: "low" | "medium" | "high";
}
export const TARIFE: Record<string, Tarif> = {
  "claude-sonnet-5-5": { motor: "claude", intrare: 2.00, intrare_cache: 0.20, iesire: 10.00, eticheta: "Claude Sonnet 5.5 · Anthropic, cu gândire; la chat context filtrat și plafon lunar", efort: "medium" },
  "claude-opus-5-5": { motor: "claude", intrare: 4.00, intrare_cache: 0.20, iesire: 20.00, eticheta: "Claude Opus 5.5 · Anthropic, cel mai atent, cu gândire (doar corector)", doar_corector: true, efort: "medium" },
  "deepseek-flash": {
    motor: "deepseek", intrare: 0.15, intrare_cache: 0.003, iesire: 0.60,
    eticheta: "DeepSeek V4.1 Flash · plată per token, cache automat; preț dublu la orele de vârf",
    varf: { factor: 2, ore_utc: [[1, 4], [6, 10]], doar_lucratoare: true },
  },
};
// Modelele selectabile in Admin: toate la corector, la chat fara cele `doar_corector`.
export const MODELE = Object.keys(TARIFE);
export const MODELE_CHAT = MODELE.filter((m) => !TARIFE[m]!.doar_corector);

// Costul unei cereri in microdolari, la tariful public al modelului: tokenii din cache la intrare_cache,
// iar la orele de varf (DeepSeek) inmultit cu factorul. 0 pentru un model necunoscut.
export function costMicrodolari(model: string, tokensIntrare: number, tokensIesire: number, tokensCache = 0, moment: Date = new Date()): number {
  const t = TARIFE[model];
  if (!t) return 0;
  const cache = Math.min(Math.max(tokensCache, 0), tokensIntrare);
  const f = factorTarif(model, moment);
  return Math.round(((tokensIntrare - cache) * t.intrare + cache * (t.intrare_cache ?? t.intrare) + tokensIesire * t.iesire) * f);
}

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
export const NUME_MOTOR: Record<Motor, string> = { deepseek: "DeepSeek", claude: "Claude" };

// Bugetul de context pentru DeepSeek (caractere trimise modelului), setabil din Admin.
// 3 M caractere ~ 1 M tokeni.
export const LIMITA_BUGET_MIN = 10_000;
export const LIMITA_BUGET_MAX = 3_000_000;

// Claude la chat: bugetul de context e separat (~300.000 de caractere = ~100 k tokeni = ~0,22 $ pe Sonnet 5.5),
// iar cheltuiala lunara pe toate modelele Claude (chat + corector) are un plafon in dolari. Peste plafon,
// chatul trece pe modelul de rezerva pana la luna urmatoare.
export const BUGET_CLAUDE_IMPLICIT = 300_000;
export const PLAFON_CLAUDE_IMPLICIT = 65;   // $ pe luna
export const PLAFON_CLAUDE_MAX = 10_000;

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
