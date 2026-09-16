// Utilitarul de verificare al aplicatiei (nu intra in Corector.app):
//   instantanee --icon <dir.iconset>                    iconita, la toate marimile
//   instantanee --ecrane <dir>                          fereastra in stari de exemplu, tema alba si intunecata
//   instantanee --cap-la-cap <doc.docx> <motor.mjs> <unealta> <dir> [--motor claude|gemini]
//                                                       corecteaza documentul prin Motor, cu `claude`-ul sau
//                                                       `agy`-ul dat (in teste, unul fals), si randeaza rezultatul
// Randarea foloseste ImageRenderer, deci nu cere permisiunea de captura a ecranului.

import AppKit
import SwiftUI

@MainActor
func scriePNG<V: View>(_ vedere: V, _ cale: String, scala: CGFloat = 2) {
  let r = ImageRenderer(content: vedere)
  r.scale = scala
  guard let imagine = r.cgImage else { print("randare esuata: \(cale)"); exit(1) }
  let rep = NSBitmapImageRep(cgImage: imagine)
  guard let png = rep.representation(using: .png, properties: [:]) else { print("png esuat: \(cale)"); exit(1) }
  do {
    try png.write(to: URL(fileURLWithPath: cale))
  } catch {
    print("nu pot scrie \(cale): \(error)")
    exit(1)
  }
  print("scris \(cale)")
}

struct Iconita: View {
  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 228, style: .continuous)
        .fill(LinearGradient(colors: [Color(red: 0.70, green: 0.58, blue: 0.95), Color(red: 0.43, green: 0.29, blue: 0.78)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .frame(width: 824, height: 824)
      Image(systemName: "doc.text")
        .font(.system(size: 440, weight: .regular))
        .foregroundStyle(.white)
        .offset(x: -30, y: -10)
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 250, weight: .semibold))
        .foregroundStyle(.white, Color(red: 0.18, green: 0.62, blue: 0.39))
        .offset(x: 200, y: 200)
    }
    .frame(width: 1024, height: 1024)
  }
}

func exemplu() -> Rezultat {
  Rezultat(
    iesire: "/Users/dumitru/Documents/Nota informativa (corectat).docx", aplicate: 3,
    corecturi: [
      Corectura(stare: "aplicata", tip: "ortografie", vechi: "insa", nou: "însă", motiv: "Conjuncția „însă” se scrie cu î și ă.", inainte: "Deținuții au fost informați despre regim, ", dupa: " nu toți au semnat procesul-verbal."),
      Corectura(stare: "aplicata", tip: "gramatică", vechi: "se v-a prezenta", nou: "se vor prezenta", motiv: "Acordul cu subiectul plural „rezultatele”.", inainte: "iar rezultatele ", dupa: " ulterior."),
      Corectura(stare: "aplicata", tip: "punctuație", vechi: "ca,", nou: "că", motiv: "Fără virgulă după conjuncția „că”.", inainte: "Totodată menționăm ", dupa: " persoanele responsabile vor fi examinate"),
      Corectura(stare: "negasita", tip: "ortografie", vechi: "mentioneam", nou: "menționăm", motiv: "Diacritice lipsă.", inainte: "", dupa: ""),
    ],
    cost_usd: 0, secunde: 48, esecuri: [],
    observatii: [
      Observatie(tip: "date", text: "„durata executării pedepsei din 02.01.2018” față de „reținut de facto la 02.10.2018”: aceeași dată apare diferit, iar de ea depinde calculul termenului.", solutie: "Compară cu sentința din dosar și pune peste tot data reală a reținerii."),
      Observatie(tip: "lipsa", text: "Rubrica de înregistrare „.09.2026 nr. 5/” a rămas fără zi și fără număr.", solutie: "Completează ziua și numărul de ieșire din registrul secției."),
    ],
    motor: "gemini", model: "pro", jetoane: 128_400, mentiune: "adaugata"
  )
}

let argumente = CommandLine.arguments

if let k = argumente.firstIndex(of: "--icon"), k + 1 < argumente.count {
  let dir = argumente[k + 1]
  try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  MainActor.assumeIsolated {
    for (marime, nume) in [(16, "16x16"), (32, "16x16@2x"), (32, "32x32"), (64, "32x32@2x"), (128, "128x128"), (256, "128x128@2x"), (256, "256x256"), (512, "256x256@2x"), (512, "512x512"), (1024, "512x512@2x")] {
      scriePNG(Iconita(), "\(dir)/icon_\(nume).png", scala: CGFloat(marime) / 1024)
    }
  }
  exit(0)
}

