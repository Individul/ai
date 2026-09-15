// Starea aplicatiei: lista documentelor, modelul ales, uneltele gasite. Documentele se corecteaza pe rand,
// unul cate unul; in interiorul unui document, scriptul trimite partile in paralel.

import Foundation
import SwiftUI

@MainActor
final class Corector: ObservableObject {
  static let comun = Corector()

  enum StareDocument: Equatable {
    case inAsteptare
    case inLucru(gata: Int, total: Int)
    case gata(Rezultat)
    case eroare(String)
    case oprit
  }

  struct Document: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    var stare: StareDocument = .inAsteptare
    var inceputLa: Date?
    var nota: String?

    var nume: String { url.lastPathComponent }

    var activ: Bool {
      switch stare {
      case .inAsteptare, .inLucru: return true
      default: return false
      }
    }
  }

  @Published var documente: [Document] = []
  @Published var model: ModelClaude = ModelClaude(rawValue: UserDefaults.standard.string(forKey: "model") ?? "") ?? .opus {
    didSet { UserDefaults.standard.set(model.rawValue, forKey: "model") }
  }
  @Published var mod: ModLucru = ModLucru(rawValue: UserDefaults.standard.string(forKey: "mod") ?? "") ?? .corectura {
    didSet { UserDefaults.standard.set(mod.rawValue, forKey: "mod") }
  }
  @Published var unelte: Unelte?
  @Published var problema: String?
  @Published var pregatit = false

  // Starea vederilor, in loc de @State (macro in SDK-ul macOS 26, compilabil doar cu Xcode).
  @Published var peste = false
  @Published var alegeFisiere = false
  @Published var desfacute: Set<UUID> = []

  func comuta(_ id: UUID) {
    if desfacute.contains(id) { desfacute.remove(id) } else { desfacute.insert(id) }
  }

  var script: URL? = Bundle.main.url(forResource: "motor", withExtension: "mjs")
  private var lucrareCurenta: (id: UUID, lucrare: Motor.Lucrare)?
  private var ruleaza = false

  func pregateste() async {
    let gasite = await Task.detached { Motor.gasesteUnelte() }.value
    if let node = gasite.node, let claude = gasite.claude {
      unelte = Unelte(node: node, claude: claude)
      problema = nil
    } else if gasite.node == nil {
      problema = "Nu găsesc Node.js. Instalează-l de pe nodejs.org, apoi repornește aplicația."
    } else {
      problema = "Nu găsesc Claude Code. Instalează-l, rulează o dată „claude” în Terminal ca să te loghezi cu contul tău, apoi repornește aplicația."
    }
    if script == nil { problema = "Lipsește motorul corectorului din aplicație (motor.mjs). Reconstruiește aplicația cu „npm run mac”." }
    pregatit = true
    porneste()
  }

  func adauga(_ urls: [URL]) {
    let deja = Set(documente.filter(\.activ).map(\.url.standardizedFileURL))
    let noi = urls
      .map(\.standardizedFileURL)
      .filter { $0.pathExtension.lowercased() == "docx" && !$0.lastPathComponent.hasPrefix("~$") && !deja.contains($0) }
    documente.append(contentsOf: noi.map { Document(url: $0) })
    porneste()
  }

  func reincearca(_ id: UUID) {
    actualizeaza(id, .inAsteptare)
    porneste()
  }

  func opreste(_ id: UUID) {
    if lucrareCurenta?.id == id { lucrareCurenta?.lucrare.opreste() } else { actualizeaza(id, .oprit) }
  }

  func scoate(_ id: UUID) {
    if lucrareCurenta?.id == id { lucrareCurenta?.lucrare.opreste() }
    documente.removeAll { $0.id == id }
  }

  func curataTerminate() {
    documente.removeAll { !$0.activ }
  }

  private func porneste() {
    guard !ruleaza, pregatit, let unelte, let script else { return }
    ruleaza = true
    Task {
      await proceseaza(unelte: unelte, script: script)
      ruleaza = false
      if documente.contains(where: { $0.stare == .inAsteptare }) { porneste() }
    }
  }

  private func proceseaza(unelte: Unelte, script: URL) async {
    while let document = documente.first(where: { $0.stare == .inAsteptare }) {
      let id = document.id
      let lucrare = Motor.Lucrare()
      lucrareCurenta = (id, lucrare)
      actualizeaza(id, .inLucru(gata: 0, total: 0))
      modifica(id) {
        $0.inceputLa = Date()
        $0.nota = nil
      }
      let eroare = await Motor.corecteaza(fisier: document.url, model: model, mod: mod, unelte: unelte, script: script, lucrare: lucrare) { [weak self] e in
        guard let self else { return }
        switch e {
        case .inceput(let loturi): self.actualizeaza(id, .inLucru(gata: 0, total: loturi))
        case .progres(let gata, let total):
          self.actualizeaza(id, .inLucru(gata: gata, total: total))
          self.modifica(id) { $0.nota = nil }
        case .rezultat(let r): self.actualizeaza(id, .gata(r))
        case .eroare(let mesaj): self.actualizeaza(id, .eroare(mesaj))
        case .stare(let mesaj): self.modifica(id) { $0.nota = mesaj }
        }
      }
      lucrareCurenta = nil
      if lucrare.oprita {
        actualizeaza(id, .oprit)
      } else if let eroare {
        actualizeaza(id, .eroare(eroare))
      }
    }
  }

  private func modifica(_ id: UUID, _ schimbare: (inout Document) -> Void) {
    guard let k = documente.firstIndex(where: { $0.id == id }) else { return }
    schimbare(&documente[k])
  }

  private func actualizeaza(_ id: UUID, _ stare: StareDocument) {
    guard let k = documente.firstIndex(where: { $0.id == id }) else { return }
    documente[k].stare = stare
  }
}
