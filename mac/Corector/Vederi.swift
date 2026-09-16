// Interfata: alegerea modelului, zona in care se trag documentele, lista lor cu progres si corecturi.
// Culorile sunt ale hub-ului (violet, coral, verde, galben), in ambele teme. Controalele sunt desenate
// cu forme SwiftUI, nu cu controale AppKit, ca ecranele sa se poata randa si in imagini (utilitarul
// mac/Instantanee), pentru verificare. Fara @State: in SDK-ul macOS 26 e macro, iar implementarea lui vine
// doar cu Xcode; starea vederilor (peste, alegeFisiere, desfacute) sta in Corector.

import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct Paleta {
  let schema: ColorScheme

  private func c(_ luminos: UInt32, _ intunecat: UInt32, _ alfa: Double = 1) -> Color {
    let v = schema == .dark ? intunecat : luminos
    return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: alfa)
  }

  var fundal: Color { c(0xF7F5FA, 0x16121D) }
  var card: Color { c(0xFFFFFF, 0x1E1927) }
  var text: Color { c(0x1A1523, 0xF4EFF8) }
  var text2: Color { c(0x3F3750, 0xC9C0D6) }
  var estompat: Color { c(0x6B6280, 0xA99FB8) }
  var sters: Color { c(0x9A92AA, 0x6E6580) }
  var linie: Color { c(0x1A1523, 0xF4EFF8, 0.10) }
  var violet: Color { c(0x7A55D6, 0xB393F2) }
  var peAccent: Color { c(0xFFFFFF, 0x16121D) }
  var coral: Color { c(0xD9634A, 0xF4876A) }
  var verde: Color { c(0x2E9E63, 0x6FE3A5) }
  var galben: Color { c(0xB9861B, 0xF2C25B) }
}

// ---------------------------------------------------------------- fereastra

struct Fereastra: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema

  var body: some View {
    ScrollView {
      Continut(peste: corector.peste, alege: { corector.alegeFisiere = true })
        .padding(28)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
    }
    .background(Paleta(schema: schema).fundal)
    .onDrop(of: [.fileURL], isTargeted: $corector.peste) { furnizori in
      for f in furnizori {
        _ = f.loadObject(ofClass: URL.self) { url, _ in
          if let url { Task { @MainActor in Corector.comun.adauga([url]) } }
        }
      }
      return true
    }
    .fileImporter(isPresented: $corector.alegeFisiere, allowedContentTypes: [UTType(filenameExtension: "docx") ?? .data], allowsMultipleSelection: true) { rezultat in
      if case .success(let urls) = rezultat { corector.adauga(urls) }
    }
  }
}

