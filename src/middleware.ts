import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { identitate } from "./lib/identitate";
import { esteAdmin } from "./lib/admin";
import { eroare } from "./lib/api";

// Identitatea pe fiecare cerere. Singurul loc care citeste env.ACCESS_* / DEV_EMAIL / ADMIN_EMAILS.
//
// `dev` e adevarat doar in `astro dev` (import.meta.env.DEV, fals static la build) sau
// cand hostname-ul e localhost (`wrangler dev` pe build). In productie cererile vin pe
// domeniul custom, iar DEV_EMAIL traieste doar in .dev.vars, deci calea de dev nu se
// poate deschide accidental.
//
// Adminul: /admin* si /api/admin* sunt blocate aici, centralizat, ca o pagina uitata sa nu
// poata scurge scriere.
const text = (mesaj: string, status: number) =>
  new Response(`${mesaj}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export const onRequest = defineMiddleware(async (context, next) => {
  const { hostname, pathname } = context.url;
  const dev = import.meta.env.DEV || hostname === "localhost" || hostname === "127.0.0.1";
  const api = pathname.startsWith("/api/");
  const r = await identitate(context.request, {
    teamDomain: env.ACCESS_TEAM_DOMAIN || undefined,
    aud: env.ACCESS_AUD || undefined,
    devEmail: env.DEV_EMAIL || undefined,
    dev,
  });
  if (!r.ok) return api ? eroare(r.status, r.mesaj) : text(r.mesaj, r.status);
  context.locals.email = r.email;
  context.locals.admin = esteAdmin(r.email, env.ADMIN_EMAILS);

  const zonaAdmin = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
  if (zonaAdmin && !context.locals.admin) {
    const mesaj = "Doar administratorul poate intra aici.";
    return api ? eroare(403, mesaj) : text(mesaj, 403);
  }

  const raspuns = await next();
  // Continut protejat: nimic nu se pune in cache-uri intermediare sau in browser.
  try { raspuns.headers.set("cache-control", "no-store"); } catch { /* antete imutabile (ex. assets) */ }
  return raspuns;
});
