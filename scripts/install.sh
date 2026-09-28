#!/bin/sh
# Install the latest Webdeck release on macOS (Apple silicon):
#
#   curl -fsSL https://raw.githubusercontent.com/wgoodall01/webdeck/main/scripts/install.sh | sh
#
# Files curl downloads aren't quarantined, so Gatekeeper doesn't block the
# ad-hoc signed (not notarized) app on first launch. Set WEBDECK_INSTALL_DIR to
# install somewhere other than /Applications (e.g. ~/Applications).
set -eu

url="https://github.com/wgoodall01/webdeck/releases/latest/download/Webdeck-mac-arm64.zip"
dest="${WEBDECK_INSTALL_DIR:-/Applications}"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Webdeck's installer is for macOS on Apple silicon." >&2
  echo "Other downloads: https://github.com/wgoodall01/webdeck/releases/latest" >&2
  exit 1
fi

mkdir -p "$dest"
if [ ! -w "$dest" ]; then
  echo "Can't write to $dest. Re-run with sudo, or set WEBDECK_INSTALL_DIR=~/Applications." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Webdeck…"
curl -fL --progress-bar "$url" -o "$tmp/Webdeck.zip"

# ditto, not unzip: it keeps the bundle's symlinks and code signature intact.
ditto -xk "$tmp/Webdeck.zip" "$tmp"

if pgrep -xq Webdeck; then
  echo "Quitting the running Webdeck…"
  osascript -e 'quit app "Webdeck"' || true
  sleep 1
fi

rm -rf "$dest/Webdeck.app"
mv "$tmp/Webdeck.app" "$dest/Webdeck.app"
# In case an earlier browser download left the flag behind.
xattr -dr com.apple.quarantine "$dest/Webdeck.app" 2>/dev/null || true

echo "Installed Webdeck to $dest/Webdeck.app"
