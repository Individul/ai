// Corectorul de documente Word, partea fara retea (folosita si in browser): promptul, impartirea
// paragrafelor pe loturi si citirea raspunsului modelului. Modelul nu rescrie documentul: intoarce
// lista corecturilor {i, vechi, nou, tip, motiv}, deci iesirea ramane mica (ieftina si rapida), iar
// browserul le pune in .docx ca revizii (docx.ts). Apelul catre model e in motor.ts (corecteazaLot).

import type { Corectura, ParagrafText } from "./docx";
import { despreMentiune } from "./mentiune";

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

// Caractere pe document, in modul verificare (o singura cerere). 100.000 de la 22 sept. 2026, la cererea lui
// Dumitru (era 40.000): incape un act de ~40 de pagini. Intrarea nu e problema (~30.000 de jetoane), iesirea e:
// gandirea intra in plafonul de mai jos, iar un raspuns taiat nu se poate citi.
export const LIMITA_VERIFICARE = 100_000;

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
- punctuația: virgulele și celelalte semne;
- formularea: frazele greoaie, ambigue sau nefirești, pe care le reformulezi în stil administrativ oficial, clar și concis.
Reguli:
- Nu schimba sensul, cifrele, datele, numele proprii, numerele actelor și trimiterile la articole, puncte sau alineate.
- La ortografie și diacritice păstrezi cuvântul autorului, doar îl scrii corect („detinere” devine „deținere”, nu „detenție”); alt cuvânt propui doar ca formulare, când cel folosit e greșit sau nepotrivit. Regula asta privește sinonimele, nu greșelile de tipar: pe acelea le corectezi chiar dacă iese alt cuvânt („epizoade” → „episoade”, „hotărîri” → „hotărâri”).
- Dacă documentul are și text în limba rusă (antet, ștampile, denumiri), îl corectezi după normele limbii ruse („учереждение” → „учреждение”).
- Verifici acordul predicatului cu subiectul, inclusiv când subiectul e departe de verb („rezultatele ... se vor prezenta”).
- Nu corecta ce e deja corect și nu reformula un paragraf bun doar din preferință.
- Nu semnala diferența dintre ş/ţ cu sedilă și ș/ț cu virgulă.
- Nu semnala spațiile: nici spațiul care lipsește după un punct sau o abreviere („or.Soroca”, „эл.адрес”), nici spațiile duble. Pe acelea le lasă în pace.
- Mențiunea despre datele cu caracter personal („Atenție: Documentul conține date cu caracter personal…”) se verifică separat, după forma aprobată: nu o corecta.
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
function jsonDinText(text: string): unknown {
  const curat = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(curat);
  } catch {
    const obiect = /\{[\s\S]*\}/.exec(curat)?.[0];
    try { return obiect ? JSON.parse(obiect) : null; } catch { return null; }
  }
}

// O corectura care schimba doar spatiile („or.Soroca” -> „or. Soroca”, spatiile duble) nu intra nici in
// document, nici in raport: decizia lui Dumitru din 16 sept. 2026, pentru ca ii ineaca greselile adevarate.
// Spatiul dintre doua litere ramane o corectura adevarata („desine” -> „de sine”), la fel ca semnele scoase
// sau puse („№.6” -> „№ 6”): se compara forme din care dispar doar spatiile din jurul semnelor.
const faraSpatii = (s: string) =>
  s.replace(/\s+/g, " ").replace(/\s*([^\p{L}\p{N}\s])\s*/gu, "$1").trim();

export function doarSpatii(vechi: string, nou: string): boolean {
  return vechi !== nou && faraSpatii(vechi) === faraSpatii(nou);
}

