#!/usr/bin/env bash
# make-macos-app-native.sh — build HQ.app as a TRUE native window (NSWindow +
# WKWebView), not a browser tab. Door 3, the light way: no Electron, no npm
# deps, uses the macOS SDK already on this Mac. Compiles scripts/hq-shell.swift.
#
# Build the offline bundle first:  npm run build:offline
# Re-run after any rebuild to refresh the app.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$REPO/.next/standalone"
SWIFT="$REPO/scripts/hq-shell.swift"
APP_NAME="HQ"
INSTALL_DIR="${HQ_APP_INSTALL:-$HOME/Applications}"
APP="$INSTALL_DIR/$APP_NAME.app"

[ -f "$STANDALONE/server.js" ] || { echo "No offline build at $STANDALONE — run: npm run build:offline"; exit 1; }
command -v swiftc >/dev/null 2>&1 || { echo "swiftc not found (install Xcode Command Line Tools: xcode-select --install)"; exit 1; }

echo "Building native $APP ..."
mkdir -p "$INSTALL_DIR"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# self-contained: the standalone server bundle lives inside the app
cp -R "$STANDALONE" "$APP/Contents/Resources/standalone"

# icon: black bg, white "hq"
ICONSET="$(mktemp -d)/HQ.iconset"; mkdir -p "$ICONSET"
python3 - "$ICONSET" <<'PY'
import sys, os
from PIL import Image, ImageDraw, ImageFont
iconset = sys.argv[1]; S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 255)); d = ImageDraw.Draw(img)
for fp in ("/System/Library/Fonts/HelveticaNeue.ttc","/System/Library/Fonts/Helvetica.ttc",
           "/System/Library/Fonts/Supplemental/Arial Bold.ttf","/Library/Fonts/Arial.ttf"):
    if os.path.exists(fp):
        try: font = ImageFont.truetype(fp, int(S*0.46)); break
        except Exception: font = None
else: font = None
if font is None: font = ImageFont.load_default()
bb = d.textbbox((0,0), "hq", font=font); w,h = bb[2]-bb[0], bb[3]-bb[1]
d.text(((S-w)/2-bb[0], (S-h)/2-bb[1]), "hq", font=font, fill=(255,255,255,255))
for s in (16,32,128,256,512):
    for sc in (1,2):
        px=s*sc; nm=f"icon_{s}x{s}{'@2x' if sc==2 else ''}.png"
        img.resize((px,px), Image.LANCZOS).save(os.path.join(iconset,nm))
PY
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/hq.icns"

# Info.plist — note NSAllowsLocalNetworking so WKWebView may load http://localhost
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>HQ</string>
  <key>CFBundleDisplayName</key><string>HQ</string>
  <key>CFBundleIdentifier</key><string>com.nysgpt.hq</string>
  <key>CFBundleExecutable</key><string>hq</string>
  <key>CFBundleIconFile</key><string>hq</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# compile the native shell into the app's executable
swiftc -O "$SWIFT" -o "$APP/Contents/MacOS/hq" -framework AppKit -framework WebKit
chmod +x "$APP/Contents/MacOS/hq"

# register so Spotlight indexes it now
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" || true
touch "$APP"

echo "Done -> $APP"
echo "Launch from Spotlight (⌘Space, 'HQ') — opens in a native window."
