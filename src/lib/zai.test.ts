import { describe, expect, it } from "vitest";
import { BAZA_DEEPSEEK, construiesteCerereZai, crediteZai, EroareZai, extrageCota, extrageRaspunsZai, PROMPT_SISTEM_ZAI } from "./zai";
import { costMicrodolari } from "./gemini";

// Raspuns real de la api.z.ai/api/coding/paas/v4 (8 sept. 2026), cu gandire adaugata ca sa vedem ca o ignoram.
const RASPUNS = {
  choices: [{ finish_reason: "stop", index: 0, message: { content: "Capitala Republicii Moldova este **Chișinău**.", reasoning_content: "gandesc...", role: "assistant" } }],
  created: 1788887267, id: "20260909010738b217fa6cf8fa4c5d", model: "glm-5.3-flash", object: "chat.completion",
  usage: { completion_tokens: 16, completion_tokens_details: { reasoning_tokens: 0 }, prompt_tokens: 33, prompt_tokens_details: { cached_tokens: 10 }, total_tokens: 49 },
};

describe("construiesteCerereZai", () => {
  it("pune regulile si documentele in system, ultimele 8 schimburi, apoi intrebarea; gandirea oprita", () => {
    const istoric = Array.from({ length: 10 }, (_, i) => ({ intrebare: `i${i}`, raspuns: `r${i}` }));
    const c = construiesteCerereZai({ model: "glm-5.3-flash", context: "=== A | pag. 1 ===\ntext", istoric, intrebare: "ultima" }) as any;
    expect(c.model).toBe("glm-5.3-flash");
    expect(c.messages).toHaveLength(18);
    expect(c.messages[0].role).toBe("system");
    expect(c.messages[0].content.startsWith(PROMPT_SISTEM_ZAI)).toBe(true);
    expect(c.messages[0].content).toContain("=== A | pag. 1 ===\ntext");
    expect(c.messages[1]).toEqual({ role: "user", content: "i2" });
    expect(c.messages[2]).toEqual({ role: "assistant", content: "r2" });
    expect(c.messages[17]).toEqual({ role: "user", content: "ultima" });
    expect(c.thinking).toEqual({ type: "disabled" });
    expect(c.stream).toBe(false);
    expect(c.temperature).toBe(0.2);
  });

  it("ignora schimburile incomplete si trunchiaza textele lungi", () => {
    const istoric = [{ intrebare: "x", raspuns: "" }, { intrebare: "y".repeat(3000), raspuns: "z".repeat(5000) }];
    const c = construiesteCerereZai({ model: "m", context: "", istoric, intrebare: "q" }) as any;
    expect(c.messages).toHaveLength(4);
    expect(c.messages[1].content).toHaveLength(2000);
    expect(c.messages[2].content).toHaveLength(4000);
  });
});

describe("extrageRaspunsZai", () => {
  it("ia textul si tokenii (intrare totala, din cache, iesire); ignora gandirea", () => {
    expect(extrageRaspunsZai(RASPUNS)).toEqual({
      text: "Capitala Republicii Moldova este **Chișinău**.", tokens_intrare: 33, tokens_cache: 10, tokens_iesire: 16,
    });
  });

  it("fara continut intoarce text gol si tokeni 0", () => {
    expect(extrageRaspunsZai({})).toEqual({ text: "", tokens_intrare: 0, tokens_cache: 0, tokens_iesire: 0 });
  });
});

describe("crediteZai", () => {
  it("aplica formula planului de coding; tokenii din cache sunt o parte din cei de intrare", () => {
    expect(crediteZai("glm-5.3-flash", 1_000_000, 0, 1_000)).toBe(230.8);
    expect(crediteZai("glm-5.3-flash", 100_000, 90_000, 500)).toBe(7.74);
    expect(crediteZai("glm-5.3", 10_000, 0, 100)).toBe(7.14);
    expect(crediteZai("gemini-3.5-flash-lite", 1000, 0, 10)).toBe(0);
  });

  it("costul orientativ in $ foloseste tariful public al modelului", () => {
    expect(costMicrodolari("glm-5.3-flash", 100_000, 1_000)).toBe(15_500);
  });
});

