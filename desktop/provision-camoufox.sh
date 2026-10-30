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
  if ! HOME="$RUNTIME/.camoufox-home" XDG_CACHE_HOME="$RUNTIME/.camoufox-home/.cache" NPM_CONFIG_CACHE="$DATA_ROOT/npm-cache" \
    "$NPM" install --prefix "$RUNTIME" --no-save --ignore-scripts "camoufox@$PINNED_CAMOUFOX" "playwright-core@$PINNED_PLAYWRIGHT" >"$DATA_ROOT/camoufox-provision.log" 2>&1; then
    printf '%s\n' 'unavailable:npm_install_failed' >"$STATUS"
    exit 0
  fi
fi
CONFIG="$DATA_ROOT/camoufox-runtime.json"
if ! HOME="$RUNTIME/.camoufox-home" XDG_CACHE_HOME="$RUNTIME/.camoufox-home/.cache" SEEDING_CAMOUFOX_RUNTIME_ROOT="$RUNTIME" SEEDING_CAMOUFOX_PROFILE_ROOT="$PROFILES" SEEDING_CAMOUFOX_CONFIG_FILE="$CONFIG" \
  "$SEEDING_NODE_BIN" --input-type=module - <<'NODE' >"$DATA_ROOT/camoufox-provision-result" 2>"$DATA_ROOT/camoufox-provision-error"; then
import { access, constants, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.SEEDING_CAMOUFOX_RUNTIME_ROOT;
const cacheHome = path.join(root, '.camoufox-home');
const packageManager = await import(pathToFileURL(`${root}/node_modules/camoufox/dist/pkgman.js`).href);
if (typeof packageManager.ensureCamoufoxInstalled !== 'function' || typeof packageManager.launchPath !== 'function') {
  throw Object.assign(new Error('Camoufox package manager API is unavailable'), { code: 'CAMOUFOX_API_UNAVAILABLE' });
}
const browserPath = await packageManager.ensureCamoufoxInstalled();
const executablePath = packageManager.launchPath(browserPath);
const within = (candidate, parent) => {
  const child = path.resolve(String(candidate || ''));
  const base = path.resolve(String(parent || ''));
  const relative = path.relative(base, child);
  return relative === '' || (relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
if (!within(browserPath, cacheHome) || !within(executablePath, browserPath)) {
  throw Object.assign(new Error('Camoufox browser resolved outside managed cache'), { code: 'CAMOUFOX_BROWSER_PATH_UNMANAGED' });
}
const executableStat = await stat(executablePath);
await access(executablePath, constants.X_OK);
if (!executableStat.isFile()) throw Object.assign(new Error('Camoufox executable is not a file'), { code: 'CAMOUFOX_EXECUTABLE_INVALID' });
const payload = { schemaVersion: 1, provider: 'camoufox', packageVersion: '0.5.8', playwrightVersion: '1.62.0', runtimeRoot: root, profileRoot: process.env.SEEDING_CAMOUFOX_PROFILE_ROOT, browserPath, executablePath, provisionedAt: new Date().toISOString() };
await writeFile(process.env.SEEDING_CAMOUFOX_CONFIG_FILE, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ provider: payload.provider, packageVersion: payload.packageVersion, executableReady: true }));
NODE
  printf '%s\n' 'unavailable:browser_install_failed' >"$STATUS"
  exit 0
fi
chmod 600 "$CONFIG"
printf '%s\n' 'ready' >"$STATUS"