if let k = argumente.firstIndex(of: "--ecrane"), k + 1 < argumente.count {
  let dir = argumente[k + 1]
  try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  MainActor.assumeIsolated {
    let c = Corector()
    c.pregatit = true
    c.documente = [
      Corector.Document(url: URL(fileURLWithPath: "/Users/dumitru/Documents/Nota informativa.docx"), stare: .gata(exemplu())),
      Corector.Document(url: URL(fileURLWithPath: "/Users/dumitru/Documents/Demers art. 84.docx"), stare: .inLucru(gata: 0, total: 1), inceputLa: Date().addingTimeInterval(-64)),
      Corector.Document(url: URL(fileURLWithPath: "/Users/dumitru/Documents/Raport lunar septembrie.docx"), stare: .inLucru(gata: 3, total: 7), inceputLa: Date().addingTimeInterval(-192), nota: "Claude reîncearcă: rate_limit (încercarea 2 din 10)"),
      Corector.Document(url: URL(fileURLWithPath: "/Users/dumitru/Documents/Demers.docx"), stare: .inAsteptare),
      Corector.Document(url: URL(fileURLWithPath: "/Users/dumitru/Documents/Dispozitie.docx"), stare: .eroare("Claude Code: nu ești logat. Rulează o dată „claude” în Terminal.")),
    ]
    c.motor = .gemini
    c.model = .pro
    c.problema = nil // utilitarul nu are motor.mjs in pachet; ecranele nu arata avertismentul
    for (schema, nume) in [(ColorScheme.light, "alb"), (ColorScheme.dark, "intunecat")] {
      let p = Paleta(schema: schema)
      scriePNG(
        Continut(peste: false, alege: {}, desfaCorecturile: true).padding(28).frame(width: 720).background(p.fundal)
          .environmentObject(c).environment(\.colorScheme, schema),
        "\(dir)/fereastra-\(nume).png"
      )
    }
    let gol = Corector()
    gol.pregatit = true
    gol.problema = MotorLocal.claude.lipseste
    scriePNG(
      Continut(peste: true, alege: {}).padding(28).frame(width: 720).background(Paleta(schema: .light).fundal)
        .environmentObject(gol).environment(\.colorScheme, .light),
      "\(dir)/fereastra-goala.png"
    )
  }
  exit(0)
}

if let k = argumente.firstIndex(of: "--cap-la-cap"), k + 4 < argumente.count {
  let docx = URL(fileURLWithPath: argumente[k + 1])
  let script = URL(fileURLWithPath: argumente[k + 2])
  let unealta = argumente[k + 3]
  let dir = argumente[k + 4]
  let motor = argumente.firstIndex(of: "--motor").flatMap { $0 + 1 < argumente.count ? MotorLocal(rawValue: argumente[$0 + 1]) : nil } ?? .claude
  Task { @MainActor in
    let (node, _, _) = Motor.gasesteUnelte()
    guard let node else { print("fara node"); exit(1) }
    let c = Corector()
    c.script = script
    c.unelte = motor == .claude ? Unelte(node: node, claude: unealta, agy: nil) : Unelte(node: node, claude: nil, agy: unealta)
    c.pregatit = true
    c.motor = motor
    c.model = motor == .claude ? .sonnet : .pro
    c.problema = nil
    c.adauga([docx])
    var stari: [String] = []
    while c.documente.contains(where: \.activ) {
      let s = String(describing: c.documente.first!.stare)
      if stari.last != s { stari.append(s); print("stare:", s.prefix(160)) }
      try? await Task.sleep(nanoseconds: 50_000_000)
    }
    print("final:", String(describing: c.documente.first!.stare).prefix(400))
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    scriePNG(
      Continut(peste: false, alege: {}, desfaCorecturile: true).padding(28).frame(width: 720).background(Paleta(schema: .light).fundal)
        .environmentObject(c).environment(\.colorScheme, .light),
      "\(dir)/cap-la-cap.png"
    )
    exit(0)
  }
  RunLoop.main.run()
}

print("folosire: instantanee --icon <dir> | --ecrane <dir> | --cap-la-cap <doc.docx> <motor.mjs> <claude> <dir>")
exit(1)