struct Continut: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema
  let peste: Bool
  let alege: () -> Void
  var desfaCorecturile = false // doar pentru imaginile de verificare

  var body: some View {
    let p = Paleta(schema: schema)
    VStack(alignment: .leading, spacing: 20) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          Text("Corector").font(.system(size: 30, weight: .semibold, design: .rounded)).foregroundStyle(p.text)
          Text(".").font(.system(size: 30, weight: .semibold, design: .rounded)).foregroundStyle(p.violet)
        }
        Text("Trage un document Word, iar \(corector.motor.nume) îl corectează: ortografie, gramatică, punctuație și frazele greoaie. Primești același document, cu fiecare corectură ca modificare urmărită în Word.")
          .font(.system(size: 14)).foregroundStyle(p.text2).fixedSize()
      }

      AlegereMod()
      AlegereMotor()
      AlegereModel()
      AlegereMascare()

      if let problema = corector.problema {
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(p.galben)
          Text(problema).font(.system(size: 13)).foregroundStyle(p.text).fixedSize()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(p.galben.opacity(0.14)))
      }

      Button(action: alege) {
        VStack(spacing: 6) {
          Image(systemName: "doc.badge.plus").font(.system(size: 30, weight: .regular)).foregroundStyle(p.violet)
          Text("Trage aici documente Word").font(.system(size: 15, weight: .semibold)).foregroundStyle(p.violet)
          Text("sau apasă ca să alegi fișiere .docx").font(.system(size: 12.5)).foregroundStyle(p.estompat)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .background(RoundedRectangle(cornerRadius: 16).fill(p.violet.opacity(peste ? 0.14 : 0.06)))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(p.violet.opacity(peste ? 0.9 : 0.45), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if !corector.documente.isEmpty {
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text("Documente").font(.system(size: 17, weight: .semibold, design: .rounded)).foregroundStyle(p.text)
            Spacer()
            if corector.documente.contains(where: { !$0.activ }) {
              ButonText(titlu: "curăță lista", culoare: p.estompat) { corector.curataTerminate() }
            }
          }
          ForEach(corector.documente) { d in
            RandDocument(document: d, desfaTot: desfaCorecturile)
          }
        }
      }

      Text("Folosește \(corector.motor.numeUnealta) logat cu contul tău, deci \(corector.motor.descriere). Textul documentelor ajunge la \(corector.motor.furnizor), cu datele personale înlocuite mai întâi cu date false; se pun la loc aici, la tine. Nu e anonimizare: restul actului pleacă așa cum e, iar numele din partea rusă a antetului nu se maschează. Documentul corectat se salvează lângă original, cu „(corectat)” în nume; originalul rămâne neatins.")
        .font(.system(size: 11.5)).foregroundStyle(p.sters).fixedSize()
    }
  }
}

private extension Text {
  func fixedSize() -> some View { fixedSize(horizontal: false, vertical: true) }
}

// ---------------------------------------------------------------- componente

// Randul de alegere (mod, model): capsule desenate, nu Picker, ca sa se randeze si in imagini.
struct Capsula: View {
  @Environment(\.colorScheme) private var schema
  let titlu: String
  let descriere: String
  let ales: Bool
  let apasa: () -> Void

  var body: some View {
    let p = Paleta(schema: schema)
    Button(action: apasa) {
      HStack(spacing: 5) {
        Text(titlu).font(.system(size: 13, weight: .semibold))
        Text(descriere).font(.system(size: 11.5)).opacity(0.8)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .foregroundStyle(ales ? p.peAccent : p.text2)
      .background(Capsule().fill(ales ? p.violet : p.linie))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

struct AlegereMod: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema

  var body: some View {
    let p = Paleta(schema: schema)
    HStack(spacing: 8) {
      Text("Mod").font(.system(size: 12, weight: .bold)).textCase(.uppercase).foregroundStyle(p.sters).frame(width: 46, alignment: .leading)
      ForEach(ModLucru.allCases) { m in
        Capsula(titlu: m.nume, descriere: m.descriere, ales: m == corector.mod) { corector.mod = m }
      }
    }
  }
}

struct AlegereMotor: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema

  var body: some View {
    let p = Paleta(schema: schema)
    HStack(spacing: 8) {
      Text("Motor").font(.system(size: 12, weight: .bold)).textCase(.uppercase).foregroundStyle(p.sters).frame(width: 46, alignment: .leading)
      ForEach(MotorLocal.allCases) { m in
        Capsula(titlu: m.nume, descriere: m.descriere, ales: m == corector.motor) { corector.motor = m }
      }
    }
  }
}

struct AlegereModel: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema

  var body: some View {
    let p = Paleta(schema: schema)
    HStack(spacing: 8) {
      Text("Model").font(.system(size: 12, weight: .bold)).textCase(.uppercase).foregroundStyle(p.sters).frame(width: 46, alignment: .leading)
      ForEach(corector.motor.modele) { m in
        Capsula(titlu: m.nume, descriere: m.descriere, ales: m == corector.model) { corector.model = m }
      }
    }
  }
}

// Ce se ascunde inainte ca textul sa plece la model. Implicit, tot: si numele, si identificatorii.
struct AlegereMascare: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema

