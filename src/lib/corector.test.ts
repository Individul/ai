import { describe, expect, it } from "vitest";
import { cerereCorectura, extrageCorecturi, impartePeLoturi, numara, PROMPT_CORECTOR } from "./corector";

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