describe("EroareZai", () => {
  it("recunoaste contextul prea lung dupa codul 1261 sau mesaj", () => {
    expect(new EroareZai(400, "Prompt exceeds max length", "1261").contextPreaLung).toBe(true);
    expect(new EroareZai(400, "prompt exceeds max length").contextPreaLung).toBe(true);
    expect(new EroareZai(401, "Unauthorized", "1000").contextPreaLung).toBe(false);
  });
});

describe("extrageCota", () => {
  // Raspuns real de la api.z.ai/api/monitor/usage/quota/limit (8 sept. 2026), planul Lite.
  const COTA = {
    code: 200, msg: "Operation successful", success: true,
    data: {
      level: "lite",
      limits: [
        { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 401, remaining: 1598, percentage: 20, nextResetTime: 1788895064523 },
        { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 5174, remaining: 4825, percentage: 51, nextResetTime: 1789194217977 },
      ],
    },
  };

  it("citeste nivelul si ferestrele de 5 ore si o saptamana, cu procent si momentul resetarii", () => {
    expect(extrageCota(COTA)).toEqual({
      nivel: "lite",
      ferestre: [
        { eticheta: "5 h", folosit: 401, total: 2000, procent: 20, reset: "2026-09-08T19:17:44.523Z" },
        { eticheta: "săpt.", folosit: 5174, total: 10000, procent: 51, reset: "2026-09-12T06:23:37.977Z" },
      ],
    });
  });

  it("fara date intoarce null; sare peste limitele care nu sunt credite", () => {
    expect(extrageCota({ code: 401 })).toBeNull();
    expect(extrageCota({ data: { level: "pro", limits: [{ type: "TOOL_LIMIT", unit: 4, number: 1, usage: 1000, currentValue: 5, percentage: 1, nextResetTime: 0 }] } })).toBeNull();
  });
});

describe("costMicrodolari cu cache", () => {
  it("tokenii din cache se platesc la pretul de cache al modelului; fara pret de cache, la pret intreg", () => {
    expect(costMicrodolari("deepseek-v4-flash", 676_000, 600, 676_000)).toBe(2061);
    expect(costMicrodolari("deepseek-v4-flash", 676_000, 600)).toBe(94_808);
    expect(costMicrodolari("glm-5.3-flash", 100_000, 500, 90_000)).toBe(4_450);
    expect(costMicrodolari("gemini-3.5-flash-lite", 7000, 600, 7000)).toBe(3600);
  });
});

describe("clientul OpenAI-compatibil si DeepSeek", () => {
  it("citeste tokenii din cache din prompt_cache_hit_tokens (DeepSeek) sau din prompt_tokens_details (Z.AI)", () => {
    const deepseek = { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100, completion_tokens: 20 } };
    expect(extrageRaspunsZai(deepseek)).toEqual({ text: "ok", tokens_intrare: 1000, tokens_cache: 900, tokens_iesire: 20 });
  });

  it("recunoaste contextul prea lung si in formularea OpenAI", () => {
    expect(new EroareZai(400, "This model's maximum context length is 1048576 tokens. However, you requested 1200000 tokens").contextPreaLung).toBe(true);
    expect(new EroareZai(400, "Invalid request").contextPreaLung).toBe(false);
  });

  it("are baza DeepSeek", () => {
    expect(BAZA_DEEPSEEK).toBe("https://api.deepseek.com");
  });
});

describe("gandirea, per motor", () => {
  const cerere = (model: string) => construiesteCerereZai({ model, context: "doc", istoric: [], intrebare: "q" }) as any;

  it("Z.AI primeste gandirea oprita (la GLM e fara efect si ieșirea costa 8x in credite)", () => {
    expect(cerere("glm-5.3-flash").thinking).toEqual({ type: "disabled" });
    expect(cerere("glm-5.3-flash").max_tokens).toBe(4096);
  });

  it("DeepSeek nu primeste parametrul: pe 4.1 el opreste rationamentul in mai multi pasi", () => {
    expect(cerere("deepseek-flash")).not.toHaveProperty("thinking");
    // tokenii de gandire intra in max_tokens, deci plafonul e mai mare
    expect(cerere("deepseek-flash").max_tokens).toBe(8192);
  });
});
