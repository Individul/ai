import { describe, expect, it } from "vitest";
import { stareVarf } from "./validare";
import { textVarf } from "./varf";

describe("stareVarf + textVarf", () => {
  it("in varf: activ, pana la sfarsitul intervalului, in ora Chisinaului (vara: UTC+3)", () => {
    const acum = new Date("2026-09-10T07:30:00Z"); // joi
    const s = stareVarf("deepseek-flash", acum)!;
    expect(s.activ).toBe(true);
    expect(s.panaLa?.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    expect(textVarf(s)).toEqual({ activ: true, text: "Acum e oră de vârf la DeepSeek: fiecare întrebare costă de 2 ori mai mult, până la 13:00." });
  });

  it("in afara varfului nu se spune nimic: ora libera e starea obisnuita", () => {
    const acum = new Date("2026-09-10T12:00:00Z");
    expect(stareVarf("deepseek-flash", acum)?.activ).toBe(false);
    expect(textVarf(stareVarf("deepseek-flash", acum))).toBeNull();
  });

  it("weekend in interval: nu e varf; modelele fara ore de varf dau null", () => {
    expect(stareVarf("deepseek-flash", new Date("2026-09-12T07:30:00Z"))?.activ).toBe(false);
    expect(stareVarf("gemini-3.5-flash-lite")).toBeNull();
    expect(textVarf(null)).toBeNull();
  });
});
