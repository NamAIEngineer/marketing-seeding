#!/bin/sh
set -eu
APP=${1:?current app bundle path required}
RELEASE_URL=${SEEDING_RELEASE_URL:?signed release URL required}
EXPECTED_SHA256=${SEEDING_RELEASE_SHA256:?release SHA-256 required}
DATA_ROOT="$HOME/Library/Application Support/Marketing Seeding OS"
TMP_DIR=$(mktemp -d)
ARCHIVE="$TMP_DIR/release.zip"
BACKUP="$DATA_ROOT/update-backups/$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$BACKUP"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 "$RELEASE_URL" -o "$ARCHIVE"
ACTUAL_SHA256=$(/usr/bin/shasum -a 256 "$ARCHIVE" | awk '{print $1}')
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || { echo "release checksum mismatch" >&2; exit 1; }
/usr/bin/ditto -x -k "$ARCHIVE" "$TMP_DIR/unpacked"
NEW_APP=$(find "$TMP_DIR/unpacked" -maxdepth 2 -name '*.app' -print -quit)
[ -n "$NEW_APP" ] || { echo "release app bundle missing" >&2; exit 1; }
/usr/bin/codesign --verify --deep --strict "$NEW_APP"
/usr/bin/ditto "$APP" "$BACKUP/previous.app"
[ -f "$DATA_ROOT/state.json" ] && /usr/bin/cp "$DATA_ROOT/state.json" "$BACKUP/state.json"
TARGET_DIR=$(dirname "$APP")
STAGED="$TARGET_DIR/.Marketing-Seeding-OS.new.app"
OLD="$TARGET_DIR/.Marketing-Seeding-OS.previous.app"
rm -rf "$STAGED"
rm -rf "$OLD"
/usr/bin/ditto "$NEW_APP" "$STAGED"
/usr/bin/mv "$APP" "$OLD"
if ! /usr/bin/mv "$STAGED" "$APP"; then
  /usr/bin/mv "$OLD" "$APP" || true
  echo "update swap failed; previous app restored" >&2
  exit 1
fi
rm -rf "$OLD"
echo "updated; durable state backup: $BACKUP"
