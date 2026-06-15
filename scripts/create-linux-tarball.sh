#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
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

OUT_DIR="$ROOT_DIR/artifacts/github-beta"
mkdir -p "$OUT_DIR"

ARCH_LABEL="${JGV_LINUX_ARCH_LABEL:-linux-x64}"
TARBALL="$OUT_DIR/JestersGameVault-Beta-$VERSION-$ARCH_LABEL.tar.gz"

tar -C "$(dirname "$PACKAGE_PATH")" -czf "$TARBALL" "$(basename "$PACKAGE_PATH")"

echo "Linux tarball: $TARBALL"
du -h "$TARBALL"
