// Corectorul pe planul tau Claude (Pro/Max), local, pe Mac. Doua feluri de a-l folosi:
//
//   - aplicatia Corector (mac/, `npm run mac`), care include acest script impachetat si il ruleaza cu --json;
//   - din Terminal: npm run corecteaza -- "/cale/Document.docx" [--model opus|sonnet|haiku] [--mod verificare]
//
// Doua moduri:
//   - corectura (implicit): doar corpul documentului, pe loturi de ~4.000 de caractere, in paralel. Rapid.
//   - verificare: tot documentul (corp, antete, subsoluri, note) intr-o singura cerere. Pune aceleasi
//     corecturi, inclusiv in antet, si intoarce in plus observatiile care cer om: date care se contrazic,
//     rubrici goale, formatare rupta, indoieli juridice. Pana la LIMITA_VERIFICARE caractere.
//
// Ruleaza Claude Code in mod neinteractiv (`claude -p`), logat cu contul tau, pe calculatorul tau: folosire
// individuala obisnuita a Claude Code. Abonamentul nu se poate folosi din Worker (regulile Anthropic,
// "Authentication and credential use"), deci pe planul personal corectorul merge doar asa, local.
// Acelasi prompt si aceleasi revizii Word ca in hub (src/lib/corector.ts, src/lib/docx.ts); hub-ul nu vede
// nimic si nu se scrie in jurnalul lui. Documentul corectat se scrie langa original, cu " (corectat)" in nume.
//
// Fara --json-schema (15 sept. 2026): cu Claude Code 2.1.32 si --tools "", cererile cu schema au stat
// 10 minute fara raspuns, de doua ori la rand. Promptul cere oricum JSON, iar raspunsul se citeste din text.
// Iesirea e stream-json, ca reincercarile lui Claude Code (limite, supraincarcare) sa se vada in aplicatie
// si in jurnalul de diagnostic (~/Library/Logs/Corector/AAAA-LL-ZZ.jsonl: felul evenimentelor si cifrele,
// fara textul documentului).
//
// --json: cate un eveniment JSON pe rand, pentru aplicatie: inceput, progres, stare, rezultat, eroare.
// CORECTOR_CLAUDE: calea catre `claude` (aplicatia o gaseste singura; pornita din Finder nu are PATH-ul
// din Terminal). Fara ea, scriptul refuza sa ruleze din interiorul unei sesiuni Claude Code, unde
// `claude -p` ramane blocat.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  analizeazaDocument, analizeazaIntreg, aplicaCorecturi, aplicaCorecturiIntreg, deschideDocx, paragrafeDeCorectat,
  paragrafeIntreg, salveazaDocx, salveazaDocxParti, type Corectura, type ParagrafText, type StareAplicare,
} from "../src/lib/docx.ts";
import {
  AUTOR_REVIZII, corecturiDinClaudeCode, evenimentClaudeCode, impartePeLoturi, LIMITA_PARAGRAF, LIMITA_VERIFICARE,
  mesajEroareClaudeCode, mesajVerificare, numara, PROMPT_CORECTOR, PROMPT_VERIFICARE, verificareDinClaudeCode,
  type Observatie,
} from "../src/lib/corector.ts";

const PARALELE = 3;
const TIMP_LOT_MS = 8 * 60_000;
const ESEC_RAPID_MS = 60_000; // doar un esec rapid (pornire, raspuns stricat) se reincearca; o asteptare lunga, nu
const CLAUDE = process.env.CORECTOR_CLAUDE || "claude";
const DIR_JURNAL = join(homedir(), "Library", "Logs", "Corector");

type Mod = "corectura" | "verificare";

interface CorecturaAfisata {
  stare: StareAplicare;
  tip: string;
  vechi: string;
  nou: string;
  motiv: string;
  inainte: string;
  dupa: string;
}

interface RezultatDocument {
  fisier: string;
  iesire: string | null;   // documentul corectat; null daca nicio corectura n-a intrat
  aplicate: number;
  corecturi: CorecturaAfisata[]; // aplicate si de verificat, in ordinea din document
  observatii: Observatie[];      // doar in modul verificare
  cost_usd: number;
  secunde: number;
  esecuri: string[];
}

type Eveniment =
  | { tip: "inceput"; fisier: string; loturi: number; paragrafe: number; mod: Mod }
  | { tip: "progres"; fisier: string; gata: number; total: number }
  | { tip: "stare"; fisier: string; mesaj: string }
  | ({ tip: "rezultat" } & RezultatDocument)
  | { tip: "eroare"; fisier: string; mesaj: string };

