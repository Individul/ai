// GET /api/chat/ramase — cate intrebari mai are utilizatorul curent azi.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { intrebariAzi, limitaPentru } from "../../../lib/consum";
import { aziChisinau } from "../../../lib/data";
import { json } from "../../../lib/api";

export const GET: APIRoute = async ({ locals }) => {
  const zi = aziChisinau();
  const [folosite, limita] = await Promise.all([intrebariAzi(env.DB, locals.email, zi), limitaPentru(env.DB, locals.email)]);
  return json({ ramase: Math.max(0, limita - folosite), limita, folosite });
};