export function extrageCorecturi(text: string, indici: Set<number>): Corectura[] {
  const d = jsonDinText(text);
  const lista = Array.isArray(d) ? d : Array.isArray((d as { corecturi?: unknown })?.corecturi) ? (d as { corecturi: unknown[] }).corecturi : null;
  if (!lista) throw new Error("Modelul nu a întors lista de corecturi.");
  const corecturi: Corectura[] = [];
  for (const x of lista as Record<string, unknown>[]) {
    const i = Number(x?.i);
    const vechi = typeof x?.vechi === "string" ? x.vechi : "";
    const nou = typeof x?.nou === "string" ? x.nou : null;
    if (!Number.isInteger(i) || !indici.has(i) || !vechi.trim() || nou === null || vechi.length > 5000 || nou.length > 5000) continue;
    if (doarSpatii(vechi, nou)) continue;
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

// ---------------------------------------------------------------- motoarele locale (planurile personale)
//
// Pe calculatorul lui Dumitru corectorul merge pe doua planuri personale, fiecare prin CLI-ul lui oficial,
// logat cu contul lui: Claude Code (`claude`) pe planul Claude si Antigravity (`agy`) pe planul Google.
// Din Worker niciunul nu se poate folosi (regulile de autentificare ale ambilor), deci hub-ul ramane pe
// chei de API, iar corectorul pe planuri e doar local (comanda si aplicatia de Mac).
export const MOTOARE_LOCALE = ["claude", "gemini"] as const;
export type MotorLocal = (typeof MOTOARE_LOCALE)[number];

// Numele scurte din comanda -> modelul cerut CLI-ului. La Antigravity adancimea gandirii face parte din nume.
export const MODELE_LOCALE: Record<MotorLocal, Record<string, string>> = {
  claude: { opus: "opus", sonnet: "sonnet", haiku: "haiku" },
  gemini: { pro: "gemini-3.1-pro-high", flash: "gemini-3.8-flash-high" },
};

export function modelLocal(motor: MotorLocal, nume: string): string | null {
  return MODELE_LOCALE[motor][nume] ?? null;
}

// Ce a intors CLI-ul: raspunsul brut (promptul cere JSON) si cat a consumat. Claude Code raporteaza
// echivalentul in dolari, Antigravity doar jetoanele; pe planurile personale, nimic nu se factureaza.
export interface ContinutLocal {
  brut: string;
  cost_usd: number;
  jetoane: number;
}

export function continutLocal(motor: MotorLocal, iesire: string): ContinutLocal {
  return motor === "gemini" ? continutAntigravity(iesire) : continutClaudeCode(iesire);
}

export function mesajEroareLocal(motor: MotorLocal, mesaj: string): string {
  return motor === "gemini" ? mesajEroareAntigravity(mesaj) : mesajEroareClaudeCode(mesaj);
}

// Erori care tin de furnizor, nu de contul tau sau de cerere: se reincearca. Vazut pe viu la 15 sept. 2026,
// pe Gemini 3.8 Flash: „UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high”.
export function eroareTrecatoare(mesaj: string): boolean {
  // Limitele planului si autentificarea nu se rezolva prin reincercare.
  if (/limita planului|usage limit|quota|RESOURCE_EXHAUSTED|nu e logat|authentication|rate[_ ]limit/i.test(mesaj)) return false;
  // Unealta ceruta si refuzata la Antigravity: a doua incercare, de obicei, nu o mai cere.
  if (/permisiune pe care modul fără interfață|no output produced|auto-denied/i.test(mesaj)) return true;
  return /No capacity|nu are capacitate|UNAVAILABLE|overloaded|temporarily unavailable|\b(500|502|503|529)\b/i.test(mesaj);
}

// Rezultatul lui `claude -p` (Claude Code pe planul personal): mesajul `result` din --output-format json sau
// ultimul rand din stream-json. Corecturile vin din `structured_output`, daca exista, altfel din textul
// `result` (promptul cere JSON). Arunca la eroarea raportata de Claude Code sau la un raspuns care nu e JSON.
export function continutClaudeCode(iesire: string): ContinutLocal {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(iesire);
  } catch {
    throw new Error(`Claude Code nu a întors JSON: ${iesire.trim().slice(0, 200) || "nimic"}`);
  }
  if (d.is_error === true || (typeof d.subtype === "string" && d.subtype !== "success")) {
    throw new Error(mesajEroareClaudeCode(`Claude Code: ${String(d.result ?? d.subtype ?? "eroare").slice(0, 300)}`));
  }
  return {
    brut: d.structured_output !== undefined ? JSON.stringify(d.structured_output) : String(d.result ?? ""),
    cost_usd: Number(d.total_cost_usd ?? 0) || 0,
    jetoane: 0,
  };
}

// Rezultatul lui `agy -p --output-format json` (Antigravity, planul Google): un singur obiect, cu raspunsul
// in `response`. Nu raporteaza cost, fiindca cererile intra in plan; pentru comparatie retinem jetoanele.
export function continutAntigravity(iesire: string): ContinutLocal {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(iesire);
  } catch {
    throw new Error(`Antigravity nu a întors JSON: ${iesire.trim().slice(0, 200) || "nimic"}`);
  }
  const stare = String(d.status ?? "");
  if (stare !== "SUCCESS") {
    throw new Error(mesajEroareAntigravity(`Gemini: ${String(d.error ?? d.response ?? (stare || "eroare")).slice(0, 300)}`));
  }
  if (typeof d.response !== "string" || !d.response.trim()) {
    throw new Error("Gemini a răspuns fără text. Încearcă din nou.");
  }
  const consum = (d.usage ?? {}) as Record<string, unknown>;
  return { brut: String(d.response ?? ""), cost_usd: 0, jetoane: Number(consum.total_tokens ?? 0) || 0 };
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

// Erorile lui Claude Code pe care omul le rezolva singur, spuse pe romaneste; restul raman cum sunt.
// Vazut pe viu la 15 sept. 2026: "Failed to authenticate. API Error: 401 ... OAuth access token is invalid."
export function mesajEroareClaudeCode(mesaj: string): string {
  if (/OAuth|authentication_error|Failed to authenticate|Invalid API key|\/login|not logged in/i.test(mesaj)) {
    return "Claude Code nu e logat sau autentificarea a expirat. În Terminal rulează „claude”, scrie „/login” și loghează-te cu contul tău, apoi apasă „reîncearcă”.";
  }
  if (/usage limit|rate[_ ]limit|limit reached/i.test(mesaj)) {
    return `Ai atins limita planului Claude; reîncearcă după resetare. (${mesaj.slice(0, 160)})`;
  }
  return mesaj;
}

// Acelasi lucru pentru Antigravity (planul Google).
export function mesajEroareAntigravity(mesaj: string): string {
  if (/UNAUTHENTICATED|unauthenticated|not (logged|signed) in|sign in|log in|401|credentials|token (is )?(expired|invalid)/i.test(mesaj)) {
    return "Antigravity nu e logat sau autentificarea a expirat. În Terminal rulează „agy”, loghează-te cu contul tău Google, apoi apasă „reîncearcă”.";
  }
  if (/No capacity|UNAVAILABLE|503/i.test(mesaj)) {
    return "Google nu are capacitate acum pentru modelul ales. Încearcă peste câteva minute sau alege alt model.";
  }
  if (/quota|RESOURCE_EXHAUSTED|rate[_ ]limit|limit reached|429/i.test(mesaj)) {
    return `Ai atins limita planului Google; reîncearcă după resetare. (${mesaj.slice(0, 160)})`;
  }
  // 16 sept. 2026: Flash a vrut sa foloseasca unealta „read_url” in mijlocul corecturii, iar modul fara
  // interfata nu poate cere permisiunea, deci a iesit fara niciun raspuns. Antigravity nu are optiune de
  // scoatere a uneltelor, deci singurul lucru de facut e sa reincerci.
  if (/permission that headless mode cannot prompt for|permissions\.allow|auto-denied|no output produced/i.test(mesaj)) {
    return "Antigravity a cerut o permisiune pe care modul fără interfață nu o poate da (de pildă „read_url”), așa că nu a răspuns. Se reîncearcă; nu porni „--dangerously-skip-permissions” pe acte cu date personale.";
  }
  return mesaj;
}


// ---------------------------------------------------------------- verificarea intregului document

// Modul „verificare” trimite tot documentul intr-o singura cerere (corp, antete, subsoluri, note) si cere
// doua liste: corecturile care se pot pune direct in text si observatiile care cer om — contradictii intre
// date aflate in locuri diferite, campuri ramase necompletate, formatare rupta, indoieli juridice.
export const TIPURI_OBSERVATIE = ["date", "juridic", "formatare", "lipsa", "altele"] as const;

// Ce propune modelul pentru o observatie, cand solutia e o inlocuire de text intr-un paragraf.
export interface CorecturaObservatie {
  i: number;
  vechi: string;
  nou: string;
}

export interface Observatie {
  tip: string;
  text: string;      // citatul si ce e in neregula
  solutie: string;   // ce trebuie facut, concret
  corectura?: CorecturaObservatie; // lipseste cand rezolvarea cere ceva ce nu scrie in document
}

// Eticheta afisata pentru fiecare fel de observatie (aceleasi cuvinte ca in aplicatia de Mac).
export const ETICHETA_OBSERVATIE: Record<string, string> = {
  date: "date care nu se potrivesc",
  juridic: "de verificat juridic",
  formatare: "formatare",
  lipsa: "rubrică necompletată",
  altele: "de verificat",
};

export const PROMPT_VERIFICARE = `${PROMPT_CORECTOR}

Primești acum TOT documentul, nu doar corpul: fiecare paragraf are și „unde”: corp, antet, subsol sau note.
Răspunzi cu JSON: {"corecturi":[{"i":număr,"vechi":"...","nou":"...","tip":"...","motiv":"..."}],"observatii":[{"tip":"date|juridic|formatare|lipsa|altele","text":"...","solutie":"...","corectura":{"i":număr,"vechi":"...","nou":"..."}}]}
- "corecturi": aceleași reguli ca mai sus, pentru tot documentul, inclusiv antetul și subsolul.
- "observatii": ce nu se poate repara prin înlocuire de text. Cauți în special:
  - "date": cifre, date calendaristice sau nume care se contrazic între ele în locuri diferite ale documentului;
  - "juridic": trimiteri la acte care nu se potrivesc cu ce se cere, condiții ale normei invocate care nu sunt arătate în text, solicitări care nu decurg din norma citată;
  - "formatare": indici sau exponenți pierduți, bold ori italic rupt la mijloc de frază, enumerări cu separatori amestecați;
  - "lipsa": rubrici rămase goale (număr de înregistrare, dată, număr de file, semnătură);
  - "altele": neconcordanțe între versiunea română și cea rusă, denumiri oficiale greșite.
- "text": citatul scurt din document, apoi ce e în neregulă.
- "solutie": ce trebuie făcut, concret și scurt. Nu „de verificat”, ci ce anume să scrie sau ce anume să compare omul.
- "corectura": o pui ori de câte ori soluția se poate scrie ca „înlocuiește X cu Y”, folosind numai ce e deja în document. Întreabă-te: pot să scriu eu acum textul corect, fără să aflu ceva din afară? Dacă da, pui "corectura", cu aceleași reguli ca la "vechi" / "nou" de mai sus („vechi” copiat exact, o singură apariție în paragraful "i").
- Merg aici: exponent sau indice pierdut („art. 473/4” → „art. 473⁴”, „pct. 171)” → „pct. 17¹)”); o formă scrisă altfel decât în restul actului (cifre grupate diferit, „nr.” cu sau fără spațiu, o denumire cu altă ortografie); o trimitere scrisă în două feluri; separatori amestecați într-o enumerare; o repetiție de scos. La „se uniformizează”, „se scrie la fel ca în cealaltă variantă”, „se scrie cu exponent”, „se scoate semnul” pui întotdeauna "corectura", pentru locul pe care îl îndrepți.
- Nu pui "corectura" și nu ghici doar când rezolvarea cere ceva ce nu scrie în document: numărul de înregistrare, data reală, care dintre două numere diferite e cel adevărat, un act pe care nu-l ai. Atunci în "solutie" spui ce are omul de completat sau de verificat.
- Cel mult 20 de observații, cele mai importante primele.
- Scrii pentru om: nu pomeni numerele paragrafelor („i”), ci citatul din document.
- Nu comenta mențiunea despre datele cu caracter personal: se verifică separat.
- Nu știi ce zi e azi, deci nu spui despre nicio dată din document că e în viitor sau în trecut.
- Nu inventa: dacă nu ai ce semnala, întorci "observatii":[].`;

export function mesajVerificare(paragrafe: { i: number; text: string; fel: string }[]): string {
  return JSON.stringify({ paragrafe: paragrafe.map((p) => ({ i: p.i, unde: p.fel, text: p.text })) });
}

// Schema raspunsului la verificare, pentru motoarele care o accepta (Claude). Aceleasi limite ca la
// SCHEMA_CORECTURI: additionalProperties false peste tot, fara minLength.
export const SCHEMA_VERIFICARE: Record<string, unknown> = {
  type: "object",
  properties: {
    corecturi: (SCHEMA_CORECTURI.properties as { corecturi: unknown }).corecturi,
    observatii: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tip: { type: "string", enum: [...TIPURI_OBSERVATIE] },
          text: { type: "string" },
          solutie: { type: "string" },
          corectura: {
            type: "object",
            properties: { i: { type: "integer" }, vechi: { type: "string" }, nou: { type: "string" } },
            required: ["i", "vechi", "nou"],
            additionalProperties: false,
          },
        },
        required: ["tip", "text", "solutie"],
        additionalProperties: false,
      },
    },
  },
  required: ["corecturi", "observatii"],
  additionalProperties: false,
};

