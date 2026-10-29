#!/bin/sh
set -eu
DATA_ROOT=${1:?runtime data directory required}
PINNED_CAMOUFOX=0.5.8
PINNED_PLAYWRIGHT=1.62.0
RUNTIME="$DATA_ROOT/camoufox-runtime"
PROFILES="$DATA_ROOT/camoufox-profiles"
STATUS="$DATA_ROOT/camoufox-provision-status"
mkdir -p "$DATA_ROOT" "$RUNTIME" "$PROFILES"
chmod 700 "$DATA_ROOT" "$RUNTIME" "$PROFILES"
NPM="${SEEDING_NPM_BIN:-}"
if [ -z "$NPM" ]; then NPM=$(command -v npm || true); fi
if [ -z "$NPM" ] || [ ! -x "$NPM" ]; then
  printf '%s\n' 'unavailable:npm_missing' >"$STATUS"
  exit 0
fi
ENTRY="$RUNTIME/node_modules/camoufox/dist/index.js"
if [ ! -f "$ENTRY" ]; then
  if ! "$NPM" install --prefix "$RUNTIME" --no-save --ignore-scripts "camoufox@$PINNED_CAMOUFOX" "playwright-core@$PINNED_PLAYWRIGHT" >"$DATA_ROOT/camoufox-provision.log" 2>&1; then
    printf '%s\n' 'unavailable:npm_install_failed' >"$STATUS"
    exit 0
  fi
fi
CONFIG="$DATA_ROOT/camoufox-runtime.json"
if ! SEEDING_CAMOUFOX_RUNTIME_ROOT="$RUNTIME" SEEDING_CAMOUFOX_PROFILE_ROOT="$PROFILES" SEEDING_CAMOUFOX_CONFIG_FILE="$CONFIG" \
  "$SEEDING_NODE_BIN" --input-type=module - <<'NODE' >"$DATA_ROOT/camoufox-provision-result" 2>"$DATA_ROOT/camoufox-provision-error"; then
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = process.env.SEEDING_CAMOUFOX_RUNTIME_ROOT;
const mod = await import(pathToFileURL(`${root}/node_modules/camoufox/dist/index.js`).href);
const browserPath = await mod.ensureCamoufoxInstalled();
const executablePath = mod.launchPath(browserPath);
const payload = { schemaVersion: 1, provider: 'camoufox', packageVersion: '0.5.8', playwrightVersion: '1.62.0', runtimeRoot: root, profileRoot: process.env.SEEDING_CAMOUFOX_PROFILE_ROOT, browserPath, executablePath, provisionedAt: new Date().toISOString() };
await writeFile(process.env.SEEDING_CAMOUFOX_CONFIG_FILE, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ provider: payload.provider, packageVersion: payload.packageVersion, executableReady: true }));
NODE
  printf '%s\n' 'unavailable:browser_install_failed' >"$STATUS"
  exit 0
fi
chmod 600 "$CONFIG"
printf '%s\n' 'ready' >"$STATUS"
