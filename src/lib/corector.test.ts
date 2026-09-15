import { describe, expect, it } from "vitest";
import { bugetCaractere, cerereCorectura, corecturiDinClaudeCode, evenimentClaudeCode, extrageCorecturi, impartePeLoturi, LIMITA_DOCUMENT, LIMITA_LOT, LIMITA_LOTURI, numara, PROMPT_CORECTOR } from "./corector";

describe("impartePeLoturi", () => {
  it("umple loturile in ordine, fara sa depaseasca plafonul; un paragraf lung sta singur", () => {
    const p = (i: number, n: number) => ({ i, text: "a".repeat(n) });
    const loturi = impartePeLoturi([p(0, 40), p(1, 50), p(2, 20), p(3, 150), p(4, 10)], 100);
    expect(loturi.map((l) => l.map((x) => x.i))).toEqual([[0, 1], [2], [3], [4]]);
    expect(impartePeLoturi([], 100)).toEqual([]);
  });
});

describe("cerereCorectura", () => {
  it("trimite paragrafele ca JSON, cu promptul corectorului", () => {
    const c = cerereCorectura("deepseek-flash", [{ i: 3, text: "Textul „cu” ghilimele\tși tab." }]);
    expect(c.sistem).toBe(PROMPT_CORECTOR);
    expect(JSON.parse(c.utilizator)).toEqual({ paragrafe: [{ i: 3, text: "Textul „cu” ghilimele\tși tab." }] });
  });
});

describe("extrageCorecturi", () => {
  it("citeste lista, normalizeaza tipul si sare intrarile invalide", () => {
    const text = "```json\n" + JSON.stringify({
      corecturi: [
        { i: 1, vechi: "insa", nou: "însă", tip: "Ortografie", motiv: "Se scrie cu î și ă." },
        { i: 1, vechi: "se v-a", nou: "se va", tip: "gramatica", motiv: "viitorul" },
        { i: 9, vechi: "x", nou: "y", tip: "ortografie" },   // paragraf din alt lot
        { i: 2, vechi: "", nou: "y" },                        // fara fragment
        { i: 2, vechi: "ceva", tip: "punctuație" },           // fara inlocuire
        { i: 2, vechi: "  a", nou: "a", tip: "altceva" },
      ],
    }) + "\n```";
    expect(extrageCorecturi(text, new Set([1, 2]))).toEqual([
      { i: 1, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "Se scrie cu î și ă." },
      { i: 1, vechi: "se v-a", nou: "se va", tip: "gramatică", motiv: "viitorul" },
      { i: 2, vechi: "  a", nou: "a", tip: "formulare", motiv: "" },
    ]);
  });

  it("accepta si lista goala sau o lista directa; arunca la raspuns fara JSON", () => {
    expect(extrageCorecturi('{"corecturi":[]}', new Set([1]))).toEqual([]);
    expect(extrageCorecturi('Iată: {"corecturi":[{"i":1,"vechi":"a","nou":"b","tip":"ortografie","motiv":"m"}]}', new Set([1]))).toHaveLength(1);
    expect(extrageCorecturi('[{"i":1,"vechi":"a","nou":"b"}]', new Set([1]))).toHaveLength(1);
    expect(() => extrageCorecturi("nu am găsit greșeli", new Set([1]))).toThrow(/lista de corecturi/);
  });
});

describe("numara", () => {
  it("pune \"de\" dupa acordul din romana", () => {
    expect([0, 1, 2, 19, 20, 21, 100, 101, 119, 120].map((n) => numara(n, "corectură", "corecturi"))).toEqual([
      "0 corecturi", "1 corectură", "2 corecturi", "19 corecturi", "20 de corecturi", "21 de corecturi",
      "100 de corecturi", "101 corecturi", "119 corecturi", "120 de corecturi",
    ]);
  });
});

describe("plafoane", () => {
  it("bugetul de caractere permite o reincercare a fiecarui lot si e plafonat la LIMITA_DOCUMENT", () => {
    expect(bugetCaractere(10_000)).toBe(45_000);
    expect(bugetCaractere(LIMITA_DOCUMENT * 5)).toBe(LIMITA_DOCUMENT * 2 + 25_000);
    expect(bugetCaractere(-1)).toBe(25_000);
  });

  it("cel mai nefavorabil document (paragrafe putin peste jumatate de lot) incape in LIMITA_LOTURI", () => {
    const n = Math.floor(LIMITA_DOCUMENT / (LIMITA_LOT / 2 + 1));
    const paragrafe = Array.from({ length: n }, (_, i) => ({ i, text: "a".repeat(LIMITA_LOT / 2 + 1) }));
    expect(impartePeLoturi(paragrafe).length).toBeLessThanOrEqual(LIMITA_LOTURI);
  });
});

describe("corecturiDinClaudeCode", () => {
  const corectura = { i: 1, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "î și ă" };
  it("ia corecturile din structured_output, cu costul raportat", () => {
    const iesire = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { corecturi: [corectura] }, total_cost_usd: 0.0123 });
    expect(corecturiDinClaudeCode(iesire, new Set([1]))).toEqual({ corecturi: [corectura], cost_usd: 0.0123 });
  });

  it("fara structured_output, citeste textul din result", () => {
    const iesire = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify({ corecturi: [corectura] }) });
    expect(corecturiDinClaudeCode(iesire, new Set([1]))).toEqual({ corecturi: [corectura], cost_usd: 0 });
  });

  it("arunca la eroarea raportata sau la iesire care nu e JSON", () => {
    expect(() => corecturiDinClaudeCode(JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "Credit balance is too low" }), new Set([1]))).toThrow(/Credit balance/);
    expect(() => corecturiDinClaudeCode("Invalid API key · Please run /login", new Set([1]))).toThrow(/nu a întors JSON/);
  });
});

describe("evenimentClaudeCode", () => {
  it("recunoaste rezultatul, reincercarile si pastreaza in jurnal doar cifrele, fara text", () => {
    const rezultat = evenimentClaudeCode(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 42000, result: "{\"corecturi\":[{\"vechi\":\"text secret\"}]}", total_cost_usd: 0.03 }));
    expect(rezultat).toMatchObject({ fel: "rezultat", jurnal: { type: "result", num_turns: 1, duration_ms: 42000, cost_usd: 0.03, structured_output: false } });
    expect(JSON.stringify(rezultat!.jurnal)).not.toContain("text secret");

    expect(evenimentClaudeCode(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 3, max_retries: 10, error_status: 429, error: "rate_limit", retry_delay_ms: 8000 })))
      .toMatchObject({ fel: "reincercare", eroare: "rate_limit", incercare: 3, max: 10 });

    const asistent = evenimentClaudeCode(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "secret" }, { type: "tool_use", name: "StructuredOutput", input: { x: "secret" } }], stop_reason: "tool_use" } }));
    expect(asistent).toMatchObject({ fel: "altul", jurnal: { blocuri: ["thinking", "tool_use:StructuredOutput"], stop: "tool_use" } });
    expect(JSON.stringify(asistent!.jurnal)).not.toContain("secret");
  });

  it("la eroare pune mesajul in jurnal; randurile care nu sunt JSON se sar", () => {
    expect(evenimentClaudeCode(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached" })))
      .toMatchObject({ fel: "rezultat", jurnal: { eroare: "Claude AI usage limit reached" } });
    expect(evenimentClaudeCode("nu e json")).toBeNull();
  });
});
