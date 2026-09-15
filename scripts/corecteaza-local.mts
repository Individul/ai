// Corectorul pe planul tau Claude (Pro/Max), local, pe Mac:
//
//   npm run corecteaza -- "/cale/Document.docx" [alt.docx ...] [--model opus|sonnet|haiku]
//
// Ruleaza Claude Code in mod neinteractiv (`claude -p`), logat cu contul tau, pe calculatorul tau: folosire
// individuala obisnuita a Claude Code. Abonamentul nu se poate folosi din Worker (regulile Anthropic,
// "Authentication and credential use"), deci pe planul personal corectorul merge doar asa, local.
// Acelasi prompt, aceeasi schema si aceleasi revizii Word ca in hub (src/lib/corector.ts, src/lib/docx.ts);
// hub-ul nu vede nimic si nu se scrie in jurnal. Documentul corectat se scrie langa original, cu
// " (corectat)" in nume. Se ruleaza dintr-un Terminal obisnuit, nu dintr-o sesiune Claude Code.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  analizeazaDocument, aplicaCorecturi, deschideDocx, paragrafeDeCorectat, salveazaDocx, type Corectura, type ParagrafText,
} from "../src/lib/docx.ts";
import {
  AUTOR_REVIZII, corecturiDinClaudeCode, impartePeLoturi, LIMITA_PARAGRAF, numara, PROMPT_CORECTOR, SCHEMA_CORECTURI,
} from "../src/lib/corector.ts";

const PARALELE = 3;
const TIMP_LOT_MS = 10 * 60_000;

function lot(paragrafe: ParagrafText[], model: string): Promise<{ corecturi: Corectura[]; cost_usd: number }> {
  return new Promise((rezolva, respinge) => {
    // Director temporar: fara CLAUDE.md-ul proiectului in context. Fara unelte: modelul doar citeste si raspunde.
    const p = spawn("claude", [
      "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--model", model,
      "--system-prompt", PROMPT_CORECTOR, "--json-schema", JSON.stringify(SCHEMA_CORECTURI),
    ], { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let iesire = "";
    let erori = "";
    p.stdout.on("data", (b) => (iesire += b));
    p.stderr.on("data", (b) => (erori += b));
    const ceas = setTimeout(() => p.kill("SIGTERM"), TIMP_LOT_MS);
    p.on("error", (e) => {
      clearTimeout(ceas);
      respinge(new Error(`Nu pot porni „claude” (${e.message}). Instalează Claude Code și loghează-te cu contul tău.`));
    });
    p.on("close", (cod) => {
      clearTimeout(ceas);
      try {
        rezolva(corecturiDinClaudeCode(iesire, new Set(paragrafe.map((x) => x.i))));
      } catch (e) {
        respinge(new Error(`${(e as Error).message}${erori.trim() ? ` (${erori.trim().slice(0, 200)})` : ""}${cod ? ` [cod ${cod}]` : ""}`));
      }
    });
    p.stdin.end(JSON.stringify({ paragrafe }));
  });
}

function numeLibera(original: string): string {
  const baza = join(dirname(original), `${basename(original, ".docx")} (corectat)`);
  let cale = `${baza}.docx`;
  for (let k = 2; existsSync(cale); k++) cale = `${baza} ${k}.docx`;
  return cale;
}

async function corecteaza(fisier: string, model: string): Promise<void> {
  console.log(`\n${basename(fisier)}`);
  const docx = deschideDocx(new Uint8Array(readFileSync(fisier)));
  const analiza = analizeazaDocument(docx.xml);
  const paragrafe = paragrafeDeCorectat(analiza).filter((p) => p.text.length <= LIMITA_PARAGRAF);
  if (!paragrafe.length) { console.log("  Documentul nu are text de corectat."); return; }
  const loturi = impartePeLoturi(paragrafe);
  const rezultate: Corectura[][] = loturi.map(() => []);
  const esecuri: string[] = [];
  let cost = 0;
  let gata = 0;
  let urmatorul = 0;
  const t0 = Date.now();
  const scrieProgres = () => process.stdout.write(`\r  ${gata} din ${numara(loturi.length, "parte", "părți")} (model ${model})…`);
  scrieProgres();
  await Promise.all(Array.from({ length: Math.min(PARALELE, loturi.length) }, async () => {
    while (urmatorul < loturi.length) {
      const k = urmatorul++;
      try {
        const r = await lot(loturi[k]!, model).catch(() => lot(loturi[k]!, model)); // o reincercare
        rezultate[k] = r.corecturi;
        cost += r.cost_usd;
      } catch (e) {
        esecuri.push((e as Error).message);
      }
      gata++;
      scrieProgres();
    }
  }));
  process.stdout.write("\n");
  if (esecuri.length === loturi.length) throw new Error(esecuri[0]);

  const toate = rezultate.flat();
  const { xml, aplicari } = aplicaCorecturi(analiza, toate, { autor: AUTOR_REVIZII, data: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") });
  const aplicate = aplicari.filter((a) => a.stare === "aplicata");
  const deVerificat = aplicari.filter((a) => a.stare === "negasita" || a.stare === "suprapusa" || a.stare === "blocata");
  const secunde = Math.round((Date.now() - t0) / 1000);
  if (aplicate.length) {
    const cale = numeLibera(fisier);
    writeFileSync(cale, salveazaDocx(docx, xml));
    console.log(`  ${numara(aplicate.length, "corectură", "corecturi")} ca modificări urmărite → ${cale}`);
  } else {
    console.log(deVerificat.length ? "  Nicio corectură nu a putut fi pusă automat." : "  Nu am găsit greșeli.");
  }
  console.log(`  ${secunde} s; cost echivalent raportat de Claude Code: ${cost.toFixed(4)} $ (pe planul Max intră în limitele planului, nu se facturează)`);
  for (const a of deVerificat) console.log(`  de verificat (${a.stare}): „${a.vechi}” → „${a.nou}” · ${a.motiv}`);
  if (esecuri.length) console.log(`  Atenție: ${numara(esecuri.length, "parte", "părți")} din ${loturi.length} nu s-au putut corecta: ${esecuri[0]}`);
}

const argumente = process.argv.slice(2);
const iModel = argumente.indexOf("--model");
const model = iModel >= 0 ? argumente[iModel + 1] ?? "opus" : "opus";
const fisiere = argumente.filter((a, k) => !a.startsWith("--") && !(iModel >= 0 && k === iModel + 1));

if (process.env.CLAUDECODE) {
  console.error("Rulează comanda într-un Terminal obișnuit, nu dintr-o sesiune Claude Code.");
  process.exit(1);
}
if (!fisiere.length) {
  console.error('Folosire: npm run corecteaza -- "/cale/Document.docx" [--model opus|sonnet|haiku]');
  process.exit(1);
}
let cod = 0;
for (const f of fisiere) {
  try {
    if (!/\.docx$/i.test(f)) throw new Error("doar documente .docx");
    await corecteaza(f, model);
  } catch (e) {
    console.error(`  Eroare la ${basename(f)}: ${(e as Error).message}`);
    cod = 1;
  }
}
process.exit(cod);
