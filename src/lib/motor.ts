// Motorul chatului: modelul ales in Admin decide daca intrebarea merge la Gemini File Search
// sau la un model OpenAI-compatibil (Z.AI sau DeepSeek) cu textul extras din R2. Tot aici,
// corectorul (corecteazaLot), care poate merge si la Claude. Rutele si paginile vorbesc doar cu
// acest modul; clientii (gemini.ts, zai.ts, claude.ts) nu se apeleaza direct.

import { listeazaSurse, type Catalog, type Sursa } from "./db";
import type { Citare } from "./consum";
import { costMicrodolari, genereaza, intreaba, EroareGemini, type Schimb } from "./gemini";
import { BAZA_DEEPSEEK, BAZA_ZAI, completeaza, construiesteCerereText, crediteZai, EroareZai, intreabaZai, type RaspunsZai } from "./zai";
import { cerereCorectura, extrageCorecturi, type CerereText } from "./corector";
import { BAZA_CLAUDE, construiesteCerereClaude, intreabaClaude } from "./claude";
import type { Corectura, ParagrafText } from "./docx";
import { construiesteContext, extrageCitariText, type SursaText } from "./context";
import { citesteText } from "./text";
import { motorModel, NUME_MOTOR, type Motor } from "./validare";

export interface Mediu {
  DB: D1Database;
  FISIERE: R2Bucket;
  GEMINI_API_KEY?: string;
  ZAI_API_KEY?: string;
  ZAI_API_BASE?: string;
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface Intrebare {
  model: string;
  catalog: Catalog;
  istoric: Schimb[];
  intrebare: string;
  buget: number;        // caractere de context pentru motoarele cu text; Gemini il ignora
}

export interface Rezultat {
  text: string;
  citari: Citare[];
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
  cost_microdolari: number; // la tariful public al modelului, cu tokenii din cache la pretul de cache
  credite: number;          // creditele planului Z.AI; 0 la celelalte
  mod: "gemini" | "integral" | "filtrat";
}

export type ApelZai = typeof intreabaZai;

// Cheia si adresa motorului, din mediu. `undefined` = motorul nu e configurat pe server.
export function cheieMotor(env: Mediu, motor: Motor): string | undefined {
  if (motor === "gemini") return env.GEMINI_API_KEY || undefined;
  if (motor === "zai") return env.ZAI_API_KEY || undefined;
  if (motor === "claude") return env.ANTHROPIC_API_KEY || undefined;
  return env.DEEPSEEK_API_KEY || undefined;
}

export function bazaMotor(env: Mediu, motor: Motor): string {
  if (motor === "zai") return env.ZAI_API_BASE || BAZA_ZAI;
  return motor === "claude" ? BAZA_CLAUDE : BAZA_DEEPSEEK;
}

// Cate surse poate citi motorul dat: Gemini cere document indexat (si magazin pe catalog),
// motoarele cu text cer text extras nevid (PDF-urile scanate au 0 caractere).
export function disponibilePentruChat(
  motor: Motor, magazin: string | null, surse: Pick<Sursa, "indexare" | "text_caractere">[]
): number {
  if (motor !== "gemini") return surse.filter((s) => (s.text_caractere ?? 0) > 0).length;
  if (!magazin) return 0;
  return surse.filter((s) => s.indexare === "gata").length;
}

// `apel` se injecteaza doar in teste (fara retea).
export async function raspunde(env: Mediu, i: Intrebare, apel: ApelZai = intreabaZai): Promise<Rezultat> {
  const motor = motorModel(i.model) ?? "gemini";
  if (motor === "claude") throw new EroareZai(409, "Modelele Claude sunt doar pentru corector; alege alt model pentru chat în Admin.");
  if (motor !== "gemini") return raspundeText(env, motor, i, apel);
  if (!env.GEMINI_API_KEY) throw new EroareGemini(503, "Cheia Gemini nu este configurată pe server.");
  if (!i.catalog.magazin) throw new EroareGemini(409, "Culegerea nu are încă documente indexate.");
  const r = await intreaba(env.GEMINI_API_KEY, { model: i.model, magazin: i.catalog.magazin, istoric: i.istoric, intrebare: i.intrebare });
  return {
    text: r.text, citari: r.citari, tokens_intrare: r.tokens_intrare, tokens_cache: 0, tokens_iesire: r.tokens_iesire,
    cost_microdolari: costMicrodolari(i.model, r.tokens_intrare, r.tokens_iesire), credite: 0, mod: "gemini",
  };
}

// Textele surselor din R2 -> context (integral sau filtrat) -> model OpenAI-compatibil.
// La context prea lung (3 M caractere pot depasi 1 M tokeni) reincearca o singura data cu bugetul injumatatit.
async function raspundeText(env: Mediu, motor: Motor, i: Intrebare, apel: ApelZai): Promise<Rezultat> {
  const cheie = cheieMotor(env, motor);
  if (!cheie) throw new EroareZai(503, `Cheia ${motor === "zai" ? "Z.AI" : "DeepSeek"} nu este configurată pe server.`);
  const surse = (await listeazaSurse(env.DB, i.catalog.id)).filter((s) => (s.text_caractere ?? 0) > 0);
  const texte: SursaText[] = await Promise.all(
    surse.map(async (s) => ({ id: s.id, titlu: s.titlu, pagini: (await citesteText(env.FISIERE, s.id)) ?? [] }))
  );
  const baza = bazaMotor(env, motor);
  let buget = i.buget;
  for (let incercare = 0; ; incercare++) {
    const ctx = construiesteContext(texte, i.intrebare, buget);
    try {
      const r = await apel(cheie, baza, { model: i.model, context: ctx.text, istoric: i.istoric, intrebare: i.intrebare });
      return {
        text: r.text, citari: extrageCitariText(r.text, surse),
        tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire,
        cost_microdolari: costMicrodolari(i.model, r.tokens_intrare, r.tokens_iesire, r.tokens_cache),
        credite: crediteZai(i.model, r.tokens_intrare, r.tokens_cache, r.tokens_iesire),
        mod: ctx.mod,
      };
    } catch (e) {
      if (incercare === 0 && e instanceof EroareZai && e.contextPreaLung) { buget = Math.floor(buget / 2); continue; }
      throw e;
    }
  }
}

// ---------------------------------------------------------------- corector

export interface ConsumModel {
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
  cost_microdolari: number;
  credite: number;
}

export interface RezultatCorectare extends ConsumModel {
  corecturi: Corectura[];
}

// Modelul a raspuns (deci s-a platit), dar raspunsul nu se poate citi: eroarea poarta consumul,
// ca sa intre in jurnal.
export class EroareCorectare extends Error {
  consum: ConsumModel;
  constructor(mesaj: string, consum: ConsumModel) {
    super(mesaj);
    this.consum = consum;
  }
}

export type ApelText = (motor: Motor, cheie: string, baza: string, c: CerereText) => Promise<RaspunsZai>;

const apelText: ApelText = async (motor, cheie, baza, c) => {
  if (motor === "claude") return intreabaClaude(cheie, baza, construiesteCerereClaude(c));
  if (motor !== "gemini") return completeaza(cheie, baza, construiesteCerereText(c));
  const r = await genereaza(cheie, c);
  return { text: r.text, tokens_intrare: r.tokens_intrare, tokens_cache: 0, tokens_iesire: r.tokens_iesire };
};

// Un lot de paragrafe al corectorului, pe modelul din setari.model_corector. Motorul vine din model,
// ca la chat. `apel` se injecteaza doar in teste.
export async function corecteazaLot(env: Mediu, model: string, lot: ParagrafText[], apel: ApelText = apelText): Promise<RezultatCorectare> {
  const motor = motorModel(model) ?? "gemini";
  const cheie = cheieMotor(env, motor);
  if (!cheie) throw new EroareZai(503, `Cheia ${NUME_MOTOR[motor]} nu este configurată pe server.`);
  const r = await apel(motor, cheie, bazaMotor(env, motor), cerereCorectura(model, lot));
  const consum: ConsumModel = {
    tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire,
    cost_microdolari: costMicrodolari(model, r.tokens_intrare, r.tokens_iesire, r.tokens_cache),
    credite: crediteZai(model, r.tokens_intrare, r.tokens_cache, r.tokens_iesire),
  };
  try {
    return { ...consum, corecturi: extrageCorecturi(r.text, new Set(lot.map((p) => p.i))) };
  } catch (e) {
    throw new EroareCorectare((e as Error).message, consum);
  }
}
