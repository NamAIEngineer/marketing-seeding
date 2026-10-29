#!/bin/sh
set -eu
DATA_ROOT=${1:?runtime data directory required}
PINNED_VERSION=0.5.109
RUNTIME="$DATA_ROOT/9router-runtime"
COMMAND=""
NPM_BIN=${SEEDING_NPM_BIN:-}
NODE_BIN=${SEEDING_NODE_BIN:-}

# These values are copied from the npm registry metadata for the pinned
# release. Keep them in the script because the packaged app copies this file
# without the source checkout's provenance record. The companion
# desktop/9router-provenance.json is the reviewable source record and tests
# assert that both records stay in sync.
EXPECTED_REGISTRY="https://registry.npmjs.org"
EXPECTED_TARBALL="https://registry.npmjs.org/9router/-/9router-0.5.109.tgz"
EXPECTED_INTEGRITY="sha512-MKI/tfQSpMhToVyVkXanHddxdfD1YQGYR4+jCxjGrMxz1xNrbR6WuNmY2+jpV745JOvGz9wlDel+APodwaEyfw=="
EXPECTED_SHASUM="cf6381207a57f7e3cb4cb29f373bb15445fba68a"
EXPECTED_SIGNATURE_KEYID="SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U"
EXPECTED_SIGNATURE_1="MEUCIQDYltJeFmu1IcIYoe0Up/QMPy0qGgXJgYBfGCz5dSBgOgIgLi1GmJJnSvrAk6jJYwx84gRSGVFLZ/HU+iMofIs4qRs="
EXPECTED_SIGNATURE_2="MEUCIC/vO3HjXNghlrDgPz87z8WQ+gil72dTnbxSA1GhqHCHAiEAp/n840jBFF9+QxCFpq6uhAJv4pRhNqX1qT5CjOrOt+o="

unavailable() {
  REASON=$1
  mkdir -p "$DATA_ROOT" 2>/dev/null || true
  printf '%s\n' "UNAVAILABLE: $REASON" >"$DATA_ROOT/9router-provision-status" 2>/dev/null || true
  printf '%s\n' "UNAVAILABLE: $REASON" >&2
  exit 2
}

if [ -z "$NODE_BIN" ]; then NODE_BIN=$(command -v node || true); fi

verify_registry_metadata() {
  [ -n "$NPM_BIN" ] || unavailable "bundled npm missing"
  [ -x "$NPM_BIN" ] || unavailable "bundled npm missing"
  [ -n "$NODE_BIN" ] || unavailable "node runtime missing for package verification"
  METADATA=$(PATH="$(dirname "$NPM_BIN"):${PATH:-}" "$NPM_BIN" view "9router@$PINNED_VERSION" dist --json --registry "$EXPECTED_REGISTRY" 2>/dev/null) || unavailable "registry metadata unavailable"
  if ! printf '%s' "$METADATA" | EXPECTED_REGISTRY="$EXPECTED_REGISTRY" EXPECTED_TARBALL="$EXPECTED_TARBALL" EXPECTED_INTEGRITY="$EXPECTED_INTEGRITY" EXPECTED_SHASUM="$EXPECTED_SHASUM" EXPECTED_SIGNATURE_KEYID="$EXPECTED_SIGNATURE_KEYID" EXPECTED_SIGNATURE_1="$EXPECTED_SIGNATURE_1" EXPECTED_SIGNATURE_2="$EXPECTED_SIGNATURE_2" "$NODE_BIN" -e '
    const expected = {
      registry: process.env.EXPECTED_REGISTRY,
      tarball: process.env.EXPECTED_TARBALL,
      integrity: process.env.EXPECTED_INTEGRITY,
      shasum: process.env.EXPECTED_SHASUM,
    };
    let actual;
    try { actual = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(2); }
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) process.exit(2);
    if (actual.tarball !== expected.tarball || actual.integrity !== expected.integrity || actual.shasum !== expected.shasum) process.exit(2);
    if (!Array.isArray(actual.signatures) || !actual.signatures.some((item) => item?.keyid === process.env.EXPECTED_SIGNATURE_KEYID && item.sig === process.env.EXPECTED_SIGNATURE_1) || !actual.signatures.some((item) => item?.keyid === process.env.EXPECTED_SIGNATURE_KEYID && item.sig === process.env.EXPECTED_SIGNATURE_2)) process.exit(2);
    try {
      const parsed = new URL(actual.tarball);
      if (parsed.origin !== expected.registry || parsed.protocol !== "https:") process.exit(2);
    } catch { process.exit(2); }
  '; then
    unavailable "pinned registry metadata mismatch"
  fi
}

verify_installed_package() {
  PACKAGE_JSON="$RUNTIME/node_modules/9router/package.json"
  LOCKFILE="$RUNTIME/node_modules/.package-lock.json"
  [ -f "$PACKAGE_JSON" ] || unavailable "pinned package missing after install"
  [ -f "$LOCKFILE" ] || unavailable "package integrity lock missing after install"
  if ! EXPECTED_TARBALL="$EXPECTED_TARBALL" EXPECTED_INTEGRITY="$EXPECTED_INTEGRITY" "$NODE_BIN" - "$PACKAGE_JSON" "$LOCKFILE" <<'NODE'
const fs = require("node:fs");
const [packagePath, lockPath] = process.argv.slice(2);
let pkg, lock;
try { pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")); lock = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { process.exit(2); }
const entry = Object.entries(lock?.packages || {}).find(([key]) => key === "node_modules/9router" || key.endsWith("/node_modules/9router"))?.[1];
if (pkg?.name !== "9router" || pkg?.version !== "0.5.109") process.exit(2);
if (entry?.version !== "0.5.109" || entry?.resolved !== process.env.EXPECTED_TARBALL || entry?.integrity !== process.env.EXPECTED_INTEGRITY) process.exit(2);
NODE
  then
    unavailable "installed package provenance mismatch"
  fi
  COMMAND="$RUNTIME/node_modules/.bin/9router"
  [ -x "$COMMAND" ] || unavailable "pinned package executable missing after install"
  VERSION=$($COMMAND --version 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
  [ "$VERSION" = "$PINNED_VERSION" ] || unavailable "installed 9Router version mismatch"
}

if [ "${SEEDING_9ROUTER_COMMAND+x}" = x ] && [ -n "$SEEDING_9ROUTER_COMMAND" ]; then
  candidate=$SEEDING_9ROUTER_COMMAND
  if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then COMMAND="$candidate"; fi
else
  for candidate in /usr/local/bin/9router /opt/homebrew/bin/9router; do
    if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then COMMAND="$candidate"; break; fi
  done
fi
if [ -n "$COMMAND" ]; then
  VERSION=$($COMMAND --version 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
  [ "$VERSION" = "$PINNED_VERSION" ] || COMMAND=""
fi
if [ -z "$COMMAND" ]; then
  mkdir -p "$RUNTIME" || unavailable "runtime directory unavailable"
  if [ -x "$RUNTIME/node_modules/.bin/9router" ]; then
    # A previously installed package can be reused offline, but only after
    # checking its package metadata and npm integrity lock again.
    verify_installed_package
  else
    verify_registry_metadata
    PATH="$(dirname "$NPM_BIN"):${PATH:-}" "$NPM_BIN" install --prefix "$RUNTIME" --no-save --ignore-scripts --package-lock=true --registry "$EXPECTED_REGISTRY" "9router@$PINNED_VERSION" || unavailable "pinned package download or install failed"
    verify_installed_package
  fi
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
