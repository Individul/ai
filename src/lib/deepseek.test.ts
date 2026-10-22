import { describe, expect, it } from "vitest";
import { BAZA_DEEPSEEK, construiesteCerereChat, construiesteCerereText, EroareModel, extrageRaspunsText, PROMPT_SISTEM_CHAT } from "./deepseek";
import { costMicrodolari } from "./validare";

// Forma raspunsului OpenAI-compatibil (verificata pe viu in sept. 2026), cu gandire, ca sa vedem ca o ignoram.
const RASPUNS = {
  choices: [{ finish_reason: "stop", index: 0, message: { content: "Capitala Republicii Moldova este **Chișinău**.", reasoning_content: "gandesc...", role: "assistant" } }],
  model: "deepseek-flash", object: "chat.completion",
  usage: { completion_tokens: 16, prompt_tokens: 33, prompt_tokens_details: { cached_tokens: 10 }, total_tokens: 49 },
};

describe("construiesteCerereChat", () => {
  it("pune regulile si documentele in system, ultimele 8 schimburi, apoi intrebarea; gandirea ramane pornita", () => {
    const istoric = Array.from({ length: 10 }, (_, i) => ({ intrebare: `i${i}`, raspuns: `r${i}` }));
    const c = construiesteCerereChat({ model: "deepseek-flash", context: "=== A | pag. 1 ===\ntext", istoric, intrebare: "ultima" }) as any;
    expect(c.model).toBe("deepseek-flash");
    expect(c.messages).toHaveLength(18);
    expect(c.messages[0].role).toBe("system");
    expect(c.messages[0].content.startsWith(PROMPT_SISTEM_CHAT)).toBe(true);
    expect(c.messages[0].content).toContain("=== A | pag. 1 ===\ntext");
    expect(c.messages[1]).toEqual({ role: "user", content: "i2" });
    expect(c.messages[2]).toEqual({ role: "assistant", content: "r2" });
    expect(c.messages[17]).toEqual({ role: "user", content: "ultima" });
    // pe 4.1, parametrul `thinking` opreste rationamentul in mai multi pasi; tokenii de gandire intra in max_tokens
    expect(c).not.toHaveProperty("thinking");
    expect(c.max_tokens).toBe(8192);
    expect(c.stream).toBe(false);
    expect(c.temperature).toBe(0.2);
  });

  it("ignora schimburile incomplete si trunchiaza textele lungi", () => {
    const istoric = [{ intrebare: "x", raspuns: "" }, { intrebare: "y".repeat(3000), raspuns: "z".repeat(5000) }];
    const c = construiesteCerereChat({ model: "m", context: "", istoric, intrebare: "q" }) as any;
    expect(c.messages).toHaveLength(4);
    expect(c.messages[1].content).toHaveLength(2000);
    expect(c.messages[2].content).toHaveLength(4000);
  });
});

describe("extrageRaspunsText", () => {
  it("ia textul si tokenii (intrare totala, din cache, iesire); ignora gandirea", () => {
    expect(extrageRaspunsText(RASPUNS)).toEqual({
      text: "Capitala Republicii Moldova este **Chișinău**.", tokens_intrare: 33, tokens_cache: 10, tokens_iesire: 16,
    });
  });

  it("citeste tokenii din cache din prompt_cache_hit_tokens (forma DeepSeek)", () => {
    const d = { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100, completion_tokens: 20 } };
    expect(extrageRaspunsText(d)).toEqual({ text: "ok", tokens_intrare: 1000, tokens_cache: 900, tokens_iesire: 20 });
  });

  it("fara continut intoarce text gol si tokeni 0", () => {
    expect(extrageRaspunsText({})).toEqual({ text: "", tokens_intrare: 0, tokens_cache: 0, tokens_iesire: 0 });
  });
});

describe("EroareModel", () => {
  it("recunoaste contextul prea lung dupa mesaj", () => {
    expect(new EroareModel(400, "This model's maximum context length is 1048576 tokens. However, you requested 1200000 tokens").contextPreaLung).toBe(true);
    expect(new EroareModel(400, "prompt exceeds max length").contextPreaLung).toBe(true);
    expect(new EroareModel(400, "Invalid request").contextPreaLung).toBe(false);
  });

  it("are baza DeepSeek", () => {
    expect(BAZA_DEEPSEEK).toBe("https://api.deepseek.com");
  });
});

describe("costMicrodolari", () => {
  const LIBER = new Date("2026-09-10T12:00:00Z");   // joi, in afara orelor de varf
  const VARF = new Date("2026-09-10T08:00:00Z");    // joi, ora de varf DeepSeek

  it("tokenii din cache se platesc la pretul de cache; la orele de varf DeepSeek costa dublu", () => {
    expect(costMicrodolari("deepseek-flash", 676_000, 600, 676_000, LIBER)).toBe(2_388);
    expect(costMicrodolari("deepseek-flash", 676_000, 600, 0, LIBER)).toBe(101_760);
    expect(costMicrodolari("deepseek-flash", 676_000, 600, 0, VARF)).toBe(203_520);
  });

  it("Claude Sonnet 5.5: 100 k intrare si 2 k iesire = 0,22 $; modelele scoase costa 0", () => {
    expect(costMicrodolari("claude-sonnet-5-5", 100_000, 2_000, 0, VARF)).toBe(220_000);
    expect(costMicrodolari("gemini-3.5-flash-lite", 7000, 600)).toBe(0);
  });
});

describe("construiesteCerereText (corectorul)", () => {
  it("cere JSON, fara parametrul de gandire", () => {
    const c = construiesteCerereText({ sistem: "S", utilizator: "U", maxTokens: 100, model: "deepseek-flash" });
    expect(c).toMatchObject({
      model: "deepseek-flash", max_tokens: 100, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }],
    });
    expect(c).not.toHaveProperty("thinking");
  });
});
