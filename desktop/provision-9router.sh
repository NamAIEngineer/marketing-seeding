#!/bin/sh
set -eu
DATA_ROOT=${1:?runtime data directory required}
PINNED_VERSION=0.5.109
RUNTIME="$DATA_ROOT/9router-runtime"
COMMAND=""
for candidate in "${SEEDING_9ROUTER_COMMAND:-}" /usr/local/bin/9router /opt/homebrew/bin/9router; do
  [ -n "$candidate" ] || continue
  if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then COMMAND="$candidate"; break; fi
done
if [ -n "$COMMAND" ]; then
  VERSION=$($COMMAND --version 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
  [ "$VERSION" = "$PINNED_VERSION" ] || COMMAND=""
fi
if [ -z "$COMMAND" ]; then
  mkdir -p "$RUNTIME"
  if [ ! -x "$RUNTIME/node_modules/.bin/9router" ]; then
    npm install --prefix "$RUNTIME" --no-save --ignore-scripts "9router@$PINNED_VERSION"
  fi
  COMMAND="$RUNTIME/node_modules/.bin/9router"
fi
if [ "${SEEDING_9ROUTER_START:-true}" = "true" ] && ! /usr/bin/curl -fsS --max-time 1 "${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}/models" >/dev/null 2>&1; then
  mkdir -p "$DATA_ROOT"
  nohup "$COMMAND" --host 127.0.0.1 --port 20128 --no-browser --skip-update >>"$DATA_ROOT/9router.log" 2>&1 &
fi
printf '%s\n' "$COMMAND"
