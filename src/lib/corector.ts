// Corectorul de documente Word, partea fara retea (folosita si in browser): promptul, impartirea
// paragrafelor pe loturi si citirea raspunsului modelului. Modelul nu rescrie documentul: intoarce
// lista corecturilor {i, vechi, nou, tip, motiv}, deci iesirea ramane mica (ieftina si rapida), iar
// browserul le pune in .docx ca revizii (docx.ts). Apelul catre model e in motor.ts (corecteazaLot).

import type { Corectura, ParagrafText } from "./docx";

export const MODEL_CORECTOR_IMPLICIT = "deepseek-flash";
export const LIMITA_LOT = 4_000;          // caractere pe cerere: cu gandirea pornita, un lot dureaza ~1 minut
export const LIMITA_PARAGRAF = 20_000;    // un paragraf mai lung nu se trimite
export const LIMITA_LOT_SERVER = 25_000;  // plafonul verificat pe server (un paragraf lung sta singur in lot)
export const LIMITA_DOCUMENT = 400_000;   // ≈ 150 de pagini
// Cereri pe o corectare. Un document de 400.000 de caractere face pana la 200 de loturi cand
// paragrafele au putin peste 2.000 de caractere (cate unul pe lot); plafonul real e pe caractere.
export const LIMITA_LOTURI = 250;
export const LOTURI_PARALELE = 4;
export const AUTOR_REVIZII = "Corector AI";
export const TIPURI_CORECTURA = ["ortografie", "gramatică", "punctuație", "formulare"] as const;

export interface CerereText {
  model: string;
  sistem: string;
  utilizator: string;
  maxTokens: number;
  schema?: Record<string, unknown>; // impusa acolo unde motorul o accepta (Claude); celelalte cer doar JSON
}

// Schema raspunsului corectorului. Limitele Anthropic: additionalProperties false la fiecare obiect,
// fara minLength / maxLength (lungimile le verifica extrageCorecturi).
export const SCHEMA_CORECTURI: Record<string, unknown> = {
  type: "object",
  properties: {
    corecturi: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          vechi: { type: "string" },
          nou: { type: "string" },
          tip: { type: "string", enum: ["ortografie", "gramatică", "punctuație", "formulare"] },
          motiv: { type: "string" },
        },
        required: ["i", "vechi", "nou", "tip", "motiv"],
        additionalProperties: false,
      },
    },
  },
  required: ["corecturi"],
  additionalProperties: false,
};

export const PROMPT_CORECTOR = `Ești corector de limba română pentru documentele de serviciu ale sistemului penitenciar din Republica Moldova (rapoarte, note informative, demersuri, dispoziții, procese-verbale).
Primești paragrafele unui document ca JSON: {"paragrafe":[{"i":număr,"text":"..."}]}.
Corectezi:
- ortografia și diacriticele (ă, â, î, ș, ț), greșelile de tipar, cuvintele repetate;
- gramatica: acordurile, formele verbale, cratima („s-a” / „sa”, „va” / „v-a”, „într-un”), articolele;
- punctuația: virgulele, spațiile greșite în jurul semnelor de punctuație;
- formularea: frazele greoaie, ambigue sau nefirești, pe care le reformulezi în stil administrativ oficial, clar și concis.
Reguli:
- Nu schimba sensul, cifrele, datele, numele proprii, numerele actelor și trimiterile la articole, puncte sau alineate.
- La ortografie și diacritice păstrezi cuvântul autorului, doar îl scrii corect („detinere” devine „deținere”, nu „detenție”); alt cuvânt propui doar ca formulare, când cel folosit e greșit sau nepotrivit.
- Verifici acordul predicatului cu subiectul, inclusiv când subiectul e departe de verb („rezultatele ... se vor prezenta”).
- Nu corecta ce e deja corect și nu reformula un paragraf bun doar din preferință.
- Nu semnala diferența dintre ş/ţ cu sedilă și ș/ț cu virgulă.
Răspunzi doar cu JSON: {"corecturi":[{"i":număr,"vechi":"...","nou":"...","tip":"ortografie|gramatică|punctuație|formulare","motiv":"..."}]}
- "vechi" e copiat exact, caracter cu caracter, din textul paragrafului "i"; cât mai scurt (cuvântul sau grupul de cuvinte greșit, nu tot paragraful), dar suficient ca să apară o singură dată în paragraf.
- "nou" e textul care îl înlocuiește pe "vechi".
- "motiv" explică scurt și exact regula, în cel mult 15 cuvinte.
- Dacă nu există greșeli, răspunzi {"corecturi":[]}.`;

