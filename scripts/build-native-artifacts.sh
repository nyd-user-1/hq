#!/usr/bin/env bash
# build-native-artifacts.sh — publish-time compile of the native shell, so end
# users never need a compiler. Produces:
#   native/hq-shell        universal (arm64 + x86_64) Mach-O of scripts/hq-shell.swift
#   native/hq.icns         the app icon
# Both ship in the npm tarball; make-macos-app-native.sh prefers them and only
# falls back to compiling when they're absent (dev clones after a Swift edit).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWIFT="$REPO/scripts/hq-shell.swift"
OUT="$REPO/native"

[ "$(uname -s)" = "Darwin" ] || { echo "native artifacts build on macOS only"; exit 1; }
command -v swiftc >/dev/null 2>&1 || { echo "swiftc required (xcode-select --install)"; exit 1; }

mkdir -p "$OUT"
TMP="$(mktemp -d)"

echo "compiling universal hq-shell ..."
FRAMEWORKS=(-framework AppKit -framework WebKit -framework Carbon -framework CoreSpotlight)
swiftc -O "$SWIFT" -target arm64-apple-macos12  -o "$TMP/hq-shell-arm64"  "${FRAMEWORKS[@]}"
swiftc -O "$SWIFT" -target x86_64-apple-macos12 -o "$TMP/hq-shell-x86_64" "${FRAMEWORKS[@]}"
lipo -create "$TMP/hq-shell-arm64" "$TMP/hq-shell-x86_64" -output "$OUT/hq-shell"
chmod +x "$OUT/hq-shell"
# ad-hoc sign the universal binary: Apple Silicon refuses to exec unsigned
# native code, and npm-extracted files carry no quarantine, so this is enough.
codesign --force --sign - "$OUT/hq-shell"

# icon (needs Pillow here, at publish time only — users just receive the .icns)
if python3 -c "import PIL" >/dev/null 2>&1; then
  ICONSET="$TMP/HQ.iconset"; mkdir -p "$ICONSET"
  HQ_ICONSET_ONLY="$ICONSET" bash "$REPO/scripts/make-macos-app-native.sh" --iconset-only
  iconutil -c icns "$ICONSET" -o "$OUT/hq.icns"
  echo "icon -> native/hq.icns"
else
  echo "note: Pillow missing — icon not rebuilt (existing native/hq.icns kept if present)"
fi

lipo -info "$OUT/hq-shell"
echo "Done -> $OUT"
