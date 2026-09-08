import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { numeFisierCurat, serveste, tipMimePermis, verificaUpload } from "./fisiere";

const cerere = (headers: Record<string, string> = {}) => new Request("https://ai.dumitru.cloud/f/x", { headers });

describe("serveste din R2", () => {
  it("fara Range: 200 cu tot corpul, content-length, accept-ranges si numele cu spatii", async () => {
    await env.FISIERE.put("pdf/x", "abcdefgh", { httpMetadata: { contentType: "application/pdf" } });
    const r = await serveste(env.FISIERE, "pdf/x", cerere(), "Cod penal.pdf", "inline");
    expect(r?.status).toBe(200);
    expect(r?.headers.get("content-type")).toBe("application/pdf");
    expect(r?.headers.get("content-length")).toBe("8");
    expect(r?.headers.get("accept-ranges")).toBe("bytes");
    expect(r?.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''Cod%20penal.pdf");
    expect(r?.headers.get("cache-control")).toBe("no-store");
    expect(await r?.text()).toBe("abcdefgh");
  });

  it("cu Range: 206, content-range si doar octetii ceruti", async () => {
    await env.FISIERE.put("audio/y", "abcdefgh", { httpMetadata: { contentType: "audio/mpeg" } });
    const r = await serveste(env.FISIERE, "audio/y", cerere({ range: "bytes=0-3" }), "r.mp3", "inline");
    expect(r?.status).toBe(206);
    expect(r?.headers.get("content-range")).toBe("bytes 0-3/8");
    expect(r?.headers.get("content-length")).toBe("4");
    expect(await r?.text()).toBe("abcd");
    const coada = await serveste(env.FISIERE, "audio/y", cerere({ range: "bytes=6-" }), "r.mp3", "inline");
    expect(coada?.status).toBe(206);
    expect(coada?.headers.get("content-range")).toBe("bytes 6-7/8");
    expect(await coada?.text()).toBe("gh");
  });

  it("attachment pentru descarcare; null cand obiectul lipseste", async () => {
    await env.FISIERE.put("pdf/z", "abc", { httpMetadata: { contentType: "application/pdf" } });
    const r = await serveste(env.FISIERE, "pdf/z", cerere(), "z.pdf", "attachment");
    expect(r?.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''z.pdf");
    expect(await serveste(env.FISIERE, "pdf/nu", cerere(), "z.pdf", "inline")).toBeNull();
  });
});

describe("verificaUpload", () => {
  const c = (h: Record<string, string>) =>
    new Request("https://ai.dumitru.cloud/api/x", { method: "PUT", headers: h, body: "x" });

  it("accepta PDF cu lungime, respinge tipul, lipsa lungimii si depasirea limitei", () => {
    expect(verificaUpload("pdf", c({ "content-type": "application/pdf", "content-length": "1" })))
      .toEqual({ ok: true, tip: "application/pdf", marime: 1 });
    expect(verificaUpload("pdf", c({ "content-type": "image/png", "content-length": "1" })))
      .toMatchObject({ ok: false, status: 415 });
    expect(verificaUpload("audio", c({ "content-type": "audio/mpeg; codecs=mp3", "content-length": "1" })))
      .toMatchObject({ ok: true, tip: "audio/mpeg" });
    expect(verificaUpload("audio", c({ "content-type": "audio/mpeg", "content-length": String(200 * 1024 * 1024) })))
      .toMatchObject({ ok: false, status: 413 });
  });

  it("tipMimePermis ignora parametrii si majusculele", () => {
    expect(tipMimePermis("pdf", "Application/PDF; charset=x")).toBe(true);
    expect(tipMimePermis("audio", "audio/x-m4a")).toBe(true);
    expect(tipMimePermis("audio", "application/pdf")).toBe(false);
  });
});

describe("numeFisierCurat", () => {
  it("decodeaza, scoate caile si cade pe implicit", () => {
    expect(numeFisierCurat("Cod%20penal.pdf", "x.pdf")).toBe("Cod penal.pdf");
    expect(numeFisierCurat("..%2F..%2Fetc%2Fpasswd", "x.pdf")).toBe("....etcpasswd");
    expect(numeFisierCurat("%E0%A4%A", "x.pdf")).toBe("x.pdf");
    expect(numeFisierCurat(null, "x.pdf")).toBe("x.pdf");
  });
});
