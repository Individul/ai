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
    var alese: Set<Int> = []   // observatiile la care ai ales soluția (sau le-ai bifat ca rezolvate)
    var reface = false         // documentul se scrie din nou, dupa o alegere

    var nume: String { url.lastPathComponent }

    var activ: Bool {
      switch stare {
      case .inAsteptare, .inLucru: return true
      default: return false
      }
    }
  }

  @Published var documente: [Document] = []
  // Motorul si modelul se tin minte, iar modelul separat pentru fiecare motor: trecerea de la Claude la
  // Gemini si inapoi pastreaza ce ai ales la fiecare.
  @Published var motor: MotorLocal = Corector.motorSalvat {
    didSet {
      UserDefaults.standard.set(motor.rawValue, forKey: "motor")
      if model.motor != motor { model = Corector.modelSalvat(motor) }
      problema = problemaUnelte()
    }
  }
  @Published var model: ModelLocal = Corector.modelSalvat(Corector.motorSalvat) {
    didSet { UserDefaults.standard.set(model.rawValue, forKey: "model-\(model.motor.rawValue)") }
  }
  @Published var mod: ModLucru = ModLucru(rawValue: UserDefaults.standard.string(forKey: "mod") ?? "") ?? .corectura {
    didSet { UserDefaults.standard.set(mod.rawValue, forKey: "mod") }
  }
  // Datele personale se ascund implicit; alegerea se tine minte, ca motorul si modelul.
  @Published var mascare: NivelMascare = NivelMascare(rawValue: UserDefaults.standard.string(forKey: "mascare") ?? "") ?? .tot {
    didSet { UserDefaults.standard.set(mascare.rawValue, forKey: "mascare") }
  }
  @Published var unelte: Unelte?
  @Published var problema: String?
  @Published var pregatit = false

  // Starea vederilor, in loc de @State (macro in SDK-ul macOS 26, compilabil doar cu Xcode).
  @Published var peste = false
  @Published var alegeFisiere = false
  @Published var desfacute: Set<UUID> = []

  // Alegerea de la o observatie. Soluțiile care se pot pune in text rescriu documentul; celelalte sunt doar
  // o bifa pentru tine, ca sa stii ce ai rezolvat de mana.
  func comutaObservatie(_ id: UUID, _ k: Int) {
    guard let index = documente.firstIndex(where: { $0.id == id }), case .gata(let r) = documente[index].stare else { return }
    if documente[index].alese.contains(k) { documente[index].alese.remove(k) } else { documente[index].alese.insert(k) }
    if r.obs.indices.contains(k), r.obs[k].corectura != nil { rescrie(id) }
  }

  private func rescrie(_ id: UUID) {
    guard let unelte, let script, let k = documente.firstIndex(where: { $0.id == id }), case .gata(let r) = documente[k].stare else { return }
    let document = documente[k]
    let solutii = document.alese.sorted().compactMap { j -> CorecturaPlan? in
      guard r.obs.indices.contains(j), let c = r.obs[j].corectura else { return nil }
      return CorecturaPlan(i: c.i, vechi: c.vechi, nou: c.nou, tip: "formulare", motiv: r.obs[j].solutie ?? "")
    }
    modifica(id) { $0.reface = true }
    Task {
      let nou = await Motor.reaplica(fisier: document.url, rezultat: r, solutii: solutii, unelte: unelte, script: script)
      modifica(id) { d in
        d.reface = false
        if let nou { d.stare = .gata(r.dupaRescriere(nou)) }
      }
    }
  }

  func comuta(_ id: UUID) {
    if desfacute.contains(id) { desfacute.remove(id) } else { desfacute.insert(id) }
  }

  static var motorSalvat: MotorLocal {
    MotorLocal(rawValue: UserDefaults.standard.string(forKey: "motor") ?? "") ?? .claude
  }

  static func modelSalvat(_ motor: MotorLocal) -> ModelLocal {
    let salvat = ModelLocal(rawValue: UserDefaults.standard.string(forKey: "model-\(motor.rawValue)") ?? "")
    return salvat?.motor == motor ? salvat! : motor.modelImplicit
  }

  var script: URL? = Bundle.main.url(forResource: "motor", withExtension: "mjs")
  private var lucrareCurenta: (id: UUID, lucrare: Motor.Lucrare)?
  private var ruleaza = false

  func pregateste() async {
    let gasite = await Task.detached { Motor.gasesteUnelte() }.value
    if let node = gasite.node { unelte = Unelte(node: node, claude: gasite.claude, agy: gasite.agy) }
    pregatit = true
    problema = problemaUnelte()
    porneste()
  }

  // Lipsa uneltei motorului ales nu blocheaza aplicatia: celalalt motor merge mai departe.
  private func problemaUnelte() -> String? {
    if script == nil { return "Lipsește motorul corectorului din aplicație (motor.mjs). Reconstruiește aplicația cu „npm run mac”." }
    guard let unelte else { return "Nu găsesc Node.js. Instalează-l de pe nodejs.org, apoi repornește aplicația." }
    return unelte.cale(motor) == nil ? motor.lipseste : nil
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
      let eroare = await Motor.corecteaza(
        fisier: document.url, motor: motor, model: model, mod: mod, mascare: mascare, unelte: unelte,
        script: script, lucrare: lucrare
      ) { [weak self] e in
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
