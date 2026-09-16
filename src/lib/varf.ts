// Textul despre orele de varf ale modelului activ (DeepSeek), in ora Chisinaului, pentru pagina culegerii,
// corector si Admin. Doar varful se anunta, fiindca atunci fiecare intrebare costa dublu; ora libera nu se mai
// scrie nicaieri (decizia lui Dumitru, 16 sept. 2026): e starea obisnuita, deci nu are ce spune omului.
import type { StareVarf } from "./validare";
import { FUS } from "./data";

export function textVarf(s: StareVarf | null): { activ: boolean; text: string } | null {
  if (!s?.activ || !s.panaLa) return null;
  const pana = s.panaLa.toLocaleTimeString("ro-RO", { timeZone: FUS, hour: "2-digit", minute: "2-digit" });
  return { activ: true, text: `Acum e oră de vârf la DeepSeek: fiecare întrebare costă de ${s.factor} ori mai mult, până la ${pana}.` };
}
