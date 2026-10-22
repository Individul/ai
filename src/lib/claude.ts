// Claude (Anthropic) prin REST, fara SDK. Singurul fisier care vorbeste cu Anthropic. Folosit de corector si,
// din 22 oct. 2026, de chat (doar Sonnet 5.5): acolo nu trimitem toata culegerea (~740 k tokeni ar costa
// ~1,50 $ pe intrebare), ci paginile filtrate din `buget_context_claude`, cu plafon lunar in $ (motor.ts, consum.ts).
//
// Din documentatia oficiala (platform.claude.com, citita la 15 sept. 2026):
// - POST https://api.anthropic.com/v1/messages, cu antetele x-api-key si anthropic-version: 2023-06-01.
// - Raspunsul JSON impus: output_config.format = {type: "json_schema", schema}; JSON-ul vine intr-un
//   bloc "text" din content, dupa eventualele blocuri "thinking". Schema cere additionalProperties:
//   false la fiecare obiect si nu accepta minLength / maxLength.
// - Gandirea: pe Opus 5 si Sonnet 5 e adaptiva si pornita implicit; adancimea se regleaza cu
//   output_config.effort (low | medium | high, implicit high). Haiku 4.5 nu are gandire adaptiva si nici
//   effort: acolo nu trimitem nimic, deci raspunde fara gandire.
// - usage: input_tokens (fara cache), cache_read_input_tokens, cache_creation_input_tokens, output_tokens
//   (include gandirea). stop_reason: end_turn | max_tokens | refusal.
// - Tokenizerul modelelor de la 4.7 in sus face ~30% mai multi tokeni pentru acelasi text.

import type { CerereText } from "./corector";
import { TARIFE } from "./validare";
import { PROMPT_SISTEM_CHAT, type CerereChat, type RaspunsModel } from "./deepseek";

export const BAZA_CLAUDE = "https://api.anthropic.com";
export const VERSIUNE_API_CLAUDE = "2023-06-01";
// Refuzurile clasificatoarelor de siguranta: cu `fallbacks: "default"` Anthropic reia cererea refuzata pe
// modelul recomandat pentru categoria refuzului, in aceeasi cerere (raspunsul poate avea blocuri "fallback",
// pe care le ignoram, si `model` alt decat cel cerut). Forma "default" cere exact acest antet beta.
export const BETA_FALLBACK = "server-side-fallback-2026-07-01";

export class EroareClaude extends Error {
  status: number;
  constructor(status: number, mesaj: string) {
    super(mesaj);
    this.status = status;
  }
}

// Fara temperature: pe modelele cu gandire adaptiva adancimea se regleaza prin effort.
export function construiesteCerereClaude(c: CerereText): Record<string, unknown> {
  const output_config: Record<string, unknown> = {};
  if (c.schema) output_config.format = { type: "json_schema", schema: c.schema };
  const efort = TARIFE[c.model]?.efort;
  if (efort) output_config.effort = efort;
  const cerere: Record<string, unknown> = {
    model: c.model,
    max_tokens: c.maxTokens,
    system: c.sistem,
    messages: [{ role: "user", content: c.utilizator }],
  };
  if (Object.keys(output_config).length) cerere.output_config = output_config;
  return cerere;
}

// Chatul: acelasi prompt si aceleasi citari [Titlu, pag. N] ca la DeepSeek, deci extrageCitariText
// leaga trimiterile la fel. Documentele stau in system; istoricul (ultimele 8 schimburi) e text simplu.
// Gandirea e adaptiva (Sonnet 5.5 nu o poate opri), cu efortul din TARIFE; ea intra in max_tokens.
export function construiesteCerereChatClaude(c: CerereChat): Record<string, unknown> {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const s of c.istoric.slice(-8)) {
    if (!s.intrebare || !s.raspuns) continue;
    messages.push({ role: "user", content: s.intrebare.slice(0, 2000) });
    messages.push({ role: "assistant", content: s.raspuns.slice(0, 4000) });
  }
  messages.push({ role: "user", content: c.intrebare });
  const cerere: Record<string, unknown> = {
    model: c.model,
    max_tokens: 16_000,
    system: `${PROMPT_SISTEM_CHAT}

DOCUMENTE:
${c.context}`,
    messages,
    fallbacks: "default",
  };
  const efort = TARIFE[c.model]?.efort;
  if (efort) cerere.output_config = { effort: efort };
  return cerere;
}

export interface RaspunsClaude extends RaspunsModel {
  oprire: string; // stop_reason
}

export function extrageRaspunsClaude(d: any): RaspunsClaude {
  const blocuri: any[] = Array.isArray(d?.content) ? d.content : [];
  const text = blocuri.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("").trim();
  const u = d?.usage ?? {};
  const cache = Number(u.cache_read_input_tokens ?? 0);
  return {
    text,
    tokens_intrare: Number(u.input_tokens ?? 0) + cache + Number(u.cache_creation_input_tokens ?? 0),
    tokens_cache: cache,
    tokens_iesire: Number(u.output_tokens ?? 0),
    oprire: String(d?.stop_reason ?? ""),
  };
}

// Arunca doar la erorile HTTP. Un raspuns taiat (max_tokens) sau un refuz ajung la apelant cu textul
// lor: corecteazaLot nu il poate citi si arunca EroareCorectare cu consumul, ca sa intre in jurnal.
export async function intreabaClaude(cheie: string, baza: string, corp: Record<string, unknown>): Promise<RaspunsClaude> {
  const r = await fetch(`${baza.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": cheie, "anthropic-version": VERSIUNE_API_CLAUDE, "content-type": "application/json",
      ...(corp.fallbacks ? { "anthropic-beta": BETA_FALLBACK } : {}),
    },
    body: JSON.stringify(corp),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = null; }
  if (!r.ok) throw new EroareClaude(r.status, d?.error?.message ?? `Anthropic a răspuns ${r.status}.`);
  return extrageRaspunsClaude(d);
}

// Chatul: un raspuns fara text (refuz, sau taiat la max_tokens inainte de text) e o eroare pentru om.
export async function intreabaClaudeChat(cheie: string, baza: string, c: CerereChat): Promise<RaspunsModel> {
  const r = await intreabaClaude(cheie, baza, construiesteCerereChatClaude(c));
  if (!r.text) {
    throw new EroareClaude(502, r.oprire === "refusal"
      ? "Claude a refuzat să răspundă la această întrebare."
      : `Claude nu a dat un răspuns (${r.oprire || "fără text"}).`);
  }
  return { text: r.text, tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire };
}
