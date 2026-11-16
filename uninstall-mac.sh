#!/bin/bash
# Removes A.R.T. Desktop from this Mac: stops it, removes the login item and the app. Settings stay in
# ~/.config/art-desktop (delete that folder too for a clean slate). The wallpaper goes back to the one given, if any:
#   bash uninstall-mac.sh ["/System/Library/Desktop Pictures/Monterey Graphic.heic"]
AGENT="$HOME/Library/LaunchAgents/local.art-desktop.plist"
launchctl bootout "gui/$(id -u)/local.art-desktop" 2>/dev/null
rm -f "$AGENT"
pkill -f "$HOME/Applications/A.R.T. Desktop/Electron.app" 2>/dev/null
pkill -f "dns-sd -R .* _jointremote._tcp" 2>/dev/null
rm -rf "$HOME/Applications/A.R.T. Desktop"
[ -n "${1:-}" ] && osascript -e "tell application \"System Events\" to tell every desktop to set picture to POSIX file \"$1\""
echo "A.R.T. Desktop removed. Settings kept in ~/.config/art-desktop."