// Procesele `claude -p` mor odata cu scriptul: butonul „oprește” din aplicatie trimite SIGTERM.
const copii = new Set<ChildProcess>();
for (const semnal of ["SIGTERM", "SIGINT"] as const) {
  process.on(semnal, () => {
    for (const c of copii) c.kill("SIGTERM");
    process.exit(143);
  });
}

function jurnalizeaza(date: Record<string, unknown>) {
  try {
    mkdirSync(DIR_JURNAL, { recursive: true });
    appendFileSync(join(DIR_JURNAL, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ la: new Date().toISOString(), ...date })}\n`);
  } catch {
    // jurnalul e doar pentru diagnostic
  }
}

class EroareLot extends Error {
  rapid: boolean;
  constructor(mesaj: string, rapid: boolean) {
    super(mesaj);
    this.rapid = rapid;
  }
}

// O cerere catre Claude Code; intoarce randul „result” brut, de citit cu corecturiDinClaudeCode /
// verificareDinClaudeCode.
function cere(
  intrare: string, prompt: string, model: string, eticheta: { fisier: string; parte: number; caractere: number },
  laStare: (mesaj: string) => void
): Promise<string> {
  return new Promise((rezolva, respinge) => {
    const t0 = Date.now();
    const jurnal = (d: Record<string, unknown>) =>
      jurnalizeaza({ fisier: basename(eticheta.fisier), parte: eticheta.parte, model, dupa_s: Math.round((Date.now() - t0) / 1000), ...d });
    // Director temporar: fara CLAUDE.md-ul proiectului in context. Fara unelte: modelul doar citeste si raspunde.
    const p = spawn(CLAUDE, [
      "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--tools", "", "--model", model,
      "--system-prompt", prompt,
    ], { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    copii.add(p);
    jurnal({ eveniment: "pornit", caractere: eticheta.caractere });

    let rest = "";
    let rezultat: string | null = null;
    let erori = "";
    let expirat = false;
    const citeste = (rand: string) => {
      const e = evenimentClaudeCode(rand);
      if (!e) return;
      jurnal(e.jurnal);
      if (e.fel === "rezultat") rezultat = rand;
      if (e.fel === "reincercare") laStare(`Claude reîncearcă: ${e.eroare} (încercarea ${e.incercare}${e.max ? ` din ${e.max}` : ""})`);
    };
    p.stdout.on("data", (b) => {
      rest += b;
      for (let k = rest.indexOf("\n"); k >= 0; k = rest.indexOf("\n")) {
        citeste(rest.slice(0, k));
        rest = rest.slice(k + 1);
      }
    });
    p.stderr.on("data", (b) => (erori += b));
    const ceas = setTimeout(() => {
      expirat = true;
      p.kill("SIGTERM");
    }, TIMP_LOT_MS);
    p.on("error", (e) => {
      copii.delete(p);
      clearTimeout(ceas);
      jurnal({ eveniment: "nu_porneste", mesaj: e.message });
      respinge(new EroareLot(`Nu pot porni „claude” (${e.message}). Instalează Claude Code și loghează-te cu contul tău.`, false));
    });
    p.on("close", (cod) => {
      copii.delete(p);
      clearTimeout(ceas);
      if (rest.trim()) citeste(rest);
      jurnal({ eveniment: "inchis", cod, expirat, stderr: erori.trim().slice(0, 300) || undefined });
      if (expirat) {
        respinge(new EroareLot(`Claude nu a răspuns în ${TIMP_LOT_MS / 60_000} minute. Detalii în ~/Library/Logs/Corector.`, false));
        return;
      }
      if (!rezultat) {
        const rapid = Date.now() - t0 < ESEC_RAPID_MS;
        respinge(new EroareLot(mesajEroareClaudeCode(`Claude Code s-a oprit fără rezultat${erori.trim() ? `: ${erori.trim().slice(0, 200)}` : ""}${cod ? ` [cod ${cod}]` : ""}.`), rapid));
        return;
      }
      rezolva(rezultat);
    });
    p.stdin.end(intrare);
  });
}

// `cere`, cu o singura reincercare daca a picat repede (pornire, raspuns stricat).
async function cereCuReincercare(
  intrare: string, prompt: string, model: string, eticheta: { fisier: string; parte: number; caractere: number },
  laStare: (mesaj: string) => void
): Promise<string> {
  try {
    return await cere(intrare, prompt, model, eticheta, laStare);
  } catch (e) {
    if (!(e instanceof EroareLot) || !e.rapid) throw e;
    return cere(intrare, prompt, model, eticheta, laStare);
  }
}

function numeLibera(original: string): string {
  const baza = join(dirname(original), `${basename(original, ".docx")} (corectat)`);
  let cale = `${baza}.docx`;
  for (let k = 2; existsSync(cale); k++) cale = `${baza} ${k}.docx`;
  return cale;
}

const afisabile = (aplicari: { stare: StareAplicare; tip: string; vechi: string; nou: string; motiv: string; inainte: string; dupa: string }[]) =>
  aplicari
    .filter((a) => a.stare !== "fara_schimbare")
    .map(({ stare, tip, vechi, nou, motiv, inainte, dupa }) => ({ stare, tip, vechi, nou, motiv, inainte, dupa }));

// ---------------------------------------------------------------- modul corectura (corpul, pe loturi)

async function corecteaza(fisier: string, model: string, anunta: (e: Eveniment) => void): Promise<RezultatDocument> {
  const docx = deschideDocx(new Uint8Array(readFileSync(fisier)));
  const analiza = analizeazaDocument(docx.xml);
  const paragrafe = paragrafeDeCorectat(analiza).filter((p) => p.text.length <= LIMITA_PARAGRAF);
  const loturi = impartePeLoturi(paragrafe);
  anunta({ tip: "inceput", fisier, loturi: loturi.length, paragrafe: paragrafe.length, mod: "corectura" });
  const t0 = Date.now();
  if (!paragrafe.length) return { fisier, iesire: null, aplicate: 0, corecturi: [], observatii: [], cost_usd: 0, secunde: 0, esecuri: [] };

  const laStare = (mesaj: string) => anunta({ tip: "stare", fisier, mesaj });
  const rezultate: Corectura[][] = loturi.map(() => []);
  const esecuri: string[] = [];
  let cost = 0;
  let gata = 0;
  let urmatorul = 0;
  await Promise.all(Array.from({ length: Math.min(PARALELE, loturi.length) }, async () => {
    while (urmatorul < loturi.length) {
      const k = urmatorul++;
      const parte = loturi[k]!;
      const eticheta = { fisier, parte: k + 1, caractere: parte.reduce((s, x) => s + x.text.length, 0) };
      try {
        const brut = await cereCuReincercare(JSON.stringify({ paragrafe: parte }), PROMPT_CORECTOR, model, eticheta, laStare);
        const r = corecturiDinClaudeCode(brut, new Set(parte.map((x) => x.i)));
        rezultate[k] = r.corecturi;
        cost += r.cost_usd;
      } catch (e) {
        esecuri.push((e as Error).message);
      }
      gata++;
      anunta({ tip: "progres", fisier, gata, total: loturi.length });
    }
  }));
  if (esecuri.length === loturi.length) throw new Error(esecuri[0]);

  const { xml, aplicari } = aplicaCorecturi(analiza, rezultate.flat(), { autor: AUTOR_REVIZII, data: acum() });
  const corecturi = afisabile(aplicari);
  const aplicate = corecturi.filter((a) => a.stare === "aplicata").length;
  const iesire = aplicate ? numeLibera(fisier) : null;
  if (iesire) writeFileSync(iesire, salveazaDocx(docx, xml));
  return { fisier, iesire, aplicate, corecturi, observatii: [], cost_usd: cost, secunde: secunde(t0), esecuri };
}

// ---------------------------------------------------------------- modul verificare (tot documentul, o cerere)

async function verifica(fisier: string, model: string, anunta: (e: Eveniment) => void): Promise<RezultatDocument> {
  const docx = deschideDocx(new Uint8Array(readFileSync(fisier)));
  const doc = analizeazaIntreg(docx);
  const paragrafe = paragrafeIntreg(doc).filter((p) => p.text.length <= LIMITA_PARAGRAF);
  const caractere = paragrafe.reduce((s, p) => s + p.text.length, 0);
  anunta({ tip: "inceput", fisier, loturi: 1, paragrafe: paragrafe.length, mod: "verificare" });
  const t0 = Date.now();
  if (!paragrafe.length) return { fisier, iesire: null, aplicate: 0, corecturi: [], observatii: [], cost_usd: 0, secunde: 0, esecuri: [] };
  if (caractere > LIMITA_VERIFICARE) {
    throw new Error(`Documentul are ${caractere.toLocaleString("ro-RO")} de caractere, peste plafonul de ${LIMITA_VERIFICARE.toLocaleString("ro-RO")} al verificării. Folosește modul „corectură”.`);
  }

  const laStare = (mesaj: string) => anunta({ tip: "stare", fisier, mesaj });
  const brut = await cereCuReincercare(mesajVerificare(paragrafe), PROMPT_VERIFICARE, model, { fisier, parte: 1, caractere }, laStare);
  const r = verificareDinClaudeCode(brut, new Set(paragrafe.map((p) => p.i)));
  anunta({ tip: "progres", fisier, gata: 1, total: 1 });

  const { xml, aplicari } = aplicaCorecturiIntreg(doc, r.corecturi, { autor: AUTOR_REVIZII, data: acum() });
  const corecturi = afisabile(aplicari);
  const aplicate = corecturi.filter((a) => a.stare === "aplicata").length;
  const iesire = aplicate ? numeLibera(fisier) : null;
  if (iesire) writeFileSync(iesire, salveazaDocxParti(docx, xml));
  return { fisier, iesire, aplicate, corecturi, observatii: r.observatii, cost_usd: r.cost_usd, secunde: secunde(t0), esecuri: [] };
}

const acum = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const secunde = (t0: number) => Math.round((Date.now() - t0) / 1000);

// ---------------------------------------------------------------- iesirea pentru om (Terminal)

function afiseazaProgres(e: Eveniment) {
  if (e.tip === "inceput") console.log(`\n${basename(e.fisier)} (${e.mod})`);
  if (e.tip === "progres") process.stdout.write(`\r  ${e.gata} din ${numara(e.total, "parte", "părți")}…${e.gata === e.total ? "\n" : ""}`);
  if (e.tip === "stare") console.log(`\n  ${e.mesaj}`);
}

function afiseazaRezultat(r: RezultatDocument, model: string) {
  const deVerificat = r.corecturi.filter((c) => c.stare !== "aplicata");
  if (r.iesire) console.log(`  ${numara(r.aplicate, "corectură", "corecturi")} ca modificări urmărite → ${r.iesire}`);
  else console.log(deVerificat.length ? "  Nicio corectură nu a putut fi pusă automat." : "  Nu am găsit greșeli.");
  console.log(`  ${r.secunde} s, model ${model}; cost echivalent raportat de Claude Code: ${r.cost_usd.toFixed(4)} $ (pe planul Max intră în limitele planului, nu se facturează)`);
  for (const c of deVerificat) console.log(`  de verificat (${c.stare}): „${c.vechi}” → „${c.nou}” · ${c.motiv}`);
  for (const o of r.observatii) console.log(`  observație (${o.tip}): ${o.text}`);
  if (r.esecuri.length) console.log(`  Atenție: ${numara(r.esecuri.length, "parte", "părți")} nu s-au putut corecta: ${r.esecuri[0]}`);
}

// ---------------------------------------------------------------- pornire

const argumente = process.argv.slice(2);
const json = argumente.includes("--json");
const valoare = (nume: string, implicit: string) => {
  const k = argumente.indexOf(nume);
  return k >= 0 ? argumente[k + 1] ?? implicit : implicit;
};
const model = valoare("--model", "opus");
const mod: Mod = valoare("--mod", "corectura") === "verificare" ? "verificare" : "corectura";
const dupaOptiune = new Set([argumente.indexOf("--model") + 1, argumente.indexOf("--mod") + 1].filter((k) => k > 0));
const fisiere = argumente.filter((a, k) => !a.startsWith("--") && !dupaOptiune.has(k));
const scrieEveniment = (e: Eveniment) => process.stdout.write(`${JSON.stringify(e)}\n`);

if (process.env.CLAUDECODE && !process.env.CORECTOR_CLAUDE) {
  console.error("Rulează comanda într-un Terminal obișnuit, nu dintr-o sesiune Claude Code.");
  process.exit(1);
}
if (!fisiere.length) {
  console.error('Folosire: npm run corecteaza -- "/cale/Document.docx" [--model opus|sonnet|haiku] [--mod verificare]');
  process.exit(1);
}
let cod = 0;
for (const f of fisiere) {
  try {
    if (!/\.docx$/i.test(f)) throw new Error("Doar documente Word .docx.");
    const r = mod === "verificare"
      ? await verifica(f, model, json ? scrieEveniment : afiseazaProgres)
      : await corecteaza(f, model, json ? scrieEveniment : afiseazaProgres);
    if (json) scrieEveniment({ tip: "rezultat", ...r });
    else afiseazaRezultat(r, model);
  } catch (e) {
    const mesaj = (e as Error).message;
    if (json) scrieEveniment({ tip: "eroare", fisier: f, mesaj });
    else console.error(`  Eroare la ${basename(f)}: ${mesaj}`);
    cod = 1;
  }
}
process.exit(cod);
