#!/bin/zsh
# Construieste aplicatia Corector pentru Mac, fara Xcode (doar Command Line Tools):
#   npm run mac                  -> mac/build/Corector.app
#   npm run mac -- --instaleaza  -> o muta in ~/Applications (copia din mac/build se sterge)
# Motorul (scripts/corecteaza-local.mts, cu docx.ts si corector.ts) se impacheteaza cu esbuild in
# Resources/motor.mjs, deci aplicatia nu depinde de folderul proiectului; are nevoie doar
# de node si de CLI-ul motorului ales (Claude Code sau Antigravity) instalate si logate.
set -euo pipefail
cd "${0:A:h}/.."

IESIRE=mac/build
APP="$IESIRE/Corector.app"
TINTA="$(uname -m)-apple-macos14.0"
SURSE=(mac/Corector/Motor.swift mac/Corector/Stare.swift mac/Corector/Vederi.swift)

rm -rf "$APP" "$IESIRE/Corector.iconset"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "motorul..."
node_modules/.bin/esbuild scripts/corecteaza-local.mts --bundle --platform=node --format=esm --target=node20 \
  --outfile="$APP/Contents/Resources/motor.mjs" --log-level=warning

echo "aplicatia..."
swiftc -O -swift-version 5 -target "$TINTA" "${SURSE[@]}" mac/Corector/CorectorApp.swift -o "$APP/Contents/MacOS/Corector"
cp mac/Corector/Info.plist "$APP/Contents/Info.plist"

echo "utilitarul de verificare si iconita..."
swiftc -O -swift-version 5 -target "$TINTA" "${SURSE[@]}" mac/Instantanee/main.swift -o "$IESIRE/instantanee"
"$IESIRE/instantanee" --icon "$IESIRE/Corector.iconset" > /dev/null
iconutil -c icns "$IESIRE/Corector.iconset" -o "$APP/Contents/Resources/Corector.icns"

codesign --force --deep --sign - "$APP"
echo "gata: $APP"

if [[ "${1:-}" == "--instaleaza" ]]; then
  mkdir -p ~/Applications
  rm -rf ~/Applications/Corector.app
  cp -R "$APP" ~/Applications/
  # Copia din mac/build se sterge dupa instalare: altfel raman doua aplicatii cu acelasi nume pe Mac, iar
  # cea din proiect ajunge in Dock si in „Recente” (cerinta lui Dumitru, 25 sept. 2026).
  rm -rf "$APP"
  echo "instalata: ~/Applications/Corector.app (copia din $IESIRE s-a sters)"
fi
