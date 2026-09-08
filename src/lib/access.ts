// Verificarea JWT-ului pus de Cloudflare Access in header-ul Cf-Access-Jwt-Assertion.
// Verificam semnatura RS256 cu cheile publice ale echipei — nu doar prezenta header-ului,
// altfel cineva ar putea trimite header-ul direct catre workers.dev, ocolind Access.

interface Jwk { kid: string; kty: string; n: string; e: string; }

function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

let jwks: { la: number; keys: Jwk[] } | null = null;

async function cheiEchipa(teamDomain: string): Promise<Jwk[]> {
  if (jwks && Date.now() - jwks.la < 3_600_000) return jwks.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`nu pot citi cheile Access (${res.status})`);
  const data = (await res.json()) as { keys?: Jwk[] };
  jwks = { la: Date.now(), keys: data.keys ?? [] };
  return jwks.keys;
}

export type Verificare =
  | { ok: true; email: string }
  | { ok: false; motiv: string };

export async function verificaAccessJwt(
  token: string, teamDomain: string, aud: string
): Promise<Verificare> {
  const parti = token.split(".");
  if (parti.length !== 3) return { ok: false, motiv: "token malformat" };

  let header: any, payload: any;
  try { header = decodeJson(parti[0]); payload = decodeJson(parti[1]); }
  catch { return { ok: false, motiv: "token ilizibil" }; }
  if (header.alg !== "RS256") return { ok: false, motiv: "algoritm neacceptat" };

  let jwk: Jwk | undefined;
  try { jwk = (await cheiEchipa(teamDomain)).find((k) => k.kid === header.kid); }
  catch (e: any) { return { ok: false, motiv: e?.message ?? "chei indisponibile" }; }
  if (!jwk) return { ok: false, motiv: "cheie necunoscuta" };

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"]
  );
  const semnaturaOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(parti[2]),
    new TextEncoder().encode(`${parti[0]}.${parti[1]}`)
  );
  if (!semnaturaOk) return { ok: false, motiv: "semnatura invalida" };

  const acum = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < acum) return { ok: false, motiv: "token expirat" };
  if (typeof payload.nbf === "number" && payload.nbf > acum + 60) return { ok: false, motiv: "token neintrat in vigoare" };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, motiv: "aplicatie nepotrivita (aud)" };
  if (payload.iss !== `https://${teamDomain}`) return { ok: false, motiv: "emitent nepotrivit" };

  return { ok: true, email: String(payload.email ?? "necunoscut") };
}
