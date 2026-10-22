// DeepSeek prin REST (API OpenAI-compatibil), fara SDK. Singurul fisier care vorbeste cu DeepSeek.
// Pana la 22 oct. 2026 era clientul Z.AI (GLM), refolosit si pentru DeepSeek; Gemini si GLM au fost
// scoase din aplicatie atunci, iar chatul ramane pe Claude Sonnet 5.5, cu DeepSeek ca rezerva.
//
// Verificat pe viu la 9 sept. 2026, pe deepseek-v4-flash: usage are prompt_tokens (total, include
// cache-ul), prompt_cache_hit_tokens / prompt_cache_miss_tokens (si prompt_tokens_details.cached_tokens);
// a doua cerere cu acelasi prefix de ~20 k tokeni a venit din cache cu 19.712 din 19.829 tokeni, dupa ~1 s.
// Cache-ul e automat, pe prefix, fara configurare. Context prea lung: "maximum context length is N tokens".

import type { CerereText } from "./corector";

export const BAZA_DEEPSEEK = "https://api.deepseek.com";

export const PROMPT_SISTEM_CHAT = `Ești asistentul unei culegeri de acte normative din sistemul penitenciar al Republicii Moldova.
Răspunzi în limba română, doar pe baza documentelor de mai jos. Fiecare pagină începe cu un antet „=== Titlu | pag. N ===”.
După fiecare afirmație citează sursa exact în forma [Titlu, pag. N], cu titlul din antet și numărul paginii, fără altceva în paranteză; articolul, punctul sau alineatul le menționezi în text, înaintea parantezei.
Dacă informația nu se găsește în documente, spune clar „Nu am găsit această informație în documentele culegerii” și nu inventa.
Fii concis și precis; nu da interpretări juridice proprii și nu speculezi dincolo de text.`;

// Un schimb anterior din conversatie (istoricul vine de la client).
export interface Schimb {
  intrebare: string;
  raspuns: string;
}

export interface CerereChat {
  model: string;
  context: string;      // paginile cu antete, din construiesteContext
  istoric: Schimb[];
  intrebare: string;
}

export interface RaspunsModel {
  text: string;
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
}

// Eroarea unui model cu text (DeepSeek sau Claude), cu statusul HTTP pe care il intoarce ruta.
export class EroareModel extends Error {
  status: number;
  cod: string | null;
  contextPreaLung: boolean;
  constructor(status: number, mesaj: string, cod: string | null = null) {
    super(mesaj);
    this.status = status;
    this.cod = cod;
    this.contextPreaLung = /exceeds max length|maximum context length|context length|too long/i.test(mesaj);
  }
}

// Documentele stau in system, inaintea istoricului: prefixul ramane identic intre intrebari, deci
// cache-ul DeepSeek il poate refolosi. Istoricul: ultimele 8 schimburi, trunchiate.
// Gandirea ramane pornita: pe 12 sept. 2026, fara ea, DeepSeek 4.1 raspundea "nu am gasit" la
// intrebarile care cer legarea a doua-trei articole, desi textul era in context (5 refuzuri fara ea,
// 4 raspunsuri corecte cu ea, acelasi context de 740 k tokeni). Tokenii de gandire intra in max_tokens.
export function construiesteCerereChat(c: CerereChat): Record<string, unknown> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: `${PROMPT_SISTEM_CHAT}\n\nDOCUMENTE:\n${c.context}` },
  ];
  for (const s of c.istoric.slice(-8)) {
    if (!s.intrebare || !s.raspuns) continue;
    messages.push({ role: "user", content: s.intrebare.slice(0, 2000) });
    messages.push({ role: "assistant", content: s.raspuns.slice(0, 4000) });
  }
  messages.push({ role: "user", content: c.intrebare });
  return { model: c.model, messages, stream: false, temperature: 0.2, max_tokens: 8192 };
}

export function extrageRaspunsText(d: any): RaspunsModel {
  const continut = d?.choices?.[0]?.message?.content;
  const u = d?.usage ?? {};
  return {
    text: typeof continut === "string" ? continut.trim() : "",
    tokens_intrare: Number(u.prompt_tokens ?? 0),
    tokens_cache: Number(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0),
    tokens_iesire: Number(u.completion_tokens ?? 0),
  };
}

export async function intreabaDeepSeek(cheie: string, baza: string, c: CerereChat): Promise<RaspunsModel> {
  return completeaza(cheie, baza, construiesteCerereChat(c));
}

// Cererea corectorului: sistem + utilizator, raspuns JSON (response_format json_object, verificat pe
// viu pe deepseek-flash, cu si fara gandire). Gandirea ramane pornita: pe 14 sept. 2026, pe aceeasi
// nota de o pagina, fara gandire DeepSeek a scapat jumatate din greseli si a schimbat cuvinte
// ("deținere" -> "detenție", "unei anchete" -> "unei anchetă"); cu gandire a dat 31 de corecturi, toate
// bune, in 38 s si ~9.000 de tokeni de iesire (din care 7.900 de gandire), deci loturi mici si
// max_tokens mare.
export function construiesteCerereText(c: CerereText): Record<string, unknown> {
  return {
    model: c.model,
    messages: [{ role: "system", content: c.sistem }, { role: "user", content: c.utilizator }],
    stream: false, temperature: 0.2, max_tokens: c.maxTokens,
    response_format: { type: "json_object" },
  };
}

// POST /chat/completions cu corpul dat; comun chatului si corectorului.
export async function completeaza(cheie: string, baza: string, corp: Record<string, unknown>): Promise<RaspunsModel> {
  const r = await fetch(`${baza.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cheie}`, "content-type": "application/json" },
    body: JSON.stringify(corp),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = null; }
  if (!r.ok) {
    throw new EroareModel(r.status, d?.error?.message ?? `DeepSeek a răspuns ${r.status}.`, d?.error?.code != null ? String(d.error.code) : null);
  }
  const rasp = extrageRaspunsText(d);
  if (!rasp.text) throw new EroareModel(502, `Modelul nu a dat un răspuns (${d?.choices?.[0]?.finish_reason ?? "fără text"}).`);
  return rasp;
}