// Cate caractere poate trimite clientul modelului pentru o corectare: de doua ori cat a declarat
// la pornire (un lot picat se reincearca o data), plus un lot. Peste, serverul refuza lotul.
export function bugetCaractere(declarate: number): number {
  return Math.min(Math.max(declarate, 0), LIMITA_DOCUMENT) * 2 + LIMITA_LOT_SERVER;
}

// Paragrafele, in ordine, in loturi de cel mult `max` caractere; un paragraf mai lung sta singur.
export function impartePeLoturi(paragrafe: ParagrafText[], max = LIMITA_LOT): ParagrafText[][] {
  const loturi: ParagrafText[][] = [];
  let lot: ParagrafText[] = [];
  let caractere = 0;
  for (const p of paragrafe) {
    if (lot.length && caractere + p.text.length > max) {
      loturi.push(lot);
      lot = [];
      caractere = 0;
    }
    lot.push(p);
    caractere += p.text.length;
  }
  if (lot.length) loturi.push(lot);
  return loturi;
}

export function cerereCorectura(model: string, lot: ParagrafText[]): CerereText {
  return {
    model,
    sistem: PROMPT_CORECTOR,
    utilizator: JSON.stringify({ paragrafe: lot.map((p) => ({ i: p.i, text: p.text })) }),
    maxTokens: 32_768, // tokenii de gandire intra in plafon
    schema: SCHEMA_CORECTURI,
  };
}

const faraDiacritice = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Raspunsul modelului -> corecturile valide pentru paragrafele din lot. Arunca doar daca raspunsul
// nu e JSON cu o lista; intrarile stricate se sar.
export function extrageCorecturi(text: string, indici: Set<number>): Corectura[] {
  const curat = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let d: unknown;
  try {
    d = JSON.parse(curat);
  } catch {
    const obiect = /\{[\s\S]*\}/.exec(curat)?.[0];
    try { d = obiect ? JSON.parse(obiect) : null; } catch { d = null; }
  }
  const lista = Array.isArray(d) ? d : Array.isArray((d as { corecturi?: unknown })?.corecturi) ? (d as { corecturi: unknown[] }).corecturi : null;
  if (!lista) throw new Error("Modelul nu a întors lista de corecturi.");
  const corecturi: Corectura[] = [];
  for (const x of lista as Record<string, unknown>[]) {
    const i = Number(x?.i);
    const vechi = typeof x?.vechi === "string" ? x.vechi : "";
    const nou = typeof x?.nou === "string" ? x.nou : null;
    if (!Number.isInteger(i) || !indici.has(i) || !vechi.trim() || nou === null || vechi.length > 5000 || nou.length > 5000) continue;
    const tip = TIPURI_CORECTURA.find((t) => faraDiacritice(t) === faraDiacritice(String(x.tip ?? ""))) ?? "formulare";
    corecturi.push({ i, vechi, nou, tip, motiv: String(x.motiv ?? "").trim().slice(0, 300) });
  }
  return corecturi;
}

// 1 corectură, 5 corecturi, 20 de corecturi, 101 corecturi: acordul din romana cere "de" cand
// ultimele doua cifre fac cel putin 20 (sau 00, de la 100 in sus).
export function numara(n: number, singular: string, plural: string): string {
  if (n === 1) return `1 ${singular}`;
  const rest = n % 100;
  return `${n}${n >= 20 && (rest === 0 || rest >= 20) ? " de" : ""} ${plural}`;
}

