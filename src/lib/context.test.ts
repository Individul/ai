import { describe, expect, it } from "vitest";
import { antetPagina, construiesteContext, extrageCitariText } from "./context";

const pag = (pagina: number, text: string) => ({ pagina, text });
const COD = {
  id: "cod", titlu: "Codul de executare",
  pagini: [
    pag(1, "Codul de executare al Republicii Moldova. Titlul I. Dispoziții generale."),
    pag(2, "Articolul 91. Liberarea condiționată de pedeapsă înainte de termen se aplică condamnaților."),
    pag(3, "Articolul 120. Vizitele se acordă de două ori pe lună, în condițiile regulamentului."),
  ],
};
const ORDIN = {
  id: "ord", titlu: "Ordinul nr. 777",
  pagini: [
    pag(1, "Ordinul nr. 777 privind pachetele. Se aprobă regulamentul."),
    pag(2, "Pachetele se predau marți și joi, între orele 9 și 15."),
  ],
};

describe("construiesteContext", () => {
  it("cand totul incape, trimite toate paginile in ordine, cu antet pe fiecare", () => {
    const c = construiesteContext([COD, ORDIN], "orice", 10_000);
    expect(c.mod).toBe("integral");
    expect(c.pagini_trimise).toBe(5);
    expect(c.pagini_total).toBe(5);
    expect(c.caractere).toBe([...COD.pagini, ...ORDIN.pagini].reduce((s, p) => s + p.text.length, 0));
    const antete = [...c.text.matchAll(/^=== .+ ===$/gm)].map((m) => m[0]);
    expect(antete).toEqual([
      antetPagina("Codul de executare", 1), antetPagina("Codul de executare", 2), antetPagina("Codul de executare", 3),
      antetPagina("Ordinul nr. 777", 1), antetPagina("Ordinul nr. 777", 2),
    ]);
    expect(c.text).toContain("Articolul 120. Vizitele");
  });

  it("fara surse intoarce contextul gol", () => {
    expect(construiesteContext([], "x", 100)).toEqual({ text: "", mod: "integral", caractere: 0, pagini_trimise: 0, pagini_total: 0 });
  });

  it("peste buget, pastreaza pagina 1 a fiecarei surse si paginile care se potrivesc cu intrebarea, in ordine", () => {
    const buget = COD.pagini[0]!.text.length + ORDIN.pagini[0]!.text.length + COD.pagini[1]!.text.length + 5;
    const c = construiesteContext([COD, ORDIN], "Ce condiții cere liberarea condiționată?", buget);
    expect(c.mod).toBe("filtrat");
    expect(c.pagini_trimise).toBe(3);
    expect(c.pagini_total).toBe(5);
    expect(c.caractere).toBeLessThanOrEqual(buget);
    const antete = [...c.text.matchAll(/^=== .+ ===$/gm)].map((m) => m[0]);
    expect(antete).toEqual([antetPagina("Codul de executare", 1), antetPagina("Codul de executare", 2), antetPagina("Ordinul nr. 777", 1)]);
  });

  it("potrivirea cu titlul sursei conteaza", () => {
    const a = { id: "a", titlu: "Ordinul nr. 123", pagini: [pag(1, "Ordin."), pag(2, "Dispoziții comune despre program.")] };
    const b = { id: "b", titlu: "Ordinul nr. 777", pagini: [pag(1, "Ordin."), pag(2, "Dispoziții comune despre program.")] };
    const buget = "Ordin.".length * 2 + "Dispoziții comune despre program.".length;
    const c = construiesteContext([a, b], "Ce spune ordinul 777 despre program?", buget);
    expect(c.pagini_trimise).toBe(3);
    expect(c.text).toContain(antetPagina("Ordinul nr. 777", 2));
    expect(c.text).not.toContain(antetPagina("Ordinul nr. 123", 2));
  });

  it("gaseste paginile si fara diacritice sau cu alta flexiune", () => {
    const buget = COD.pagini[0]!.text.length + ORDIN.pagini[0]!.text.length + ORDIN.pagini[1]!.text.length + 5;
    const c = construiesteContext([COD, ORDIN], "cand se predau pachetele", buget);
    expect(c.text).toContain(antetPagina("Ordinul nr. 777", 2));
    expect(c.text).not.toContain(antetPagina("Codul de executare", 3));
  });
});

describe("extrageCitariText", () => {
  const surse = [{ id: "cod", titlu: "Codul de executare al Republicii Moldova" }, { id: "ord", titlu: "Ordinul nr. 777" }];

  it("leaga citarile [Titlu, pag. N] de surse, unice, in ordinea aparitiei", () => {
    const text = "Vizitele [Codul de executare al Republicii Moldova, pag. 12] și pachetele [Ordinul nr. 777, p. 2]; " +
      "din nou [Codul de executare al Republicii Moldova, pag. 12] și altceva [Regulament necunoscut, pag. 4].";
    expect(extrageCitariText(text, surse)).toEqual([
      { sursa_id: "cod", titlu: "Codul de executare al Republicii Moldova", pagina: 12 },
      { sursa_id: "ord", titlu: "Ordinul nr. 777", pagina: 2 },
      { sursa_id: null, titlu: "Regulament necunoscut", pagina: 4 },
    ]);
  });

  it("potriveste titlul fara diacritice si majuscule, si cand modelul il scurteaza", () => {
    expect(extrageCitariText("x [codul de executare, pag. 5] y [ORDINUL NR. 777, pag. 1]", surse)).toEqual([
      { sursa_id: "cod", titlu: "Codul de executare al Republicii Moldova", pagina: 5 },
      { sursa_id: "ord", titlu: "Ordinul nr. 777", pagina: 1 },
    ]);
  });

  it("ignora parantezele care nu sunt citari", () => {
    expect(extrageCitariText("vezi [nota] și [art. 5] și [Ordinul nr. 777]", surse)).toEqual([]);
  });
});

describe("extrageCitariText, forme vazute pe viu", () => {
  const surse = [{ id: "ord", titlu: "Ordinul nr. 777" }];

  it("accepta articolul dupa pagina sau inaintea ei (GLM-5.3-Flash, 8 sept. 2026)", () => {
    expect(extrageCitariText("x [Ordinul nr. 777, pag. 2, Articolul 3] y [Ordinul nr. 777, art. 7, pag. 3]", surse)).toEqual([
      { sursa_id: "ord", titlu: "Ordinul nr. 777", pagina: 2 },
      { sursa_id: "ord", titlu: "Ordinul nr. 777", pagina: 3 },
    ]);
  });
});
