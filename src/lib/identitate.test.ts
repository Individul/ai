import { describe, expect, it } from "vitest";
import { identitate, type Verificator } from "./identitate";

const okCa = (email: string): Verificator => async () => ({ ok: true, email });
const refuza: Verificator = async () => ({ ok: false, motiv: "semnatura invalida" });
const niciodata: Verificator = async () => { throw new Error("nu trebuia apelat"); };

const cerere = (headers: Record<string, string> = {}) =>
  new Request("https://ai.dumitru.cloud/", { headers });

const ACCESS = { teamDomain: "echipa.cloudflareaccess.com", aud: "aud123" };

describe("identitate cu Cloudflare Access", () => {
  it("accepta JWT-ul valid si normalizeaza emailul", async () => {
    const r = await identitate(
      cerere({ "Cf-Access-Jwt-Assertion": "x.y.z" }),
      { ...ACCESS, dev: false }, okCa("  Dumitru@Exemplu.MD ")
    );
    expect(r).toEqual({ ok: true, email: "dumitru@exemplu.md" });
  });

  it("refuza cu 403 cand headerul lipseste, chiar daca DEV_EMAIL e setat local", async () => {
    const r = await identitate(cerere(), { ...ACCESS, devEmail: "dev@local", dev: true }, niciodata);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("refuza cu 403 si motiv cand verificarea esueaza", async () => {
    const r = await identitate(cerere({ "Cf-Access-Jwt-Assertion": "x.y.z" }), { ...ACCESS, dev: false }, refuza);
    expect(r).toMatchObject({ ok: false, status: 403 });
    if (r.ok) return;
    expect(r.mesaj).toContain("semnatura invalida");
  });
});

describe("identitate in dezvoltare", () => {
  it("foloseste DEV_EMAIL doar cand cfg.dev e adevarat", async () => {
    const r = await identitate(cerere(), { devEmail: "dev@local", dev: true }, niciodata);
    expect(r).toEqual({ ok: true, email: "dev@local" });
  });

  it("raspunde 503 cand DEV_EMAIL e setat dar nu suntem in dev", async () => {
    const r = await identitate(cerere(), { devEmail: "dev@local", dev: false }, niciodata);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});

describe("identitate neconfigurata", () => {
  it("raspunde 503 cand nici Access, nici DEV_EMAIL nu exista", async () => {
    const r = await identitate(cerere(), { dev: true }, niciodata);
    expect(r).toMatchObject({ ok: false, status: 503 });
    if (r.ok) return;
    expect(r.mesaj).toContain("Cloudflare Access nu este configurat");
  });

  it("trateaza Access configurat pe jumatate ca neconfigurat", async () => {
    const r = await identitate(cerere({ "Cf-Access-Jwt-Assertion": "x.y.z" }), { teamDomain: "e.cloudflareaccess.com", dev: false }, niciodata);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});
