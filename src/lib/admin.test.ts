import { describe, expect, it } from "vitest";
import { esteAdmin, listaAdmini } from "./admin";

describe("esteAdmin", () => {
  it("refuza pe toata lumea cand lista lipseste sau e goala", () => {
    expect(esteAdmin("a@x.md", undefined)).toBe(false);
    expect(esteAdmin("a@x.md", "")).toBe(false);
    expect(esteAdmin("a@x.md", " , ,")).toBe(false);
  });

  it("normalizeaza majusculele si spatiile de ambele parti", () => {
    expect(esteAdmin("  A@X.MD ", "a@x.md")).toBe(true);
    expect(esteAdmin("a@x.md", " A@X.md ")).toBe(true);
  });

  it("accepta liste cu mai multe adrese si virgule in plus", () => {
    expect(listaAdmini("a@x.md,, b@x.md ,")).toEqual(["a@x.md", "b@x.md"]);
    expect(esteAdmin("b@x.md", "a@x.md,, b@x.md ,")).toBe(true);
    expect(esteAdmin("c@x.md", "a@x.md,b@x.md")).toBe(false);
  });

  it("nu accepta emailul gol nici daca lista are un element gol", () => {
    expect(esteAdmin("", ",")).toBe(false);
  });
});
