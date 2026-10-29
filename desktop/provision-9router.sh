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
  if [ ! -x "${SEEDING_NPM_BIN:-}" ]; then
    echo "9Router provisioning unavailable: bundled npm missing" >&2
    exit 2
  fi
  mkdir -p "$RUNTIME"
  if [ ! -x "$RUNTIME/node_modules/.bin/9router" ]; then
    PATH="$(dirname "$SEEDING_NPM_BIN"):${PATH:-}" "$SEEDING_NPM_BIN" install --prefix "$RUNTIME" --no-save --ignore-scripts "9router@$PINNED_VERSION"
  fi
  COMMAND="$RUNTIME/node_modules/.bin/9router"
fi
ENDPOINT="${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}"
http_ready() {
  # A running gateway may correctly return 401/403 before the user connects
  # an API key. Treat those responses as liveness, while rejecting transport
  # errors and other HTTP failures.
  CODE=$(/usr/bin/curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$ENDPOINT/models" || true)
  case "$CODE" in
    2??|401|403) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "${SEEDING_9ROUTER_START:-true}" = "true" ] && ! http_ready; then
  mkdir -p "$DATA_ROOT"
  nohup "$COMMAND" --host 127.0.0.1 --port 20128 --no-browser --skip-update >>"$DATA_ROOT/9router.log" 2>&1 &
  READY=0
  for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
    if http_ready; then READY=1; break; fi
    sleep 1
  done
  if [ "$READY" -ne 1 ]; then
    echo "9Router did not become reachable at $ENDPOINT" >&2
    exit 3
  fi
fi
printf '%s\n' "$COMMAND"
