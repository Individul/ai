// Claude la chat (22 oct. 2026): cererea, refuzurile, motorul si plafonul lunar.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BAZA_CLAUDE, BETA_FALLBACK, construiesteCerereChatClaude, EroareClaude, intreabaClaudeChat } from "./claude";
import { adaugaSursa, creeazaCatalog, seteazaFisierSursa, seteazaText } from "./db";
import { scrieText } from "./text";
import { PROMPT_SISTEM_CHAT, type CerereChat, type RaspunsModel } from "./deepseek";
import { raspunde } from "./motor";
import {
  alegeModelChat, cereriClaudeLuna, cheltuitClaudeLuna, creeazaCorectare, inregistreazaIntrebare, MODEL_REZERVA_IMPLICIT, seteazaSetare,
  stareClaudeLuna,
} from "./consum";
import { BUGET_CLAUDE_IMPLICIT, LIMITA_BUGET_MAX } from "./validare";

const CERERE: CerereChat = {
  model: "claude-sonnet-5-5",
  context: "=== Ordinul nr. 777 | pag. 2 ===\nPachetele se predau marți și joi.",
  istoric: [{ intrebare: "Prima?", raspuns: "Primul răspuns." }, { intrebare: "", raspuns: "fără întrebare" }],
  intrebare: "Când se predau pachetele?",
};

describe("construiesteCerereChatClaude", () => {
  it("pune promptul si documentele in system, istoricul ca mesaje, efortul si fallbacks, fara temperature", () => {
    expect(construiesteCerereChatClaude(CERERE)).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: `${PROMPT_SISTEM_CHAT}\n\nDOCUMENTE:\n${CERERE.context}`,
      messages: [
        { role: "user", content: "Prima?" },
        { role: "assistant", content: "Primul răspuns." },
        { role: "user", content: "Când se predau pachetele?" },
      ],
      fallbacks: "default",
      output_config: { effort: "medium" },
    });
  });
});

describe("intreabaClaudeChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("trimite antetul beta pentru fallbacks si intoarce textul cu tokenii", async () => {
    let antete = new Headers();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      antete = new Headers(init.headers);
      return new Response(JSON.stringify({
        content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Marți și joi [Ordinul nr. 777, pag. 2]." }],
        stop_reason: "end_turn", usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 40 },
      }));
    });
    const r = await intreabaClaudeChat("k", BAZA_CLAUDE, CERERE);
    expect(antete.get("anthropic-beta")).toBe(BETA_FALLBACK);
    expect(r).toEqual({ text: "Marți și joi [Ordinul nr. 777, pag. 2].", tokens_intrare: 1000, tokens_cache: 100, tokens_iesire: 40 });
  });

  it("un refuz fara text devine eroare pe intelesul omului", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ content: [], stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 0 } }))
    );
    const e = await intreabaClaudeChat("k", BAZA_CLAUDE, CERERE).catch((x) => x);
    expect(e).toBeInstanceOf(EroareClaude);
    expect(e.message).toContain("a refuzat");
  });
});

describe("raspunde pe Claude", () => {
  it("trimite contextul la Claude, leaga citarile si socoteste costul la tariful Sonnet 5.5", async () => {
    const catalog = await creeazaCatalog(env.DB, "c", { titlu: "C" });
    const ord = await adaugaSursa(env.DB, catalog.id, { tip: "ordin", numar: null, data_emiterii: null, url: null, titlu: "Ordinul nr. 777" });
    await seteazaFisierSursa(env.DB, ord.id, "x.pdf", 10);
    await scrieText(env.FISIERE, ord.id, [{ pagina: 1, text: "Ordinul nr. 777 privind pachetele." }, { pagina: 2, text: "Pachetele se predau marți și joi." }]);
    await seteazaText(env.DB, ord.id, { pagini: 2, caractere: 66 });
    const cereri: CerereChat[] = [];
    const nuDeepSeek = async (): Promise<RaspunsModel> => { throw new Error("DeepSeek nu trebuia chemat"); };
    const claude = async (cheie: string, baza: string, c: CerereChat): Promise<RaspunsModel> => {
      expect(cheie).toBe("a");
      expect(baza).toBe(BAZA_CLAUDE);
      cereri.push(c);
      return { text: "Marți și joi [Ordinul nr. 777, pag. 2].", tokens_intrare: 100_000, tokens_cache: 0, tokens_iesire: 2_000 };
    };
    const r = await raspunde({ DB: env.DB, FISIERE: env.FISIERE, ANTHROPIC_API_KEY: "a" },
      { model: "claude-sonnet-5-5", catalog, istoric: [], intrebare: "Când se predau pachetele?", buget: 10_000 }, nuDeepSeek, claude);
    expect(cereri[0]!.context).toContain("=== Ordinul nr. 777 | pag. 2 ===");
    expect(r.citari).toEqual([{ sursa_id: ord.id, titlu: "Ordinul nr. 777", pagina: 2 }]);
    // 100 k x 2 $ + 2 k x 10 $ per milion = 0,22 $
    expect(r.cost_microdolari).toBe(220_000);
  });

  it("fara cheia Anthropic raspunde 503", async () => {
    const catalog = await creeazaCatalog(env.DB, "c", { titlu: "C" });
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE }, {
      model: "claude-sonnet-5-5", catalog, istoric: [], intrebare: "?", buget: 1000,
    })).rejects.toMatchObject({ status: 503, message: "Cheia Claude nu este configurată pe server." });
  });

  it("Opus 5.5 ramane doar la corector", async () => {
    const catalog = await creeazaCatalog(env.DB, "c", { titlu: "C" });
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE, ANTHROPIC_API_KEY: "a" }, {
      model: "claude-opus-5-5", catalog, istoric: [], intrebare: "?", buget: 1000,
    })).rejects.toMatchObject({ status: 409 });
  });
});

