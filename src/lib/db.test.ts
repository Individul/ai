import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  actualizeazaCatalog, adaugaAudio, adaugaSursa, arhiveazaCatalog, citesteCatalog, citesteCatalogDupaSlug,
  creeazaCatalog, listeazaAudio, listeazaCataloage, listeazaSurse, mutaCatalog, mutaSursa,
  seteazaFisierSursa, stergeAudio, stergeSursa,
} from "./db";
import { citesteSursa, seteazaText, surseCuText } from "./db";

const SURSA = { titlu: "Codul penal", tip: "cod" as const, numar: "985", data_emiterii: "2002-04-18", url: null };

describe("cataloage", () => {
  it("creeaza cu slugul dorit si il face unic la coliziune", async () => {
    const a = await creeazaCatalog(env.DB, "legislatia-penala", { titlu: "Legislația penală" });
    const b = await creeazaCatalog(env.DB, "legislatia-penala", { titlu: "Legislația penală" });
    const c = await creeazaCatalog(env.DB, "legislatia-penala", { titlu: "Legislația penală" });
    expect(a.slug).toBe("legislatia-penala");
    expect(b.slug).toBe("legislatia-penala-2");
    expect(c.slug).toBe("legislatia-penala-3");
    expect(a.stare).toBe("in_lucru");
    expect(a.culoare).toBe("violet");
    expect(await citesteCatalogDupaSlug(env.DB, "legislatia-penala-2")).toMatchObject({ id: b.id });
  });

  it("listeaza in ordine, cu numarul de surse si audio, si ascunde arhivatele", async () => {
    const a = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const b = await creeazaCatalog(env.DB, "b", { titlu: "B" });
    await adaugaSursa(env.DB, a.id, SURSA);
    await adaugaSursa(env.DB, a.id, { ...SURSA, titlu: "Alta" });
    await arhiveazaCatalog(env.DB, b.id);
    const vizibile = await listeazaCataloage(env.DB);
    expect(vizibile.map((c) => c.slug)).toEqual(["a"]);
    expect(vizibile[0]).toMatchObject({ nr_surse: 2, nr_audio: 0 });
    const toate = await listeazaCataloage(env.DB, { cuArhivate: true });
    expect(toate.map((c) => c.slug)).toEqual(["a", "b"]);
    expect(toate[1]?.stare).toBe("arhivat");
  });

  it("actualizeaza doar cand baza e cea curenta (CAS)", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const campuri = {
      titlu: "A nou", descriere: "d", pictograma: "balanta" as const, culoare: "teal" as const, stare: "activ" as const,
      url_notebook: "https://notebooklm.google.com/notebook/x", note_utilizare: "n",
    };
    const ok = await actualizeazaCatalog(env.DB, c.id, campuri, c.actualizat_la);
    expect(ok).toMatchObject({ ok: true, rand: { titlu: "A nou", slug: "a", stare: "activ" } });
    const vechi = await actualizeazaCatalog(env.DB, c.id, { ...campuri, titlu: "A si mai nou" }, c.actualizat_la);
    expect(vechi).toMatchObject({ ok: false, motiv: "conflict", rand: { titlu: "A nou" } });
    expect(await actualizeazaCatalog(env.DB, "nu-exista", campuri, "x")).toEqual({ ok: false, motiv: "lipsa" });
  });

  it("muta un catalog in sus si in jos; la capat nu face nimic", async () => {
    const a = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const b = await creeazaCatalog(env.DB, "b", { titlu: "B" });
    const c = await creeazaCatalog(env.DB, "c", { titlu: "C" });
    expect(await mutaCatalog(env.DB, a.id, -1)).toBe(false);
    expect(await mutaCatalog(env.DB, c.id, 1)).toBe(false);
    expect(await mutaCatalog(env.DB, c.id, -1)).toBe(true);
    expect((await listeazaCataloage(env.DB)).map((x) => x.slug)).toEqual(["a", "c", "b"]);
    expect(await mutaCatalog(env.DB, a.id, 1)).toBe(true);
    expect((await listeazaCataloage(env.DB)).map((x) => x.slug)).toEqual(["c", "a", "b"]);
    expect(await mutaCatalog(env.DB, "nu-exista", 1)).toBe(false);
  });

  it("arhivarea pastreaza sursele, iar stergerea bruta e blocata de RESTRICT", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    await adaugaSursa(env.DB, c.id, SURSA);
    expect(await arhiveazaCatalog(env.DB, c.id)).toBe(true);
    expect(await listeazaSurse(env.DB, c.id)).toHaveLength(1);
    await expect(env.DB.prepare("DELETE FROM cataloage WHERE id = ?").bind(c.id).run()).rejects.toThrow();
  });
});

