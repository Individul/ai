import { describe, expect, it } from "vitest";
import { compunePagina, type ElementPagina } from "./pdf";

// Elementele vin din pdf.js: str, height, transform[5] (linia de baza), hasEOL.
const e = (text: string, inaltime = 12, y = 400, rand_nou = false): ElementPagina => ({ text, inaltime, y, rand_nou });

describe("compunePagina", () => {
  it("lipeste exponentul de numarul articolului, ca in actul tiparit", () => {
    // In PDF-urile de la legis.md, "217¹" e "217" plus un "1" mai mic si ridicat.
    expect(compunePagina([e("Articolul 217"), e("1", 6.6, 406), e("."), e("Circulația ilegală", 12, 400, true)]))
      .toBe("Articolul 217¹. Circulația ilegală");
  });

  it("merge si la literele cu exponent din enumerari", () => {
    expect(compunePagina([e("b"), e("1", 6.6, 406), e(") pentru infracţiunile")])).toBe("b¹) pentru infracţiunile");
  });

  it("acopera toate cifrele si exponentii de mai multe cifre", () => {
    expect(compunePagina([e("art.208"), e("5", 6.6, 405), e("si art.10"), e("12", 6.6, 405)])).toBe("art.208⁵ si art.10¹²");
  });

  it("nu ridica cifrele care nu sunt exponenti", () => {
    // aceeasi linie de baza, doar font mai mic (nota de subsol)
    expect(compunePagina([e("nota"), e("3", 6.6, 400)])).toBe("nota 3");
    // mai jos de linia de baza (indice)
    expect(compunePagina([e("H"), e("2", 6.6, 396), e("O")])).toBe("H 2 O");
    // ridicat, dar nu e cifra
    expect(compunePagina([e("text"), e("a", 6.6, 406)])).toBe("text a");
  });

  it("strange spatiile, randurile si spatiul dinaintea punctuatiei", () => {
    expect(compunePagina([e("Articolul 16"), e("."), e("Clasificarea", 12, 400, true), e("infracţiunilor")]))
      .toBe("Articolul 16. Clasificarea\ninfracţiunilor");
    expect(compunePagina([e("  "), e("text"), e("  ")])).toBe("text");
  });
});
