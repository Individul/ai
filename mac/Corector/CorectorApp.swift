// Aplicatia Corector pentru Mac: o fereastra in care se trag documente Word; le corecteaza Claude Code
// logat cu contul utilizatorului (vezi Motor.swift). Documentele se pot deschide si din Finder
// („Deschide cu”) sau trase pe iconita din Dock.

import AppKit
import SwiftUI

@main
struct CorectorApp: App {
  @NSApplicationDelegateAdaptor(Delegat.self) private var delegat
  @StateObject private var corector = Corector.comun

  var body: some Scene {
    Window("Corector", id: "principal") {
      Fereastra()
        .environmentObject(corector)
        .frame(minWidth: 560, minHeight: 540)
        .task { await corector.pregateste() }
    }
    .defaultSize(width: 720, height: 780)
    .windowResizability(.contentMinSize)
  }
}

final class Delegat: NSObject, NSApplicationDelegate {
  func application(_ application: NSApplication, open urls: [URL]) {
    Task { @MainActor in Corector.comun.adauga(urls) }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