describe("surse", () => {
  it("adaugarea unei surse impinge actualizat_la al catalogului", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const s = await adaugaSursa(env.DB, c.id, SURSA);
    expect(s).toMatchObject({ titlu: "Codul penal", tip: "cod", fisier_nume: null, ordine: 0 });
    const dupa = await citesteCatalog(env.DB, c.id);
    expect(dupa!.actualizat_la > c.actualizat_la).toBe(true);
  });

  it("seteaza si scoate fisierul; stergerea scoate randul", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const s = await adaugaSursa(env.DB, c.id, SURSA);
    const cuFisier = await seteazaFisierSursa(env.DB, s.id, "cod_penal.pdf", 12345);
    expect(cuFisier).toMatchObject({ fisier_nume: "cod_penal.pdf", fisier_marime: 12345 });
    const fara = await seteazaFisierSursa(env.DB, s.id, null, null);
    expect(fara).toMatchObject({ fisier_nume: null, fisier_marime: null });
    expect(await stergeSursa(env.DB, s.id)).toBe(true);
    expect(await stergeSursa(env.DB, s.id)).toBe(false);
    expect(await listeazaSurse(env.DB, c.id)).toEqual([]);
  });

  it("muta sursele doar in interiorul catalogului lor", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const alt = await creeazaCatalog(env.DB, "b", { titlu: "B" });
    const s1 = await adaugaSursa(env.DB, c.id, { ...SURSA, titlu: "1" });
    const s2 = await adaugaSursa(env.DB, c.id, { ...SURSA, titlu: "2" });
    await adaugaSursa(env.DB, alt.id, { ...SURSA, titlu: "x" });
    expect(await mutaSursa(env.DB, s2.id, -1)).toBe(true);
    expect((await listeazaSurse(env.DB, c.id)).map((s) => s.titlu)).toEqual(["2", "1"]);
    expect(await mutaSursa(env.DB, s1.id, 1)).toBe(false);
    expect((await listeazaSurse(env.DB, alt.id)).map((s) => s.titlu)).toEqual(["x"]);
  });
});

describe("audio", () => {
  it("adauga cu id-ul dat, listeaza si sterge", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    const id = crypto.randomUUID();
    const a = await adaugaAudio(
      env.DB, id, c.id,
      { titlu: "Rezumat", descriere: "", data: "2026-09-08", durata_s: 754 },
      { tip_mime: "audio/mpeg", fisier_nume: "rezumat.mp3", marime: 1000 }
    );
    expect(a).toMatchObject({ id, durata_s: 754, tip_mime: "audio/mpeg", ordine: 0 });
    expect((await listeazaCataloage(env.DB))[0]).toMatchObject({ nr_audio: 1 });
    expect(await stergeAudio(env.DB, id)).toBe(true);
    expect(await listeazaAudio(env.DB, c.id)).toEqual([]);
  });

  it("respinge data invalida la nivel de schema", async () => {
    const c = await creeazaCatalog(env.DB, "a", { titlu: "A" });
    await expect(
      adaugaAudio(
        env.DB, crypto.randomUUID(), c.id,
        { titlu: "x", descriere: "", data: "azi", durata_s: null },
        { tip_mime: "audio/mpeg", fisier_nume: "x.mp3", marime: 1 }
      )
    ).rejects.toThrow();
  });
});

describe("text extras", () => {
  it("retine contoarele textului, le sterge cu null si numara sursele cu text", async () => {
    const c = await creeazaCatalog(env.DB, "t", { titlu: "T" });
    const s1 = await adaugaSursa(env.DB, c.id, SURSA);
    const s2 = await adaugaSursa(env.DB, c.id, { ...SURSA, titlu: "Scanat" });
    expect(s1.text_pagini).toBeNull();
    expect(s1.text_caractere).toBeNull();
    expect(await surseCuText(env.DB, c.id)).toBe(0);
    await seteazaText(env.DB, s1.id, { pagini: 12, caractere: 30_000 });
    await seteazaText(env.DB, s2.id, { pagini: 0, caractere: 0 }); // PDF scanat: extras, dar fara text
    expect(await citesteSursa(env.DB, s1.id)).toMatchObject({ text_pagini: 12, text_caractere: 30_000 });
    expect(await citesteSursa(env.DB, s2.id)).toMatchObject({ text_pagini: 0, text_caractere: 0 });
    expect(await surseCuText(env.DB, c.id)).toBe(1);
    await seteazaText(env.DB, s1.id, null);
    expect(await citesteSursa(env.DB, s1.id)).toMatchObject({ text_pagini: null, text_caractere: null });
    expect(await surseCuText(env.DB, c.id)).toBe(0);
  });
});