// Rezultatul lui `claude -p` (Claude Code pe planul personal, comanda locala si aplicatia de Mac): mesajul
// `result` din --output-format json sau ultimul rand din stream-json. Corecturile vin din `structured_output`,
// daca exista, altfel din textul `result` (promptul cere JSON). Arunca la eroarea raportata de Claude Code
// sau la un raspuns care nu e JSON.
export function corecturiDinClaudeCode(iesire: string, indici: Set<number>): { corecturi: Corectura[]; cost_usd: number } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(iesire);
  } catch {
    throw new Error(`Claude Code nu a întors JSON: ${iesire.trim().slice(0, 200) || "nimic"}`);
  }
  if (d.is_error === true || (typeof d.subtype === "string" && d.subtype !== "success")) {
    throw new Error(`Claude Code: ${String(d.result ?? d.subtype ?? "eroare").slice(0, 300)}`);
  }
  const brut = d.structured_output !== undefined ? JSON.stringify(d.structured_output) : String(d.result ?? "");
  return { corecturi: extrageCorecturi(brut, indici), cost_usd: Number(d.total_cost_usd ?? 0) || 0 };
}

// Un rand din `claude -p --output-format stream-json --verbose`. `jurnal` e ce se scrie in jurnalul de
// diagnostic al comenzii locale: felul evenimentului si cifrele, niciodata textul documentului sau al
// raspunsului (doar mesajul de eroare, cand Claude Code raporteaza una).
export type EvenimentClaudeCode =
  | { fel: "rezultat"; jurnal: Record<string, unknown> }
  | { fel: "reincercare"; eroare: string; incercare: number; max: number | null; jurnal: Record<string, unknown> }
  | { fel: "altul"; jurnal: Record<string, unknown> };

export function evenimentClaudeCode(rand: string): EvenimentClaudeCode | null {
  let d: Record<string, any>;
  try {
    d = JSON.parse(rand);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const tip = String(d.type ?? "");
  const subtip = typeof d.subtype === "string" ? d.subtype : undefined;
  const jurnal: Record<string, unknown> = { type: tip, subtype: subtip };
  const blocuri = (x: unknown) =>
    (Array.isArray(x) ? x : []).map((b: any) => (b?.type === "tool_use" ? `tool_use:${b.name}` : b?.type === "tool_result" && b.is_error ? "tool_result:eroare" : String(b?.type)));
  if (tip === "result") {
    Object.assign(jurnal, {
      is_error: d.is_error, num_turns: d.num_turns, duration_ms: d.duration_ms, duration_api_ms: d.duration_api_ms,
      cost_usd: d.total_cost_usd, structured_output: d.structured_output !== undefined,
    });
    if (d.is_error || (subtip && subtip !== "success")) jurnal.eroare = String(d.result ?? subtip).slice(0, 300);
    return { fel: "rezultat", jurnal };
  }
  if (tip === "system" && subtip === "api_retry") {
    const eroare = String(d.error ?? d.error_status ?? "eroare necunoscută");
    const incercare = Number(d.attempt ?? 0);
    const max = typeof d.max_retries === "number" ? d.max_retries : null;
    Object.assign(jurnal, { eroare, incercare, max, error_status: d.error_status, retry_delay_ms: d.retry_delay_ms });
    return { fel: "reincercare", eroare, incercare, max, jurnal };
  }
  if (tip === "system" && subtip === "init") Object.assign(jurnal, { model: d.model, unelte: Array.isArray(d.tools) ? d.tools.length : undefined, versiune: d.claude_code_version });
  if (tip === "assistant") Object.assign(jurnal, { blocuri: blocuri(d.message?.content), stop: d.message?.stop_reason });
  if (tip === "user") jurnal.blocuri = blocuri(d.message?.content);
  return { fel: "altul", jurnal };
}
