// Textul despre orele de varf ale modelului activ (DeepSeek), in ora Chisinaului, pentru pagina
// culegerii si pentru Admin. Null cand modelul nu are ore de varf.
import type { StareVarf } from "./validare";
import { FUS, fmtIntervale } from "./data";

export function textVarf(s: StareVarf | null, moment: Date = new Date()): { activ: boolean; text: string } | null {
  if (!s) return null;
  const zile = s.doar_lucratoare ? ", luni–vineri" : "";
  if (s.activ && s.panaLa) {
    const pana = s.panaLa.toLocaleTimeString("ro-RO", { timeZone: FUS, hour: "2-digit", minute: "2-digit" });
    return { activ: true, text: `Acum e oră de vârf la DeepSeek: fiecare întrebare costă de ${s.factor} ori mai mult, până la ${pana}.` };
  }
  return { activ: false, text: `Oră liberă la DeepSeek. Prețul se dublează la orele de vârf: ${fmtIntervale(s.intervale, moment)}${zile}.` };
}
