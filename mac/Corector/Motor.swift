// Motorul aplicatiei: ruleaza scriptul corectorului (Resources/motor.mjs, impachetat din
// scripts/corecteaza-local.mts) cu node, in modul --json, si citeste evenimentele rand cu rand.
// Scriptul porneste Claude Code (`claude -p`) logat cu contul utilizatorului: folosire individuala a
// Claude Code, pe planul lui. Aplicatia nu vede si nu pastreaza nicio cheie sau token.

import Foundation

enum ModelClaude: String, CaseIterable, Identifiable {
  case opus, sonnet, haiku

  var id: String { rawValue }

  var nume: String {
    switch self {
    case .opus: return "Opus"
    case .sonnet: return "Sonnet"
    case .haiku: return "Haiku"
    }
  }

  var descriere: String {
    switch self {
    case .opus: return "cel mai atent"
    case .sonnet: return "mai rapid"
    case .haiku: return "cel mai rapid"
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

  var deVerificat: Int { corecturi.filter(\.deVerificat).count }
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
  let claude: String
}

enum Motor {
  // O aplicatie pornita din Finder nu are PATH-ul din Terminal: cautam intr-un shell de login, apoi in
  // locurile obisnuite.
  static func gasesteUnelte() -> (node: String?, claude: String?) {
    var node: String?
    var claude: String?
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", "echo \"NODE=$(command -v node)\"; echo \"CLAUDE=$(command -v claude)\""]
    let iesire = Pipe()
    p.standardOutput = iesire
    p.standardError = FileHandle.nullDevice
    p.standardInput = FileHandle.nullDevice
    if (try? p.run()) != nil {
      let date = iesire.fileHandleForReading.readDataToEndOfFile()
      p.waitUntilExit()
      for rand in String(decoding: date, as: UTF8.self).split(separator: "\n") {
        if rand.hasPrefix("NODE="), rand.count > 5 { node = String(rand.dropFirst(5)) }
        if rand.hasPrefix("CLAUDE="), rand.count > 7 { claude = String(rand.dropFirst(7)) }
      }
    }
    let fm = FileManager.default
    let acasa = fm.homeDirectoryForCurrentUser.path
    if node.map({ !fm.isExecutableFile(atPath: $0) }) ?? true {
      node = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].first(where: fm.isExecutableFile(atPath:))
    }
    if claude.map({ !fm.isExecutableFile(atPath: $0) }) ?? true {
      claude = ["\(acasa)/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].first(where: fm.isExecutableFile(atPath:))
    }
    return (node, claude)
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
    fisier: URL, model: ModelClaude, unelte: Unelte, script: URL, lucrare: Lucrare,
    laEveniment: @escaping @MainActor (Eveniment) -> Void
  ) async -> String? {
    let p = lucrare.proces
    p.executableURL = URL(fileURLWithPath: unelte.node)
    p.arguments = [script.path, "--json", "--model", model.rawValue, fisier.path]
    var mediu = ProcessInfo.processInfo.environment
    mediu["CORECTOR_CLAUDE"] = unelte.claude
    let directoare = [unelte.node, unelte.claude].map { URL(fileURLWithPath: $0).deletingLastPathComponent().path }
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
