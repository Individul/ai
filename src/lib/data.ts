// Ajutoare de data. Workerul ruleaza in UTC; datele se afiseaza in fusul Moldovei.

export const FUS = "Europe/Chisinau";

// D1 scrie "YYYY-MM-DD HH:MM:SS" in UTC; normalizam inainte de parsare.
export function parseDbDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(/[T]/.test(iso) ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

// "8 septembrie 2026" pentru o zi YYYY-MM-DD (fara fus: ziua e cea scrisa).
export function fmtZi(data: string): string {
  return new Date(`${data}T12:00:00Z`).toLocaleDateString("ro-RO", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  });
}

// "8 sept. 2026, 10:42" pentru un moment ISO, in fusul Chisinau.
export function fmtMoment(iso: string): string {
  const d = parseDbDate(iso);
  if (!d) return "";
  return d.toLocaleString("ro-RO", {
    timeZone: FUS, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// "2026-09-08" pentru azi, in fusul Chisinau (valoarea implicita a campului de data).
export function aziChisinau(acum: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUS, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(acum);
}

// Ziua cu `n` zile inainte, pe UTC (zilele sunt siruri YYYY-MM-DD fara fus).
export function ziMinus(zi: string, n: number): string {
  const [a, l, z] = zi.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, l - 1, z - n)).toISOString().slice(0, 10);
}
