#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Flatpak bundles must be built on Linux. Use GitHub Actions, Arch, Fedora, Ubuntu, or another Linux host." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_ID="io.github.thejesterwins.JestersGameVault"
VERSION="$(node -p "require('./package.json').version")"
RELEASE_DATE="$(date +%F)"
WORK_DIR="$ROOT_DIR/artifacts/linux-flatpak"
OUT_DIR="$ROOT_DIR/artifacts/github-beta"

command -v flatpak >/dev/null 2>&1 || { echo "flatpak is required." >&2; exit 1; }
command -v flatpak-builder >/dev/null 2>&1 || { echo "flatpak-builder is required." >&2; exit 1; }

if [[ "${JGV_SKIP_LINUX_PACKAGE:-0}" != "1" ]]; then
  npm run pack:linux
fi

PACKAGE_PATH_FILE="$ROOT_DIR/artifacts/latest-linux-package-path.txt"
if [[ ! -f "$PACKAGE_PATH_FILE" ]]; then
  echo "Missing $PACKAGE_PATH_FILE. Run npm run pack:linux first." >&2
  exit 1
fi

PACKAGE_PATH="$(cat "$PACKAGE_PATH_FILE")"
if [[ ! -d "$PACKAGE_PATH" ]]; then
  echo "Linux package directory not found: $PACKAGE_PATH" >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR" "$OUT_DIR"
cp -a "$ROOT_DIR/packaging/flatpak/." "$WORK_DIR/"
cp -a "$PACKAGE_PATH" "$WORK_DIR/app"
cp "$ROOT_DIR/build/icon-256.png" "$WORK_DIR/icon-256.png"

sed -i "s/__VERSION__/$VERSION/g; s/__DATE__/$RELEASE_DATE/g" "$WORK_DIR/$APP_ID.metainfo.xml"

flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
BUNDLE="$OUT_DIR/JestersGameVault-Beta-$VERSION-linux-x86_64.flatpak"
(
  cd "$WORK_DIR"
  flatpak-builder \
    --user \
    --force-clean \
    --install-deps-from=flathub \
    --repo=repo \
    build \
    "$APP_ID.yml"

  flatpak build-bundle \
    --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
    repo \
    "$BUNDLE" \
    "$APP_ID" \
    stable
)

echo "Flatpak bundle: $BUNDLE"
du -h "$BUNDLE"
