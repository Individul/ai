// Claude (Anthropic) prin REST, fara SDK. Singurul fisier care vorbeste cu Anthropic. Folosit doar de
// corector: pe chat, contextul culegerilor (~740 k tokeni) ar costa cativa dolari pe intrebare.
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
import type { RaspunsZai } from "./zai";

export const BAZA_CLAUDE = "https://api.anthropic.com";
export const VERSIUNE_API_CLAUDE = "2023-06-01";

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

export interface RaspunsClaude extends RaspunsZai {
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
    headers: { "x-api-key": cheie, "anthropic-version": VERSIUNE_API_CLAUDE, "content-type": "application/json" },
    body: JSON.stringify(corp),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = null; }
  if (!r.ok) throw new EroareClaude(r.status, d?.error?.message ?? `Anthropic a răspuns ${r.status}.`);
  return extrageRaspunsClaude(d);
}
