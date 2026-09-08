// Cine poate scrie. ADMIN_EMAILS e o lista separata prin virgula; lista goala sau lipsa
// inseamna ca nimeni nu e admin (esueaza inchis). Comparatia e pe emailul normalizat.

export function listaAdmini(lista: string | undefined): string[] {
  return (lista ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function esteAdmin(email: string, lista: string | undefined): boolean {
  const e = email.trim().toLowerCase();
  return e.length > 0 && listaAdmini(lista).includes(e);
}