describe("plafonul lunar Claude", () => {
  async function intrebareCu(model: string, zi: string, cost: number) {
    const c = await creeazaCatalog(env.DB, `c-${crypto.randomUUID().slice(0, 8)}`, { titlu: "C" });
    await inregistreazaIntrebare(env.DB, {
      email: "a@exemplu.md", catalog_id: c.id, zi, intrebare: "?", raspuns: "!", citari: [], model,
      tokens_intrare: 1, tokens_iesire: 1, cost_microdolari: cost, stare: "ok", durata_ms: 1,
    });
  }

  it("aduna Claude din chat si din corector, doar in luna data", async () => {
    await intrebareCu("claude-sonnet-5-5", "2026-10-03", 300_000);
    await intrebareCu("claude-sonnet-5-5", "2026-09-30", 900_000);   // alta luna
    await intrebareCu("deepseek-flash", "2026-10-03", 500_000);      // alt motor
    const cor = await creeazaCorectare(env.DB, { email: "a@exemplu.md", zi: "2026-10-05", fisier: "x.docx", mod: "corectura", caractere: 10, model: "claude-opus-5-5" });
    await env.DB.prepare("UPDATE corectari SET cost_microdolari = ? WHERE id = ?").bind(200_000, cor.id).run();
    expect(await cheltuitClaudeLuna(env.DB, "2026-10")).toBe(500_000);
  });

  it("sub plafon alege Claude cu bugetul lui; peste plafon, modelul de rezerva cu bugetul obisnuit", async () => {
    await seteazaSetare(env.DB, "model", "claude-sonnet-5-5");
    await seteazaSetare(env.DB, "plafon_claude", "1");
    expect(await alegeModelChat(env.DB, "2026-10")).toEqual({ model: "claude-sonnet-5-5", rezerva: false, buget: BUGET_CLAUDE_IMPLICIT });
    await intrebareCu("claude-sonnet-5-5", "2026-10-03", 1_000_000);
    expect(await alegeModelChat(env.DB, "2026-10")).toEqual({ model: MODEL_REZERVA_IMPLICIT, rezerva: true, buget: LIMITA_BUGET_MAX });
    // luna urmatoare, Claude revine
    expect((await alegeModelChat(env.DB, "2026-11")).model).toBe("claude-sonnet-5-5");
  });

  it("plafonul 0 opreste Claude, iar un model de rezerva Claude nu e acceptat", async () => {
    await seteazaSetare(env.DB, "model", "claude-sonnet-5-5");
    await seteazaSetare(env.DB, "plafon_claude", "0");
    await seteazaSetare(env.DB, "model_rezerva", "claude-sonnet-5-5");
    expect(await alegeModelChat(env.DB, "2026-10")).toMatchObject({ model: MODEL_REZERVA_IMPLICIT, rezerva: true });
    await seteazaSetare(env.DB, "model_rezerva", "glm-5.3-flash");   // scos din aplicatie
    expect((await alegeModelChat(env.DB, "2026-10")).model).toBe(MODEL_REZERVA_IMPLICIT);
  });

  it("stareClaudeLuna arata cat a ramas din plafon, fara sa coboare sub zero", async () => {
    await seteazaSetare(env.DB, "plafon_claude", "65");
    await intrebareCu("claude-sonnet-5-5", "2026-10-03", 111_402);
    expect(await stareClaudeLuna(env.DB, "2026-10")).toEqual({ cheltuit: 111_402, plafon: 65_000_000, ramas: 64_888_598 });
    await seteazaSetare(env.DB, "plafon_claude", "0");
    expect((await stareClaudeLuna(env.DB, "2026-10")).ramas).toBe(0);
  });

  it("cereriClaudeLuna aduce intrebarile si corectarile Claude ale lunii, cele mai noi primele", async () => {
    await intrebareCu("claude-sonnet-5-5", "2026-10-03", 100);
    await intrebareCu("deepseek-flash", "2026-10-03", 200);
    await intrebareCu("claude-sonnet-5-5", "2026-09-30", 300);
    await creeazaCorectare(env.DB, { email: "b@exemplu.md", zi: "2026-10-05", fisier: "x.docx", mod: "corectura", caractere: 10, model: "claude-opus-5-5" });
    const r = await cereriClaudeLuna(env.DB, "2026-10");
    expect(r.map((c) => [c.fel, c.model])).toEqual([["corectura", "claude-opus-5-5"], ["intrebare", "claude-sonnet-5-5"]]);
    expect(r[1]).toMatchObject({ email: "a@exemplu.md", cost_microdolari: 100, stare: "ok" });
  });

  it("alt model decat Claude nu e atins de plafon", async () => {
    await seteazaSetare(env.DB, "model", "deepseek-flash");
    await seteazaSetare(env.DB, "plafon_claude", "0");
    expect(await alegeModelChat(env.DB, "2026-10")).toEqual({ model: "deepseek-flash", rezerva: false, buget: LIMITA_BUGET_MAX });
  });
});
