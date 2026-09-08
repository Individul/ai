import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { cheieText, citesteText, LIMITA_TEXT, scrieText, stergeText, valideazaPagini } from "./text";

describe("valideazaPagini", () => {
  it("accepta pagini crescatoare cu text si numara caracterele", () => {
    const v = valideazaPagini({ pagini: [{ pagina: 1, text: "Art. 1" }, { pagina: 3, text: "Art. 2" }] });
    expect(v).toEqual({ ok: true, pagini: [{ pagina: 1, text: "Art. 1" }, { pagina: 3, text: "Art. 2" }], caractere: 12 });
  });

  it("accepta lista goala (PDF scanat, fara strat de text)", () => {
    expect(valideazaPagini({ pagini: [] })).toEqual({ ok: true, pagini: [], caractere: 0 });
  });

  it("curata spatiile de la capete si sare peste paginile goale", () => {
    expect(valideazaPagini({ pagini: [{ pagina: 1, text: "  \n " }, { pagina: 2, text: " x \n" }] }))
      .toEqual({ ok: true, pagini: [{ pagina: 2, text: "x" }], caractere: 1 });
  });

  it("respinge formele gresite", () => {
    const rele: unknown[] = [
      null, "x", {}, { pagini: "x" },
      { pagini: [{ pagina: 0, text: "a" }] },
      { pagini: [{ pagina: 1.5, text: "a" }] },
      { pagini: [{ pagina: 2, text: "a" }, { pagina: 2, text: "b" }] },
      { pagini: [{ pagina: 2, text: "a" }, { pagina: 1, text: "b" }] },
      { pagini: [{ pagina: 1 }] },
      { pagini: [{ pagina: 1, text: 5 }] },
      { pagini: [{ pagina: 1, text: "a".repeat(LIMITA_TEXT + 1) }] },
    ];
    for (const r of rele) expect(valideazaPagini(r).ok, JSON.stringify(r).slice(0, 60)).toBe(false);
  });
});

describe("textul in R2", () => {
  it("scrie, citeste si sterge textul unei surse", async () => {
    expect(cheieText("s1")).toBe("text/s1");
    expect(await citesteText(env.FISIERE, "s1")).toBeNull();
    await scrieText(env.FISIERE, "s1", [{ pagina: 1, text: "Articolul 1. Ședința" }]);
    expect(await citesteText(env.FISIERE, "s1")).toEqual([{ pagina: 1, text: "Articolul 1. Ședința" }]);
    await stergeText(env.FISIERE, "s1");
    expect(await citesteText(env.FISIERE, "s1")).toBeNull();
    await stergeText(env.FISIERE, "s1"); // idempotent
  });
});
