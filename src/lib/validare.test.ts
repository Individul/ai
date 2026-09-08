import { describe, expect, it } from "vitest";
import {
  fmtDurata, fmtMarime, slug, urlNotebookValid, valideazaAudio, valideazaCatalog, valideazaSursa, ziValida,
} from "./validare";
import { LIMITA_BUGET_MAX, LIMITA_BUGET_MIN, motorModel, TARIFE } from "./validare";

describe("slug", () => {
  it("scoate diacriticele si pune cratime", () => {
    expect(slug("Legislația penală")).toBe("legislatia-penala");
    expect(slug("  Ordine — Penitenciare (2026)! ")).toBe("ordine-penitenciare-2026");
    expect(slug("Șț ĂÂÎ")).toBe("st-aai");
  });
  it("nu intoarce niciodata sirul gol", () => {
    expect(slug("???")).toBe("catalog");
  });
});

describe("ziValida", () => {
  it("accepta doar zile reale in format AAAA-LL-ZZ", () => {
    expect(ziValida("2026-09-08")).toBe(true);
    expect(ziValida("2026-02-30")).toBe(false);
    expect(ziValida("8.09.2026")).toBe(false);
  });
});

describe("urlNotebookValid", () => {
  it("accepta gol, notebook.google.com sau notebooklm.google.com, nimic altceva", () => {
    expect(urlNotebookValid("")).toBe(true);
    expect(urlNotebookValid("https://notebooklm.google.com/notebook/abc-123")).toBe(true);
    expect(urlNotebookValid("https://notebook.google.com/notebook/4561b153-6ab8-4658-8a66-f4ab1e027821")).toBe(true);
    expect(urlNotebookValid("https://notebook.google.com.evil.md/x")).toBe(false);
    expect(urlNotebookValid("http://notebooklm.google.com/notebook/abc")).toBe(false);
    expect(urlNotebookValid("https://evil.com/notebooklm.google.com")).toBe(false);
    expect(urlNotebookValid("javascript:alert(1)")).toBe(false);
  });
});

describe("formatari", () => {
  it("fmtDurata", () => {
    expect(fmtDurata(754)).toBe("12:34");
    expect(fmtDurata(5)).toBe("0:05");
    expect(fmtDurata(3723)).toBe("1:02:03");
  });
  it("fmtMarime cu virgula zecimala", () => {
    expect(fmtMarime(512)).toBe("512 B");
    expect(fmtMarime(20 * 1024)).toBe("20 KB");
    expect(fmtMarime(2_400_000)).toBe("2,3 MB");
  });
});

describe("valideazaCatalog", () => {
  it("curata si completeaza valorile implicite", () => {
    const r = valideazaCatalog({ titlu: "  Legislația penală ", url_notebook: "" });
    expect(r).toEqual({
      ok: true,
      date: {
        titlu: "Legislația penală", descriere: "", pictograma: "carte", culoare: "violet", stare: "in_lucru",
        url_notebook: "", note_utilizare: "",
      },
    });
  });
  it("respinge titlul gol, culoarea si linkul gresite", () => {
    expect(valideazaCatalog({ titlu: " " })).toMatchObject({ ok: false });
    expect(valideazaCatalog({ titlu: "x", culoare: "roz" })).toMatchObject({ ok: false });
    expect(valideazaCatalog({ titlu: "x", url_notebook: "https://x.md" })).toMatchObject({ ok: false });
  });
});

describe("valideazaSursa", () => {
  it("accepta campurile optionale goale ca null", () => {
    const r = valideazaSursa({ titlu: "Codul penal", tip: "cod", numar: "", data_emiterii: "", url: "" });
    expect(r).toEqual({ ok: true, date: { titlu: "Codul penal", tip: "cod", numar: null, data_emiterii: null, url: null } });
  });
  it("respinge tipul necunoscut, data invalida si linkul fara http", () => {
    expect(valideazaSursa({ titlu: "x", tip: "poezie" })).toMatchObject({ ok: false });
    expect(valideazaSursa({ titlu: "x", tip: "lege", data_emiterii: "2026-02-30" })).toMatchObject({ ok: false });
    expect(valideazaSursa({ titlu: "x", tip: "lege", url: "legis.md" })).toMatchObject({ ok: false });
  });
});

describe("valideazaAudio", () => {
  it("cere titlu si data valida; durata e optionala si rotunjita", () => {
    expect(valideazaAudio({ titlu: "Rezumat", data: "2026-09-08", durata_s: "753.6" }))
      .toEqual({ ok: true, date: { titlu: "Rezumat", descriere: "", data: "2026-09-08", durata_s: 754 } });
    expect(valideazaAudio({ titlu: "Rezumat", data: "azi" })).toMatchObject({ ok: false });
    expect(valideazaAudio({ titlu: "Rezumat", data: "2026-09-08", durata_s: "-1" })).toMatchObject({ ok: false });
  });
});

describe("modele si motoare", () => {
  it("deduce motorul din model", () => {
    expect(motorModel("gemini-3.5-flash-lite")).toBe("gemini");
    expect(motorModel("glm-5.3-flash")).toBe("zai");
    expect(motorModel("necunoscut")).toBeNull();
  });

  it("modelele Z.AI au tariful public si multiplicatorii de credite ai planului de coding", () => {
    expect(TARIFE["glm-5.3-flash"]).toMatchObject({ motor: "zai", intrare: 0.15, iesire: 0.5, credite: { intrare: 2.3, cache: 0.56, iesire: 8 } });
    expect(TARIFE["glm-5.3"]).toMatchObject({ motor: "zai", intrare: 1.4, iesire: 4.4, credite: { intrare: 6.9, cache: 1.7, iesire: 24 } });
    expect(TARIFE["gemini-3.5-flash-lite"]).toMatchObject({ motor: "gemini" });
    expect(TARIFE["gemini-3.5-flash-lite"]).not.toHaveProperty("credite");
  });

  it("bugetul de context are limite fixe", () => {
    expect(LIMITA_BUGET_MIN).toBe(10_000);
    expect(LIMITA_BUGET_MAX).toBe(3_000_000);
  });
});
