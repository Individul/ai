// Z.AI (GLM) prin REST, fara SDK. Singurul fisier care vorbeste cu Z.AI.
//
// Endpointul planului de coding (api.z.ai/api/coding/paas/v4) e OpenAI-compatibil. Dumitru si-a
// asumat riscul: documentatia Z.AI limiteaza planul la unelte suportate oficial; din aplicatii
// proprii cererile pot primi "Insufficient Balance" sau pot fi taxate din portofel.
//
// Verificat pe viu la 8 sept. 2026, pe glm-5.3-flash si glm-5.3, din planul de coding:
// - `thinking: {type: "disabled"}` e acceptat (docs spun ca 5.3 nu se poate opri; in practica
//   reasoning_tokens = 0); nu folosim reasoning_effort.
// - usage: prompt_tokens (total, include cache), prompt_tokens_details.cached_tokens,
//   completion_tokens, completion_tokens_details.reasoning_tokens.
// - Context prea lung: HTTP 400 {"error":{"code":"1261","message":"Prompt exceeds max length"}}
//   (dupa ~10 s, la 8 M caractere). Contextul maxim e 1 M tokeni.
// - Raspunsul la 1 M tokeni poate dura minute; nu punem timeout mai mic de 10 minute.

import { TARIFE } from "./validare";
import type { Schimb } from "./gemini";

export const BAZA_ZAI = "https://api.z.ai/api/coding/paas/v4";

export const PROMPT_SISTEM_ZAI = `Ești asistentul unui catalog de acte normative din sistemul penitenciar al Republicii Moldova.
Răspunzi în limba română, doar pe baza documentelor de mai jos. Fiecare pagină începe cu un antet „=== Titlu | pag. N ===”.
După fiecare afirmație citează sursa exact în forma [Titlu, pag. N], cu titlul din antet și numărul paginii, fără altceva în paranteză; articolul, punctul sau alineatul le menționezi în text, înaintea parantezei.
Dacă informația nu se găsește în documente, spune clar „Nu am găsit această informație în documentele catalogului” și nu inventa.
Fii concis și precis; nu da interpretări juridice proprii și nu speculezi dincolo de text.`;

export interface CerereZai {
  model: string;
  context: string;      // paginile cu antete, din construiesteContext
  istoric: Schimb[];
  intrebare: string;
}

export interface RaspunsZai {
  text: string;
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
}

export class EroareZai extends Error {
  status: number;
  cod: string | null;
  contextPreaLung: boolean;
  constructor(status: number, mesaj: string, cod: string | null = null) {
    super(mesaj);
    this.status = status;
    this.cod = cod;
    this.contextPreaLung = cod === "1261" || /exceeds max length/i.test(mesaj);
  }
}

// Documentele stau in system, inaintea istoricului: prefixul ramane identic intre intrebari,
// deci cache-ul de context al Z.AI il poate refolosi. Istoricul: ultimele 8 schimburi, trunchiate.
export function construiesteCerereZai(c: CerereZai): Record<string, unknown> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: `${PROMPT_SISTEM_ZAI}\n\nDOCUMENTE:\n${c.context}` },
  ];
  for (const s of c.istoric.slice(-8)) {
    if (!s.intrebare || !s.raspuns) continue;
    messages.push({ role: "user", content: s.intrebare.slice(0, 2000) });
    messages.push({ role: "assistant", content: s.raspuns.slice(0, 4000) });
  }
  messages.push({ role: "user", content: c.intrebare });
  return { model: c.model, messages, stream: false, temperature: 0.2, max_tokens: 4096, thinking: { type: "disabled" } };
}

export function extrageRaspunsZai(d: any): RaspunsZai {
  const continut = d?.choices?.[0]?.message?.content;
  const u = d?.usage ?? {};
  return {
    text: typeof continut === "string" ? continut.trim() : "",
    tokens_intrare: Number(u.prompt_tokens ?? 0),
    tokens_cache: Number(u.prompt_tokens_details?.cached_tokens ?? 0),
    tokens_iesire: Number(u.completion_tokens ?? 0),
  };
}

export async function intreabaZai(cheie: string, baza: string, c: CerereZai): Promise<RaspunsZai> {
  const r = await fetch(`${baza.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cheie}`, "content-type": "application/json" },
    body: JSON.stringify(construiesteCerereZai(c)),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = null; }
  if (!r.ok) {
    throw new EroareZai(r.status, d?.error?.message ?? `Z.AI a răspuns ${r.status}.`, d?.error?.code != null ? String(d.error.code) : null);
  }
  const rasp = extrageRaspunsZai(d);
  if (!rasp.text) throw new EroareZai(502, `Modelul nu a dat un răspuns (${d?.choices?.[0]?.finish_reason ?? "fără text"}).`);
  return rasp;
}

// Creditele planului de coding: (intrare fara cache x i + cache x c + iesire x o) / 10.000,
// cu multiplicatorii modelului din TARIFE. 0 pentru modelele fara credite (Gemini).
export function crediteZai(model: string, tokensIntrare: number, tokensCache: number, tokensIesire: number): number {
  const m = TARIFE[model]?.credite;
  if (!m) return 0;
  const cache = Math.min(tokensCache, tokensIntrare);
  const brut = ((tokensIntrare - cache) * m.intrare + cache * m.cache + tokensIesire * m.iesire) / 10_000;
  return Math.round(brut * 100) / 100;
}
