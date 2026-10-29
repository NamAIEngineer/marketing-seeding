#!/bin/sh
set -eu

# Replace a bundle at its exact path. The current app is first moved out of
# the way, so `mv staged current` cannot turn into a nested app directory.
# On any failed install, restore the old path or fail closed if the destination
# was unexpectedly recreated and cannot be safely rolled back.
swap_app() {
  CURRENT_APP=${1:?current app bundle path required}
  STAGED_APP=${2:?staged app bundle path required}
  TARGET_DIR=$(dirname "$CURRENT_APP")
  ROLLBACK_APP="$TARGET_DIR/.Marketing-Seeding-OS.rollback.$$"
  rm -rf "$ROLLBACK_APP"

  if ! mv "$CURRENT_APP" "$ROLLBACK_APP"; then
    echo "unable to move current app aside; update not applied" >&2
    return 1
  fi
  if mv "$STAGED_APP" "$CURRENT_APP"; then
    if ! rm -rf "$ROLLBACK_APP"; then
      echo "updated but rollback path cleanup failed: $ROLLBACK_APP" >&2
      return 1
    fi
    return 0
  fi

  # A failed move should leave the exact destination absent. Refuse to remove
  # an unexpected path; the durable backup remains available for recovery.
  if [ -e "$CURRENT_APP" ]; then
    echo "staged app move failed and destination was recreated; refusing unsafe rollback" >&2
    return 2
  fi
  if mv "$ROLLBACK_APP" "$CURRENT_APP"; then
    echo "staged app move failed; previous app restored" >&2
    return 1
  fi
  echo "staged app move failed and previous app could not be restored" >&2
  return 2
}

# Offline fixture hook used by focused tests. It performs only the bounded
# sibling swap above and never downloads, verifies, launches, or writes data.
if [ "${SEEDING_UPDATE_SWAP_TEST:-0}" = "1" ]; then
  swap_app "$1" "$2"
  exit $?
fi

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
rm -rf "$STAGED"
/usr/bin/ditto "$NEW_APP" "$STAGED"
swap_app "$APP" "$STAGED"
echo "updated; durable state backup: $BACKUP"
