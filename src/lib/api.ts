// Ajutoare pentru rutele JSON. Toate raspunsurile sunt no-store: sunt date personale.

const ANTETE_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(date: unknown, status = 200): Response {
  return new Response(JSON.stringify(date), { status, headers: ANTETE_JSON });
}

export function eroare(status: number, mesaj: string, extra: Record<string, unknown> = {}): Response {
  return json({ eroare: mesaj, ...extra }, status);
}

// Corpul cererii ca JSON. Cere `Content-Type: application/json`: un formular HTML de pe
// alt site nu poate trimite acest tip fara CORS preflight, deci e si protectie CSRF.
export async function citesteJson<T>(req: Request): Promise<{ ok: true; date: T } | { ok: false; raspuns: Response }> {
  const tip = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(tip)) {
    return { ok: false, raspuns: eroare(415, "Cererea trebuie să aibă Content-Type: application/json.") };
  }
  try {
    return { ok: true, date: (await req.json()) as T };
  } catch {
    return { ok: false, raspuns: eroare(400, "JSON invalid.") };
  }
}
