// Motorul aplicatiei: ruleaza scriptul corectorului (Resources/motor.mjs, impachetat din
// scripts/corecteaza-local.mts) cu node, in modul --json, si citeste evenimentele rand cu rand.
// Scriptul porneste, dupa motorul ales, Claude Code (`claude -p`) sau Antigravity (`agy -p`), logate cu
// conturile utilizatorului: folosire individuala a celor doua unelte, pe planurile lui. Aplicatia nu vede
// si nu pastreaza nicio cheie sau token.

import Foundation

enum MotorLocal: String, CaseIterable, Identifiable {
  case claude, gemini

  var id: String { rawValue }

  var nume: String {
    switch self {
    case .claude: return "Claude"
    case .gemini: return "Gemini"
    }
  }

  var descriere: String {
    switch self {
    case .claude: return "planul tău Claude"
    case .gemini: return "planul tău Google"
    }
  }

  // Comanda pe care o cauta aplicatia si numele uneltei, pentru mesaje.
  var unealta: String {
    switch self {
    case .claude: return "claude"
    case .gemini: return "agy"
    }
  }

  var numeUnealta: String {
    switch self {
    case .claude: return "Claude Code"
    case .gemini: return "Antigravity"
    }
  }

  var furnizor: String {
    switch self {
    case .claude: return "Anthropic"
    case .gemini: return "Google"
    }
  }

  var lipseste: String {
    switch self {
    case .claude: return "Nu găsesc Claude Code. Instalează-l, rulează o dată „claude” în Terminal ca să te loghezi cu contul tău, apoi repornește aplicația."
    case .gemini: return "Nu găsesc Antigravity. Instalează-l, rulează o dată „agy” în Terminal ca să te loghezi cu contul tău Google, apoi repornește aplicația."
    }
  }

  var modele: [ModelLocal] { ModelLocal.allCases.filter { $0.motor == self } }

  var modelImplicit: ModelLocal { modele.first ?? .opus }
}

enum ModelLocal: String, CaseIterable, Identifiable {
  case opus, sonnet, haiku, pro, flash

  var id: String { rawValue }

  var motor: MotorLocal {
    switch self {
    case .opus, .sonnet, .haiku: return .claude
    case .pro, .flash: return .gemini
    }
  }

  var nume: String {
    switch self {
    case .opus: return "Opus"
    case .sonnet: return "Sonnet"
    case .haiku: return "Haiku"
    case .pro: return "Pro"
    case .flash: return "Flash"
    }
  }

  var descriere: String {
    switch self {
    case .opus, .pro: return "cel mai atent"
    case .sonnet, .flash: return "mai rapid"
    case .haiku: return "cel mai rapid"
    }
  }
}

enum ModLucru: String, CaseIterable, Identifiable {
  case corectura, verificare

  var id: String { rawValue }

  var nume: String {
    switch self {
    case .corectura: return "Corectură"
    case .verificare: return "Verificare"
    }
  }

  var descriere: String {
    switch self {
    case .corectura: return "doar corpul, rapid"
    case .verificare: return "tot documentul, cu observații"
    }
  }
}

// Ce nu se poate repara prin inlocuire de text: date care se contrazic, rubrici goale, formatare rupta,
// indoieli juridice. Vine doar din modul verificare.
struct Observatie: Decodable, Hashable {
  let tip: String
  let text: String
  let solutie: String?  // ce propune modelul sa se faca

  var eticheta: String {
    switch tip {
    case "date": return "date care nu se potrivesc"
    case "juridic": return "de verificat juridic"
    case "formatare": return "formatare"
    case "lipsa": return "rubrică necompletată"
    default: return "de verificat"
    }
  }
}

struct Corectura: Decodable, Hashable {
  let stare: String   // aplicata | negasita | suprapusa | blocata
  let tip: String
  let vechi: String
  let nou: String
  let motiv: String
  let inainte: String
  let dupa: String

  var deVerificat: Bool { stare != "aplicata" }

  var explicatieStare: String? {
    switch stare {
    case "negasita": return "fragmentul nu a fost găsit exact în document"
    case "suprapusa": return "se suprapune cu altă corectură"
    case "blocata": return "textul e într-un câmp, într-o revizie existentă sau trece peste un tab"
    default: return nil
    }
  }
}

struct Rezultat: Decodable, Hashable {
  let iesire: String?
  let aplicate: Int
  let corecturi: [Corectura]
  let cost_usd: Double
  let secunde: Int
  let esecuri: [String]
  let observatii: [Observatie]?
  let motor: String?
  let model: String?
  let jetoane: Int?
  let mentiune: String? // prezenta | corectata | adaugata | de_verificat

  var deVerificat: Int { corecturi.filter(\.deVerificat).count }

  // Mentiunea despre datele cu caracter personal, doar cand s-a schimbat ceva; una deja in regula nu apare.
  var textMentiune: String? {
    switch mentiune {
    case "adaugata": return "mențiunea despre date personale adăugată"
    case "corectata": return "mențiunea despre date personale adusă la forma aprobată"
    case "de_verificat": return "mențiunea despre date personale de verificat"
    default: return nil
    }
  }
  var obs: [Observatie] { observatii ?? [] }

  // „Opus”, „Gemini Pro”: cu ce a fost facut, ca sa se compare doua treceri prin acelasi document.
  var eticheta: String? {
    guard let m = model.flatMap({ ModelLocal(rawValue: $0) }) else { return nil }
    return m.motor == .claude ? m.nume : "\(m.motor.nume) \(m.nume)"
  }
}

