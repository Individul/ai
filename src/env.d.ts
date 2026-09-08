/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindingurile Workerului (vezi ../wrangler.jsonc). Se citesc la runtime prin
// `import { env } from "cloudflare:workers"`. Interfata `Cloudflare.Env` se
// uneste peste declaratii, deci `env.DB` iese tipat ca D1Database.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    // Fisierele: PDF-uri sursa si Audio Overview-uri. Cheile: pdf/{sursa_id}, audio/{audio_id}.
    FISIERE: R2Bucket;
    // Configurate pe Worker dupa crearea aplicatiei Cloudflare Access.
    // Fara ele, orice ruta raspunde 503 (esueaza inchis).
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    // Adresele care pot intra la /admin, separate prin virgula. Goala = nimeni.
    ADMIN_EMAILS?: string;
    // Cheia Gemini API (secret pe Worker, .dev.vars local). Fara ea, chatul si indexarea raspund 503.
    GEMINI_API_KEY?: string;
    // Cheia Z.AI (secret pe Worker, .dev.vars local), pentru modelele GLM alese din Admin. Fara ea,
    // chatul pe GLM raspunde 503. ZAI_API_BASE e optional: implicit endpointul planului de coding.
    ZAI_API_KEY?: string;
    ZAI_API_BASE?: string;
    // Doar in .dev.vars, pentru dezvoltare locala. Ignorat in productie.
    DEV_EMAIL?: string;
  }
}

declare namespace App {
  interface Locals {
    // Emailul utilizatorului autentificat, pus de middleware pe fiecare cerere.
    email: string;
    // Adevarat cand emailul e in ADMIN_EMAILS. Tot middleware-ul blocheaza /admin* si /api/admin*.
    admin: boolean;
  }
}
