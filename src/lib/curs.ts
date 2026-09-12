// Cursul oficial BNM al dolarului, pentru afisarea sumelor in lei. Jurnalul tine microdolari;
// lei sunt doar afisare. Cursul se cere o data pe zi (XML public, fara cheie), se tine in
// setari.curs_usd ca JSON {curs, zi}; daca BNM nu raspunde, ramane ultimul cunoscut.
//
// Verificat pe viu la 10 sept. 2026: GET https://www.bnm.md/ro/official_exchange_rates?get_xml=1&date=10.09.2026
// -> <ValCurs Date="10.09.2026"> cu <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>17.2388</Value>.

import { citesteSetare, seteazaSetare, fmtCost } from "./consum";

export interface CursUsd {
  curs: number;   // lei pentru 1 $
  zi: string;     // YYYY-MM-DD
}

export function extrageCursUsd(xml: string): CursUsd | null {
  const data = /<ValCurs[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  const valute = xml.match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/g) ?? [];
  const usd = valute.find((v) => /<CharCode>\s*USD\s*<\/CharCode>/.test(v));
  if (!data || !usd) return null;
  const nominal = Number(/<Nominal>\s*([\d.]+)\s*<\/Nominal>/.exec(usd)?.[1]);
  const valoare = Number(/<Value>\s*([\d.]+)\s*<\/Value>/.exec(usd)?.[1]);
  if (!(nominal > 0) || !(valoare > 0)) return null;
  return { curs: Math.round((valoare / nominal) * 10_000) / 10_000, zi: `${data[3]}-${data[2]}-${data[1]}` };
}

async function aduDeLaBnm(zi: string): Promise<string> {
  const [a, l, z] = zi.split("-");
  const r = await fetch(`https://www.bnm.md/ro/official_exchange_rates?get_xml=1&date=${z}.${l}.${a}`, {
    headers: { "user-agent": "Mozilla/5.0 (cataloage; ai.dumitru.cloud)" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) throw new Error(`BNM a răspuns ${r.status}`);
  return r.text();
}

// `adu` se injecteaza doar in teste.
export async function cursUsd(db: D1Database, azi: string, adu: (zi: string) => Promise<string> = aduDeLaBnm): Promise<CursUsd | null> {
  let cunoscut: CursUsd | null = null;
  try {
    const c = JSON.parse(await citesteSetare(db, "curs_usd"));
    if (c && typeof c.curs === "number" && typeof c.zi === "string") cunoscut = c;
  } catch { cunoscut = null; }
  if (cunoscut?.zi === azi) return cunoscut;
  try {
    const nou = extrageCursUsd(await adu(azi));
    if (nou) {
      const salvat = { curs: nou.curs, zi: azi };
      await seteazaSetare(db, "curs_usd", JSON.stringify(salvat));
      return salvat;
    }
  } catch { /* BNM nu raspunde: ramanem pe ultimul cunoscut */ }
  return cunoscut;
}

// 3600 microdolari la 17,2388 -> "6 bani"; 720000 -> "12 lei si 41 de bani"; 200 -> "sub 1 ban".
// Acordul din romana: 1 leu / 5 lei, 1 ban / 19 bani / 20 de bani (de la 20 in sus, cu "de").
export function fmtLei(microdolari: number, curs: number): string {
  if (microdolari === 0) return "0 lei";
  const bani = Math.round((microdolari / 1_000_000) * curs * 100);
  // Costul unei intrebari e adesea sub un ban; "0 bani" ar parea gresit, asa ca o spunem.
  if (bani === 0) return "sub 1 ban";
  const lei = Math.floor(bani / 100);
  const rest = bani % 100;
  const cuMii = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const parteLei = lei === 1 ? "1 leu" : `${cuMii(lei)} lei`;
  const parteBani = rest === 1 ? "1 ban" : rest < 20 ? `${rest} bani` : `${rest} de bani`;
  if (lei === 0) return parteBani;
  if (rest === 0) return parteLei;
  return `${parteLei} și ${parteBani}`;
}

// Pentru title: suma in dolari si cursul folosit.
export function explicatieLei(microdolari: number, c: CursUsd): string {
  const zi = new Date(`${c.zi}T12:00:00Z`).toLocaleDateString("ro-RO", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  return `${fmtCost(microdolari)} · curs BNM ${c.curs.toFixed(4).replace(".", ",")} lei/$ din ${zi}`;
}