  var body: some View {
    let p = Paleta(schema: schema)
    HStack(spacing: 8) {
      Text("Date").font(.system(size: 12, weight: .bold)).textCase(.uppercase).foregroundStyle(p.sters).frame(width: 46, alignment: .leading)
      ForEach(NivelMascare.allCases) { m in
        Capsula(titlu: m.nume, descriere: m.descriere, ales: m == corector.mascare) { corector.mascare = m }
      }
    }
  }
}

struct ButonText: View {
  let titlu: String
  let culoare: Color
  var iconita: String?
  let actiune: () -> Void

  var body: some View {
    Button(action: actiune) {
      HStack(spacing: 4) {
        if let iconita { Image(systemName: iconita) }
        Text(titlu)
      }
      .font(.system(size: 12.5, weight: .semibold))
      .foregroundStyle(culoare)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

struct ButonPrincipal: View {
  @Environment(\.colorScheme) private var schema
  let titlu: String
  let actiune: () -> Void

  var body: some View {
    let p = Paleta(schema: schema)
    Button(action: actiune) {
      Text(titlu)
        .font(.system(size: 12.5, weight: .semibold))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .foregroundStyle(p.peAccent)
        .background(Capsule().fill(p.violet))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

struct BaraProgres: View {
  let fractie: Double
  let culoare: Color
  let fundal: Color

  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(fundal)
        Capsule().fill(culoare).frame(width: max(6, g.size.width * min(max(fractie, 0), 1)))
      }
    }
    .frame(height: 5)
  }
}

struct RandDocument: View {
  @EnvironmentObject private var corector: Corector
  @Environment(\.colorScheme) private var schema
  let document: Corector.Document
  var desfaTot = false

  private var deschis: Bool { desfaTot || corector.desfacute.contains(document.id) }

  var body: some View {
    let p = Paleta(schema: schema)
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        Image(systemName: iconita).font(.system(size: 20)).foregroundStyle(culoareIconita(p)).frame(width: 24)
        VStack(alignment: .leading, spacing: 2) {
          Text(document.nume).font(.system(size: 14, weight: .semibold)).foregroundStyle(p.text).lineLimit(1).truncationMode(.middle)
          if document.activ, document.inceputLa != nil {
            TimelineView(.periodic(from: .now, by: 1)) { context in
              Text(descriere(acum: context.date)).font(.system(size: 12.5)).foregroundStyle(culoareDescriere(p)).fixedSize(horizontal: false, vertical: true)
            }
          } else {
            Text(descriere(acum: Date())).font(.system(size: 12.5)).foregroundStyle(culoareDescriere(p)).fixedSize(horizontal: false, vertical: true)
          }
        }
        Spacer(minLength: 8)
        actiuni(p)
      }
      if case .inLucru(let gata, let total) = document.stare {
        BaraProgres(fractie: total > 0 ? Double(gata) / Double(total) : 0.04, culoare: p.violet, fundal: p.linie)
      }
      if case .gata(let r) = document.stare, !r.obs.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(r.obs.enumerated()), id: \.offset) { k, o in
            RandObservatie(o: o, aleasa: document.alese.contains(k), reface: document.reface) {
              corector.comutaObservatie(document.id, k)
            }
          }
        }
      }
      if case .gata(let r) = document.stare, !r.corecturi.isEmpty {
        ButonText(titlu: deschis ? "ascunde corecturile" : "arată corecturile (\(r.corecturi.count))", culoare: p.violet, iconita: deschis ? "chevron.down" : "chevron.right") {
          corector.comuta(document.id)
        }
        if deschis {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(r.corecturi.enumerated()), id: \.offset) { _, c in
              RandCorectura(c: c)
            }
          }
        }
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 14).fill(p.card))
    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(p.linie))
  }

  @ViewBuilder private func actiuni(_ p: Paleta) -> some View {
    HStack(spacing: 14) {
      switch document.stare {
      case .inAsteptare, .inLucru:
        ButonText(titlu: "oprește", culoare: p.estompat) { corector.opreste(document.id) }
      case .gata(let r):
        if let iesire = r.iesire {
          ButonText(titlu: "Finder", culoare: p.estompat, iconita: "folder") {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: iesire)])
          }
          ButonPrincipal(titlu: "Deschide în Word") { deschideInWord(iesire) }
        }
      case .eroare, .oprit:
        ButonText(titlu: "reîncearcă", culoare: p.violet) { corector.reincearca(document.id) }
      }
      if !document.activ {
        Button { corector.scoate(document.id) } label: {
          Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(p.sters).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Scoate din listă")
      }
    }
  }

  private var iconita: String {
    switch document.stare {
    case .inAsteptare: return "clock"
    case .inLucru: return "text.magnifyingglass"
    case .gata(let r): return r.iesire != nil ? "checkmark.circle.fill" : "checkmark.circle"
    case .eroare: return "exclamationmark.circle.fill"
    case .oprit: return "stop.circle"
    }
  }

  private func culoareIconita(_ p: Paleta) -> Color {
    switch document.stare {
    case .gata: return p.verde
    case .eroare: return p.coral
    case .inLucru: return p.violet
    default: return p.sters
    }
  }

  private func culoareDescriere(_ p: Paleta) -> Color {
    if case .eroare = document.stare { return p.coral }
    return p.estompat
  }

  private func durata(_ secunde: Int) -> String {
    secunde < 60 ? "\(secunde) s" : "\(secunde / 60) min \(secunde % 60) s"
  }

  private func descriere(acum: Date) -> String {
    switch document.stare {
    case .inAsteptare:
      return "În așteptare"
    case .inLucru(let gata, let total):
      var parti = [total == 0 ? "Se citește documentul…" : "Se corectează: \(gata) din \(numara(total, "parte", "părți"))"]
      if let inceput = document.inceputLa { parti.append(durata(max(0, Int(acum.timeIntervalSince(inceput))))) }
      if let nota = document.nota { parti.append(nota) }
      return parti.joined(separator: " · ")
    case .gata(let r):
      var parti: [String] = []
      if r.aplicate > 0 {
        parti.append("\(numara(r.aplicate, "corectură", "corecturi")) ca modificări urmărite")
      } else {
        parti.append(r.deVerificat > 0 ? "Nicio corectură nu a putut fi pusă automat" : "Nu am găsit greșeli")
      }
      if r.deVerificat > 0 { parti.append("\(r.deVerificat) de verificat") }
      if !r.obs.isEmpty { parti.append(numara(r.obs.count, "observație", "observații")) }
      if let mentiune = r.textMentiune { parti.append(mentiune) }
      if let mascare = r.textMascare { parti.append(mascare) }
      if !r.esecuri.isEmpty { parti.append("\(numara(r.esecuri.count, "parte nereușită", "părți nereușite"))") }
      parti.append(durata(r.secunde))
      if let eticheta = r.eticheta { parti.append(eticheta) }
      return parti.joined(separator: " · ")
    case .eroare(let mesaj):
      return mesaj
    case .oprit:
      return "Oprit"
    }
  }

  private func deschideInWord(_ cale: String) {
    let url = URL(fileURLWithPath: cale)
    if let word = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.microsoft.Word") {
      NSWorkspace.shared.open([url], withApplicationAt: word, configuration: NSWorkspace.OpenConfiguration())
    } else {
      NSWorkspace.shared.open(url)
    }
  }
}

