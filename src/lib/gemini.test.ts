import { describe, expect, it } from "vitest";
import { construiesteCerere, costMicrodolari, extrageRaspuns, interpreteazaOperatie, PROMPT_SISTEM } from "./gemini";

// Raspuns real generateContent (8 sept. 2026), scurtat.
const RASPUNS = {
  candidates: [{
    content: {
      parts: [
        { text: "Conform Ordinului nr. 777, pachetele se predau doar în zilele de marți și joi.", thoughtSignature: "x" },
      ],
      role: "model",
    },
    finishReason: "STOP",
    groundingMetadata: {
      groundingChunks: [
        { retrievedContext: { title: "fiamwrxdcn81", text: "…", fileSearchStore: "fileSearchStores/p", customMetadata: [{ key: "sursa", stringValue: "s-777" }, { key: "titlu", stringValue: "Ordinul 777" }], pageNumber: 2 } },
        { retrievedContext: { title: "fiamwrxdcn81", text: "…", fileSearchStore: "fileSearchStores/p", customMetadata: [{ key: "sursa", stringValue: "s-777" }, { key: "titlu", stringValue: "Ordinul 777" }], pageNumber: 2 } },
        { retrievedContext: { title: "bk1qpdipwqxp", text: "…", fileSearchStore: "fileSearchStores/p", customMetadata: [{ key: "sursa", stringValue: "s-proba" }, { key: "titlu", stringValue: "Ordinul 123" }] } },
        { retrievedContext: { title: "fara-meta", text: "…", fileSearchStore: "fileSearchStores/p" } },
      ],
      groundingSupports: [
        { segment: { startIndex: 0, endIndex: 10, text: "…" }, groundingChunkIndices: [0, 1] },
        { segment: { startIndex: 10, endIndex: 20, text: "…" }, groundingChunkIndices: [3] },
      ],
    },
  }],
  usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 99, totalTokenCount: 6190, toolUsePromptTokenCount: 6073 },
};

describe("extrageRaspuns", () => {
  it("ia textul, citarile folosite (unice pe sursa+pagina) si tokenii", () => {
    const r = extrageRaspuns(RASPUNS);
    expect(r.text).toBe("Conform Ordinului nr. 777, pachetele se predau doar în zilele de marți și joi.");
    expect(r.citari).toEqual([
      { sursa_id: "s-777", titlu: "Ordinul 777", pagina: 2 },
      { sursa_id: null, titlu: "fara-meta", pagina: null },
    ]);
    expect(r.tokens_intrare).toBe(6091);
    expect(r.tokens_iesire).toBe(99);
  });

  it("fara groundingSupports foloseste toate fragmentele; fara candidat intoarce gol", () => {
    const fara = JSON.parse(JSON.stringify(RASPUNS));
    delete fara.candidates[0].groundingMetadata.groundingSupports;
    expect(extrageRaspuns(fara).citari.map((c) => c.sursa_id)).toEqual(["s-777", "s-proba", null]);
    expect(extrageRaspuns({})).toEqual({ text: "", citari: [], tokens_intrare: 0, tokens_iesire: 0 });
  });

  it("sare peste partile de gandire", () => {
    const r = extrageRaspuns({ candidates: [{ content: { parts: [{ text: "gand", thought: true }, { text: "raspuns" }] } }] });
    expect(r.text).toBe("raspuns");
  });
});

describe("construiesteCerere", () => {
  it("pune promptul de sistem, istoricul (max 8 schimburi) si unealta file_search", () => {
    const istoric = Array.from({ length: 10 }, (_, i) => ({ intrebare: `i${i}`, raspuns: `r${i}` }));
    const c = construiesteCerere({ model: "m", magazin: "fileSearchStores/x", istoric, intrebare: "ultima" }) as any;
    expect(c.system_instruction.parts[0].text).toBe(PROMPT_SISTEM);
    expect(c.contents).toHaveLength(17);
    expect(c.contents[0]).toEqual({ role: "user", parts: [{ text: "i2" }] });
    expect(c.contents[16]).toEqual({ role: "user", parts: [{ text: "ultima" }] });
    expect(c.tools).toEqual([{ file_search: { file_search_store_names: ["fileSearchStores/x"] } }]);
  });

  it("ignora schimburile incomplete", () => {
    const c = construiesteCerere({ model: "m", magazin: "s", istoric: [{ intrebare: "x", raspuns: "" }], intrebare: "q" }) as any;
    expect(c.contents).toHaveLength(1);
  });
});

describe("interpreteazaOperatie", () => {
  it("compune numele documentului din id si magazin", () => {
    expect(interpreteazaOperatie({ done: true, response: { documentName: "abc" } }, "fileSearchStores/s"))
      .toEqual({ done: true, document: "fileSearchStores/s/documents/abc" });
    expect(interpreteazaOperatie({ done: false }, "x")).toEqual({ done: false });
    expect(interpreteazaOperatie({ done: true, error: { message: "prea mare" } }, "x")).toEqual({ done: true, eroare: "prea mare" });
  });
});

describe("costMicrodolari", () => {
  it("calculeaza dupa tarifele modelului", () => {
    expect(costMicrodolari("gemini-3.5-flash-lite", 7000, 600)).toBe(3600);
    expect(costMicrodolari("gemini-3.8-flash", 7000, 600)).toBe(7500);
    expect(costMicrodolari("necunoscut", 7000, 600)).toBe(0);
  });
});
