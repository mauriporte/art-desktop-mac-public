#!/bin/bash
# A.R.T. Desktop on macOS (12 Monterey or newer, Intel): installs from a staged folder, no Node and no downloads needed.
#   bash install-mac.sh <staged folder>
# The staged folder holds: app/ (this repo with dist/ already built), electron-v<version>-darwin-x64.zip,
# optional config/ (house.json, overlay.json, widgets.json, remotes.json) and wallpaper/ (art-wallpaper-<width>.png).
# Re-run it to update. Undo: bash uninstall-mac.sh
set -euo pipefail
SRC="${1:?usage: bash install-mac.sh <staged folder>}"
DEST="$HOME/Applications/A.R.T. Desktop"
CFG="$HOME/.config/art-desktop"
AGENT="$HOME/Library/LaunchAgents/local.art-desktop.plist"

[ "$(uname -m)" = x86_64 ] || { echo "This build is for Intel Macs (x64)."; exit 1; }
ZIP=$(ls "$SRC"/electron-v*-darwin-x64.zip | head -1)
[ -f "$SRC/app/dist/index.html" ] || { echo "No built app in $SRC/app (dist/index.html missing)."; exit 1; }

launchctl bootout "gui/$(id -u)/local.art-desktop" 2>/dev/null || true   # gui/ domain works from Terminal and over SSH
pkill -f "$DEST/Electron.app" 2>/dev/null || true

echo "Copying the app..."
mkdir -p "$DEST"
rsync -a --delete --exclude Electron.app "$SRC/app/" "$DEST/app/"
if [ ! -d "$DEST/Electron.app" ] || [ "$ZIP" -nt "$DEST/Electron.app" ]; then
  rm -rf "$DEST/Electron.app"
  ditto -x -k "$ZIP" "$DEST"   # ditto keeps the app's signature and symlinks
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Settings in $CFG (yours are never overwritten)..."
mkdir -p "$CFG/icon-packs"
if [ -d "$SRC/config" ]; then
  for f in "$SRC"/config/*.json; do [ -f "$CFG/$(basename "$f")" ] || cp "$f" "$CFG/"; done
fi
# the example only when neither the Mac nor the staged config/ has a house.json (staged first, or it would never land)
[ -f "$CFG/house.json" ] || cp "$DEST/app/config/house.example.json" "$CFG/house.json"
cp -R "$DEST/app/icon-packs/" "$CFG/icon-packs/"

# the wallpaper made for this screen's width (3200 x 1800 or 1920 x 1080), set on every desktop
if [ -d "$SRC/wallpaper" ]; then
  W=$(system_profiler SPDisplaysDataType | awk '/Resolution:/ { print $2; exit }')
  PIC="$SRC/wallpaper/art-wallpaper-1920.png"; [ "${W:-0}" -ge 2560 ] && PIC="$SRC/wallpaper/art-wallpaper-3200.png"
  mkdir -p "$CFG/wallpaper"; cp "$PIC" "$CFG/wallpaper/"
  osascript -e "tell application \"System Events\" to tell every desktop to set picture to POSIX file \"$CFG/wallpaper/$(basename "$PIC")\"" \
    && echo "Wallpaper: $(basename "$PIC") (screen width ${W:-unknown})"
fi

echo "Starting at login..."
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.art-desktop</string>
  <key>ProgramArguments</key><array><string>$DEST/Electron.app/Contents/MacOS/Electron</string><string>$DEST/app</string></array>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardErrorPath</key><string>$CFG/mac-stderr.log</string>
</dict></plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo
echo "Done. Press Control+Option+H for the tiles."
[ -f "$CFG/ha.json" ] || echo "Home Assistant: create $CFG/ha.json yourself (see INSTALL-MAC.md); until then the tiles show no data."