struct RandCorectura: View {
  @Environment(\.colorScheme) private var schema
  let c: Corectura

  var body: some View {
    let p = Paleta(schema: schema)
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 10) {
        Text(c.tip).font(.system(size: 10.5, weight: .bold)).textCase(.uppercase).foregroundStyle(p.sters)
        if let e = c.explicatieStare {
          Text("de verificat: \(e)").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(p.galben)
        }
      }
      Text(fragment(p)).font(.system(size: 13.5)).fixedSize(horizontal: false, vertical: true)
      if !c.motiv.isEmpty {
        Text(c.motiv).font(.system(size: 12)).foregroundStyle(p.estompat).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, 9)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .top) { Rectangle().fill(p.linie).frame(height: 1) }
  }

  private func fragment(_ p: Paleta) -> AttributedString {
    // Contextul taiat la cuvinte intregi; spatiile de langa fragment raman.
    var inceput = c.inainte
    if inceput.count >= 40, let r = inceput.range(of: " ") { inceput = "…" + String(inceput[r.upperBound...]) }
    var sfarsit = c.dupa
    if sfarsit.count >= 40, let r = sfarsit.range(of: " ", options: .backwards), r.lowerBound > sfarsit.startIndex {
      sfarsit = String(sfarsit[..<r.lowerBound]) + "…"
    }
    var a = AttributedString(inceput)
    a.foregroundColor = p.text2
    var vechi = AttributedString(c.vechi)
    vechi.foregroundColor = p.coral
    vechi.strikethroughStyle = .single
    vechi.backgroundColor = p.coral.opacity(0.10)
    var nou = AttributedString(c.nou)
    nou.foregroundColor = p.verde
    nou.backgroundColor = p.verde.opacity(0.12)
    var dupa = AttributedString(sfarsit)
    dupa.foregroundColor = p.text2
    a.append(vechi)
    a.append(AttributedString(" "))
    a.append(nou)
    a.append(dupa)
    return a
  }
}


