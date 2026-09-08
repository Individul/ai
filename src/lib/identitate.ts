// Cine face cererea. Pura si testabila: verificatorul JWT se injecteaza.
//
// 1. Access configurat (teamDomain + aud): JWT obligatoriu, verificat -> email.
//    Are prioritate si local, ca sa nu existe cale de ocolire.
// 2. Altfel, DEV_EMAIL doar cand `dev` e adevarat (astro dev sau localhost).
// 3. Altfel 503: esueaza inchis.

import { verificaAccessJwt, type Verificare } from "./access";

export type Verificator = (token: string, teamDomain: string, aud: string) => Promise<Verificare>;

export interface ConfigIdentitate {
  teamDomain?: string;
  aud?: string;
  devEmail?: string;
  dev: boolean;
}

export type Identitate =
  | { ok: true; email: string }
  | { ok: false; status: 403 | 503; mesaj: string };

export async function identitate(
  req: Request, cfg: ConfigIdentitate, verifica: Verificator = verificaAccessJwt
): Promise<Identitate> {
  if (cfg.teamDomain && cfg.aud) {
    const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) return { ok: false, status: 403, mesaj: "Acces interzis: lipsește Cloudflare Access." };
    const v = await verifica(jwt, cfg.teamDomain, cfg.aud);
    if (!v.ok) return { ok: false, status: 403, mesaj: `Acces interzis: ${v.motiv}.` };
    return { ok: true, email: v.email.trim().toLowerCase() };
  }
  if (cfg.devEmail && cfg.dev) return { ok: true, email: cfg.devEmail.trim().toLowerCase() };
  return {
    ok: false, status: 503,
    mesaj: "Cloudflare Access nu este configurat. Setează ACCESS_TEAM_DOMAIN și ACCESS_AUD pe Worker.",
  };
}
