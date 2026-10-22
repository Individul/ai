// Motorul chatului si al corectorului: modelul ales in Admin decide motorul (Claude sau DeepSeek), iar
// intrebarea merge cu textul extras din R2. Rutele si paginile vorbesc doar cu acest modul; clientii
// (claude.ts, deepseek.ts) nu se apeleaza direct. Corectorul are doua feluri de cereri: un lot de
// paragrafe (corecteazaLot) si verificarea intregului document (verificaDocument).

import { listeazaSurse, type Catalog, type Sursa } from "./db";
import type { Citare } from "./consum";
import { BAZA_DEEPSEEK, completeaza, construiesteCerereText, EroareModel, intreabaDeepSeek, type RaspunsModel, type Schimb } from "./deepseek";
import { cerereCorectura, cerereVerificare, extrageCorecturi, extrageVerificare, type CerereText, type Observatie } from "./corector";
import { BAZA_CLAUDE, construiesteCerereClaude, intreabaClaude, intreabaClaudeChat } from "./claude";
import type { Corectura, ParagrafIntreg, ParagrafText } from "./docx";
import { construiesteContext, extrageCitariText, type SursaText } from "./context";
import { citesteText } from "./text";
import { costMicrodolari, motorModel, NUME_MOTOR, TARIFE, type Motor } from "./validare";

export interface Mediu {
  DB: D1Database;
  FISIERE: R2Bucket;
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface Intrebare {
  model: string;
  catalog: Catalog;
  istoric: Schimb[];
  intrebare: string;
  buget: number;        // caractere de context trimise modelului
}

export interface Rezultat {
  text: string;
  citari: Citare[];
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
  cost_microdolari: number; // la tariful public al modelului, cu tokenii din cache la pretul de cache
  mod: "integral" | "filtrat";
}

export type ApelChat = typeof intreabaDeepSeek;

// Cheia si adresa motorului, din mediu. `undefined` = motorul nu e configurat pe server.
export function cheieMotor(env: Mediu, motor: Motor): string | undefined {
  return (motor === "claude" ? env.ANTHROPIC_API_KEY : env.DEEPSEEK_API_KEY) || undefined;
}

export function bazaMotor(motor: Motor): string {
  return motor === "claude" ? BAZA_CLAUDE : BAZA_DEEPSEEK;
}

// Cate surse poate citi chatul: cele cu text extras nevid (PDF-urile scanate au 0 caractere).
export function disponibilePentruChat(surse: Pick<Sursa, "text_caractere">[]): number {
  return surse.filter((s) => (s.text_caractere ?? 0) > 0).length;
}

// `apel` (DeepSeek) si `apelClaude` se injecteaza doar in teste (fara retea). Bugetul de context si
// plafonul lunar al lui Claude le alege ruta (consum.ts).
// Textele surselor din R2 -> context (integral sau filtrat) -> model. La context prea lung reincearca o
// singura data cu bugetul injumatatit.
export async function raspunde(env: Mediu, i: Intrebare, apel: ApelChat = intreabaDeepSeek, apelClaude: ApelChat = intreabaClaudeChat): Promise<Rezultat> {
  const motor = motorModel(i.model);
  if (!motor) throw new EroareModel(409, "Modelul ales nu mai există; alege altul în Admin.");
  if (TARIFE[i.model]!.doar_corector) throw new EroareModel(409, "Modelul ales e doar pentru corector; alege alt model pentru chat în Admin.");
  const cheie = cheieMotor(env, motor);
  if (!cheie) throw new EroareModel(503, `Cheia ${NUME_MOTOR[motor]} nu este configurată pe server.`);
  const cere = motor === "claude" ? apelClaude : apel;
  const surse = (await listeazaSurse(env.DB, i.catalog.id)).filter((s) => (s.text_caractere ?? 0) > 0);
  const texte: SursaText[] = await Promise.all(
    surse.map(async (s) => ({ id: s.id, titlu: s.titlu, pagini: (await citesteText(env.FISIERE, s.id)) ?? [] }))
  );
  let buget = i.buget;
  for (let incercare = 0; ; incercare++) {
    const ctx = construiesteContext(texte, i.intrebare, buget);
    try {
      const r = await cere(cheie, bazaMotor(motor), { model: i.model, context: ctx.text, istoric: i.istoric, intrebare: i.intrebare });
      return {
        text: r.text, citari: extrageCitariText(r.text, surse),
        tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire,
        cost_microdolari: costMicrodolari(i.model, r.tokens_intrare, r.tokens_iesire, r.tokens_cache),
        mod: ctx.mod,
      };
    } catch (e) {
      if (incercare === 0 && e instanceof EroareModel && e.contextPreaLung) { buget = Math.floor(buget / 2); continue; }
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
}

export interface RezultatCorectare extends ConsumModel {
  corecturi: Corectura[];
}

export interface RezultatVerificare extends RezultatCorectare {
  observatii: Observatie[];
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

export type ApelText = (motor: Motor, cheie: string, baza: string, c: CerereText) => Promise<RaspunsModel>;

const apelText: ApelText = async (motor, cheie, baza, c) =>
  motor === "claude" ? intreabaClaude(cheie, baza, construiesteCerereClaude(c)) : completeaza(cheie, baza, construiesteCerereText(c));

// Un lot de paragrafe al corectorului, pe modelul din setari.model_corector. Motorul vine din model,
// ca la chat. `apel` se injecteaza doar in teste.
export async function corecteazaLot(env: Mediu, model: string, lot: ParagrafText[], apel: ApelText = apelText): Promise<RezultatCorectare> {
  const { consum, text } = await cereModelului(env, model, cerereCorectura(model, lot), apel);
  try {
    return { ...consum, corecturi: extrageCorecturi(text, new Set(lot.map((p) => p.i))) };
  } catch (e) {
    throw new EroareCorectare((e as Error).message, consum);
  }
}

// Verificarea intregului document (corp, antete, subsoluri, note) intr-o singura cerere: aceleasi
// corecturi, plus observatiile care cer om. Aceeasi cale ca la lot, alt prompt si alta schema.
export async function verificaDocument(
  env: Mediu, model: string, paragrafe: ParagrafIntreg[], apel: ApelText = apelText
): Promise<RezultatVerificare> {
  const { consum, text } = await cereModelului(env, model, cerereVerificare(model, paragrafe), apel);
  try {
    return { ...consum, ...extrageVerificare(text, new Set(paragrafe.map((p) => p.i))) };
  } catch (e) {
    throw new EroareCorectare((e as Error).message, consum);
  }
}

// Cererea catre modelul corectorului si consumul ei. Motorul vine din model, ca la chat.
async function cereModelului(env: Mediu, model: string, cerere: CerereText, apel: ApelText): Promise<{ consum: ConsumModel; text: string }> {
  const motor = motorModel(model);
  if (!motor) throw new EroareModel(409, "Modelul corectorului nu mai există; alege altul în Admin.");
  const cheie = cheieMotor(env, motor);
  if (!cheie) throw new EroareModel(503, `Cheia ${NUME_MOTOR[motor]} nu este configurată pe server.`);
  const r = await apel(motor, cheie, bazaMotor(motor), cerere);
  return {
    text: r.text,
    consum: {
      tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire,
      cost_microdolari: costMicrodolari(model, r.tokens_intrare, r.tokens_iesire, r.tokens_cache),
    },
  };
}