// Observatia, cu alegerea ei: soluțiile care se pot pune in text intra in document cand le accepti (documentul
// se scrie din nou), iar celelalte se bifeaza dupa ce le rezolvi de mana.
struct RandObservatie: View {
  @Environment(\.colorScheme) private var schema
  let o: Observatie
  var aleasa = false
  var reface = false
  var comuta: () -> Void = {}

  var body: some View {
    let p = Paleta(schema: schema)
    let aplicabila = o.corectura != nil
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: aleasa ? "checkmark.circle.fill" : "exclamationmark.bubble")
        .font(.system(size: 12)).foregroundStyle(aleasa ? p.verde : p.galben).padding(.top, 2)
      VStack(alignment: .leading, spacing: 3) {
        Text(o.eticheta).font(.system(size: 10.5, weight: .bold)).textCase(.uppercase).foregroundStyle(aleasa ? p.verde : p.galben)
        Text(o.text).font(.system(size: 13)).foregroundStyle(p.text2).fixedSize(horizontal: false, vertical: true)
        if let solutie = o.solutie, !solutie.isEmpty {
          (Text("Soluție: ").foregroundStyle(p.verde) + Text(solutie).foregroundStyle(p.text2))
            .font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
        }
        if !aplicabila {
          Text("Nu se poate pune automat: completează tu în document, apoi bifează.")
            .font(.system(size: 11.5)).foregroundStyle(p.sters).fixedSize(horizontal: false, vertical: true)
        }
        HStack(spacing: 8) {
          Capsula(titlu: aplicabila ? "Acceptă soluția" : "Am rezolvat", descriere: "", ales: aleasa) { if !aleasa { comuta() } }
          Capsula(titlu: aplicabila ? "Lasă cum e" : "Încă nu", descriere: "", ales: !aleasa) { if aleasa { comuta() } }
          if reface { Text("se rescrie documentul…").font(.system(size: 11.5)).foregroundStyle(p.estompat) }
        }
        .padding(.top, 2)
      }
      .opacity(aleasa && !aplicabila ? 0.65 : 1)
    }
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .top) { Rectangle().fill(p.linie).frame(height: 1) }
  }
}