enum Eveniment {
  case inceput(loturi: Int)
  case progres(gata: Int, total: Int)
  case rezultat(Rezultat)
  case eroare(String)
  case stare(String) // de exemplu, Claude reincearca dupa o limita atinsa

  static func din(_ rand: Data) -> Eveniment? {
    struct Antet: Decodable {
      let tip: String
      let loturi: Int?
      let gata: Int?
      let total: Int?
      let mesaj: String?
    }
    guard let a = try? JSONDecoder().decode(Antet.self, from: rand) else { return nil }
    switch a.tip {
    case "inceput": return .inceput(loturi: a.loturi ?? 0)
    case "progres": return .progres(gata: a.gata ?? 0, total: a.total ?? 0)
    case "rezultat": return (try? JSONDecoder().decode(Rezultat.self, from: rand)).map { .rezultat($0) }
    case "eroare": return .eroare(a.mesaj ?? "eroare necunoscută")
    case "stare": return a.mesaj.map { .stare($0) }
    default: return nil
    }
  }
}

struct Unelte: Equatable {
  let node: String
  let claude: String?
  let agy: String?

  func cale(_ motor: MotorLocal) -> String? {
    switch motor {
    case .claude: return claude
    case .gemini: return agy
    }
  }
}

enum Motor {
  // O aplicatie pornita din Finder nu are PATH-ul din Terminal: cautam intr-un shell de login, apoi in
  // locurile obisnuite.
  static func gasesteUnelte() -> (node: String?, claude: String?, agy: String?) {
    var gasite: [String: String] = [:]
    let cautate = ["node", "claude", "agy"]
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", cautate.map { "echo \"\($0)=$(command -v \($0))\"" }.joined(separator: "; ")]
    let iesire = Pipe()
    p.standardOutput = iesire
    p.standardError = FileHandle.nullDevice
    p.standardInput = FileHandle.nullDevice
    if (try? p.run()) != nil {
      let date = iesire.fileHandleForReading.readDataToEndOfFile()
      p.waitUntilExit()
      for rand in String(decoding: date, as: UTF8.self).split(separator: "\n") {
        guard let egal = rand.firstIndex(of: "="), egal < rand.index(before: rand.endIndex) else { continue }
        gasite[String(rand[..<egal])] = String(rand[rand.index(after: egal)...])
      }
    }
    let fm = FileManager.default
    let acasa = fm.homeDirectoryForCurrentUser.path
    let obisnuite = ["\(acasa)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    for nume in cautate where gasite[nume].map({ !fm.isExecutableFile(atPath: $0) }) ?? true {
      gasite[nume] = obisnuite.map { "\($0)/\(nume)" }.first(where: fm.isExecutableFile(atPath:))
    }
    return (gasite["node"], gasite["claude"], gasite["agy"])
  }

  final class Lucrare: @unchecked Sendable {
    let proces = Process()
    private(set) var oprita = false

    func opreste() {
      oprita = true
      if proces.isRunning { proces.terminate() }
    }
  }

  // Corecteaza un document; evenimentele ajung pe firul principal. Intoarce mesajul de eroare daca
  // scriptul s-a oprit fara rezultat (altfel nil).
  static func corecteaza(
    fisier: URL, motor: MotorLocal, model: ModelLocal, mod: ModLucru, unelte: Unelte, script: URL, lucrare: Lucrare,
    laEveniment: @escaping @MainActor (Eveniment) -> Void
  ) async -> String? {
    guard let unealta = unelte.cale(motor) else { return motor.lipseste }
    let p = lucrare.proces
    p.executableURL = URL(fileURLWithPath: unelte.node)
    p.arguments = [script.path, "--json", "--motor", motor.rawValue, "--mod", mod.rawValue, "--model", model.rawValue, fisier.path]
    var mediu = ProcessInfo.processInfo.environment
    mediu[motor == .claude ? "CORECTOR_CLAUDE" : "CORECTOR_AGY"] = unealta
    let directoare = [unelte.node, unealta].map { URL(fileURLWithPath: $0).deletingLastPathComponent().path }
    mediu["PATH"] = (directoare + [mediu["PATH"] ?? "/usr/bin:/bin"]).joined(separator: ":")
    p.environment = mediu
    let iesire = Pipe()
    let erori = Pipe()
    p.standardOutput = iesire
    p.standardError = erori
    p.standardInput = FileHandle.nullDevice
    do {
      try p.run()
    } catch {
      return "Nu pot porni Node.js: \(error.localizedDescription)"
    }
    var incheiat = false
    do {
      for try await rand in iesire.fileHandleForReading.bytes.lines {
        guard let e = Eveniment.din(Data(rand.utf8)) else { continue }
        switch e {
        case .rezultat, .eroare: incheiat = true
        default: break
        }
        await laEveniment(e)
      }
    } catch {}
    p.waitUntilExit()
    if incheiat || lucrare.oprita { return nil }
    let text = String(decoding: erori.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? "Motorul s-a oprit fără rezultat (cod \(p.terminationStatus))." : String(text.suffix(400))
  }
}

// 1 corectură, 5 corecturi, 20 de corecturi (ca `numara` din src/lib/corector.ts).
func numara(_ n: Int, _ singular: String, _ plural: String) -> String {
  if n == 1 { return "1 \(singular)" }
  let rest = n % 100
  return "\(n)\(n >= 20 && (rest == 0 || rest >= 20) ? " de" : "") \(plural)"
}