// Verificarea intregului document, intr-o singura cerere. Iesirea e mai mare decat la un lot (corecturi
// din tot documentul plus observatii), dar tot mica fata de document.
export function cerereVerificare(model: string, paragrafe: { i: number; text: string; fel: string }[]): CerereText {
  return {
    model,
    sistem: PROMPT_VERIFICARE,
    utilizator: mesajVerificare(paragrafe),
    // Gandirea intra in plafon: pe un demers de 6.700 de caractere, DeepSeek a scos 26.557 de jetoane, deci la
    // 100.000 de caractere 32.768 nu ajung. 64.000 e acceptat de toate motoarele corectorului (DeepSeek si
    // Gemini verificate pe viu pe 22 sept. 2026; Anthropic da 64.000 la Haiku 4.5, Sonnet 5 si Opus 5).
    maxTokens: 64_000,
    schema: SCHEMA_VERIFICARE,
  };
}

// Inlocuirea propusa de model pentru o observatie, daca e valida pentru paragrafele trimise.
function corecturaObservatie(x: unknown, indici: Set<number>): CorecturaObservatie | undefined {
  const c = x as { i?: unknown; vechi?: unknown; nou?: unknown } | null | undefined;
  const i = Number(c?.i);
  const vechi = typeof c?.vechi === "string" ? c.vechi : "";
  const nou = typeof c?.nou === "string" ? c.nou : null;
  if (!Number.isInteger(i) || !indici.has(i) || !vechi.trim() || nou === null || vechi.length > 5000 || nou.length > 5000 || vechi === nou) return undefined;
  return { i, vechi, nou };
}

