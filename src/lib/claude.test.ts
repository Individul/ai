import { afterEach, describe, expect, it, vi } from "vitest";
import { BAZA_CLAUDE, construiesteCerereClaude, EroareClaude, extrageRaspunsClaude, intreabaClaude } from "./claude";
import { cerereCorectura, SCHEMA_CORECTURI } from "./corector";
import { MODELE, MODELE_CHAT, TARIFE } from "./validare";

const LOT = [{ i: 2, text: "Deţinutii au fost informati." }];

describe("construiesteCerereClaude", () => {
  it("pe Sonnet 5 impune schema corecturilor si regleaza gandirea prin effort, fara temperature", () => {
    const c = construiesteCerereClaude(cerereCorectura("claude-sonnet-5", LOT));
    expect(c).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 32_768,
      messages: [{ role: "user", content: JSON.stringify({ paragrafe: LOT }) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA_CORECTURI }, effort: "medium" },
    });
    expect(typeof c.system).toBe("string");
    expect(c).not.toHaveProperty("temperature");
    expect(c).not.toHaveProperty("thinking");
  });

  it("pe Haiku 4.5 nu trimite effort (nu il accepta)", () => {
    const c = construiesteCerereClaude(cerereCorectura("claude-haiku-4-5-20251001", LOT));
    expect(c.output_config).toEqual({ format: { type: "json_schema", schema: SCHEMA_CORECTURI } });
  });

  it("schema respecta limitele Anthropic: additionalProperties false la fiecare obiect", () => {
    const obiecte: Record<string, unknown>[] = [];
    const cauta = (x: unknown) => {
      if (!x || typeof x !== "object") return;
      const o = x as Record<string, unknown>;
      if (o.type === "object") obiecte.push(o);
      Object.values(o).forEach(cauta);
    };
    cauta(SCHEMA_CORECTURI);
    expect(obiecte.length).toBe(2);
    expect(obiecte.every((o) => o.additionalProperties === false)).toBe(true);
    expect(JSON.stringify(SCHEMA_CORECTURI)).not.toMatch(/minLength|maxLength|minimum/);
  });
});

describe("extrageRaspunsClaude", () => {
  it("ia textul fara blocurile de gandire si aduna tokenii de intrare cu cache", () => {
    const r = extrageRaspunsClaude({
      content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: '{"corecturi":' }, { type: "text", text: "[]}" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 300 },
    });
    expect(r).toEqual({ text: '{"corecturi":[]}', tokens_intrare: 160, tokens_cache: 50, tokens_iesire: 300, oprire: "end_turn" });
  });
});

describe("intreabaClaude", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("trimite antetele Anthropic si arunca EroareClaude cu mesajul API-ului", async () => {
    const cereri: { url: string; antete: Headers }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      cereri.push({ url, antete: new Headers(init.headers) });
      return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 });
    });
    const e = await intreabaClaude("k", BAZA_CLAUDE, { model: "claude-sonnet-5" }).catch((x) => x);
    expect(e).toBeInstanceOf(EroareClaude);
    expect(e).toMatchObject({ status: 401, message: "invalid x-api-key" });
    expect(cereri[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(cereri[0]!.antete.get("x-api-key")).toBe("k");
    expect(cereri[0]!.antete.get("anthropic-version")).toBe("2023-06-01");
  });

  it("un raspuns taiat ajunge la apelant cu starea lui, fara exceptie", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: '{"corecturi":[{"i":2' }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 2 } }))
    );
    expect(await intreabaClaude("k", BAZA_CLAUDE, {})).toMatchObject({ oprire: "max_tokens", tokens_iesire: 2 });
  });
});

describe("modelele Claude", () => {
  it("sunt la corector, nu si la chat", () => {
    const claude = MODELE.filter((m) => TARIFE[m]!.motor === "claude");
    expect(claude).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"]);
    expect(MODELE_CHAT.some((m) => TARIFE[m]!.motor === "claude")).toBe(false);
    expect(MODELE_CHAT).toContain("deepseek-flash");
  });
});
