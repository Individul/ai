import { describe, expect, it } from "vitest";
import { construiesteCerereZai, crediteZai, EroareZai, extrageRaspunsZai, PROMPT_SISTEM_ZAI } from "./zai";
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