export function extrageVerificare(text: string, indici: Set<number>): { corecturi: Corectura[]; observatii: Observatie[] } {
  const d = jsonDinText(text) as { corecturi?: unknown; observatii?: unknown } | null;
  // Un raspuns care nu e JSON nu inseamna „document curat”: mai bine o eroare decat o lista goala mincinoasa.
  if (!Array.isArray(d?.corecturi) && !Array.isArray(d?.observatii)) {
    // Raspuns lung, care incepe ca JSON dar nu se inchide: modelul a fost taiat la plafonul de jetoane.
    const taiat = text.trim().length > 2_000 && /^[`\s]*(?:json)?\s*\{/.test(text.trim()) && !text.trimEnd().endsWith("}");
    throw new Error(taiat
      ? "Răspunsul modelului s-a oprit la jumătate: documentul e prea mare pentru o singură verificare. Împarte-l sau folosește modul „corectură”."
      : "Modelul nu a întors verificarea (nici corecturi, nici observații). Încearcă din nou sau alege alt model.");
  }
  const corecturi = extrageCorecturi(JSON.stringify({ corecturi: Array.isArray(d?.corecturi) ? d.corecturi : [] }), indici);
  const observatii: Observatie[] = [];
  for (const x of (Array.isArray(d?.observatii) ? d.observatii : []) as Record<string, unknown>[]) {
    const continut = String(x?.text ?? "").trim();
    if (!continut || despreMentiune({ text: continut })) continue; // mentiunea obligatorie se verifica in cod
    // O observatie a carei rezolvare e doar un spatiu e o observatie despre spatii: nu intra in raport.
    const c = x?.corectura as { vechi?: unknown; nou?: unknown } | undefined;
    if (typeof c?.vechi === "string" && typeof c?.nou === "string" && doarSpatii(c.vechi, c.nou)) continue;
    const tip = TIPURI_OBSERVATIE.includes(String(x?.tip) as (typeof TIPURI_OBSERVATIE)[number]) ? String(x.tip) : "altele";
    observatii.push({ tip, text: continut.slice(0, 700), solutie: String(x?.solutie ?? "").trim().slice(0, 700), corectura: corecturaObservatie(x?.corectura, indici) });
    if (observatii.length >= 20) break;
  }
  return { corecturi, observatii };
}
