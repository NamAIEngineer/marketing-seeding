#!/bin/sh
set -eu
DATA_ROOT=${1:?runtime data directory required}
PINNED_CAMOUFOX=0.5.8
PINNED_PLAYWRIGHT=1.62.0
RUNTIME="$DATA_ROOT/camoufox-runtime"
PROFILES="$DATA_ROOT/camoufox-profiles"
STATUS="$DATA_ROOT/camoufox-provision-status"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$SCRIPT_DIR/src/camoufox-official-release.mjs" ]; then
  OFFICIAL_MODULE="$SCRIPT_DIR/src/camoufox-official-release.mjs"
else
  OFFICIAL_MODULE="$SCRIPT_DIR/../src/camoufox-official-release.mjs"
fi
mkdir -p "$DATA_ROOT" "$RUNTIME" "$PROFILES"
chmod 700 "$DATA_ROOT" "$RUNTIME" "$PROFILES"
NPM="${SEEDING_NPM_BIN:-}"
if [ -z "$NPM" ]; then NPM=$(command -v npm || true); fi
ENTRY="$RUNTIME/node_modules/camoufox/dist/index.js"
if [ ! -f "$ENTRY" ] && [ -n "$NPM" ] && [ -x "$NPM" ]; then
  if ! HOME="$RUNTIME/.camoufox-home" XDG_CACHE_HOME="$RUNTIME/.camoufox-home/.cache" NPM_CONFIG_CACHE="$DATA_ROOT/npm-cache" \
    "$NPM" install --prefix "$RUNTIME" --no-save --ignore-scripts "camoufox@$PINNED_CAMOUFOX" "playwright-core@$PINNED_PLAYWRIGHT" >"$DATA_ROOT/camoufox-provision.log" 2>&1; then
    # Continue to the pinned direct official release path below.  npm is only
    # the first provisioning route; a clean host may have Node without npm.
    printf '%s\n' 'npm_install_failed:official_fallback' >"$DATA_ROOT/camoufox-provision-note"
  fi
elif [ ! -f "$ENTRY" ]; then
  printf '%s\n' 'npm_missing:official_fallback' >"$DATA_ROOT/camoufox-provision-note"
fi
CONFIG="$DATA_ROOT/camoufox-runtime.json"
if ! HOME="$RUNTIME/.camoufox-home" XDG_CACHE_HOME="$RUNTIME/.camoufox-home/.cache" SEEDING_CAMOUFOX_RUNTIME_ROOT="$RUNTIME" SEEDING_CAMOUFOX_PROFILE_ROOT="$PROFILES" SEEDING_CAMOUFOX_CONFIG_FILE="$CONFIG" SEEDING_CAMOUFOX_OFFICIAL_MODULE="$OFFICIAL_MODULE" SEEDING_CAMOUFOX_OFFICIAL_FALLBACK="${SEEDING_CAMOUFOX_OFFICIAL_FALLBACK:-true}" \
  "$SEEDING_NODE_BIN" --input-type=module - <<'NODE' >"$DATA_ROOT/camoufox-provision-result" 2>"$DATA_ROOT/camoufox-provision-error"; then
const typedProvisionCode = (error) => String(error?.code || '').startsWith('CAMOUFOX_')
  ? error.code
  : (Number(error?.code) === 20 ? 'CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE' : 'CAMOUFOX_BROWSER_INSTALL_FAILED');
process.on('uncaughtException', (error) => { process.stderr.write(`${JSON.stringify({ code: typedProvisionCode(error), reason: String(error?.message || 'Camoufox provisioning failed').slice(0, 300) })}\n`); process.exit(1); });
process.on('unhandledRejection', (error) => { process.stderr.write(`${JSON.stringify({ code: typedProvisionCode(error), reason: String(error?.message || 'Camoufox provisioning failed').slice(0, 300) })}\n`); process.exit(1); });
import { access, constants, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.SEEDING_CAMOUFOX_RUNTIME_ROOT;
const cacheHome = path.join(root, '.camoufox-home');
let browserPath;
let executablePath;
let packageManagerError;
try {
  const packageManager = await import(pathToFileURL(`${root}/node_modules/camoufox/dist/pkgman.js`).href);
  if (typeof packageManager.ensureCamoufoxInstalled !== 'function' || typeof packageManager.launchPath !== 'function') {
    throw Object.assign(new Error('Camoufox package manager API is unavailable'), { code: 'CAMOUFOX_API_UNAVAILABLE' });
  }
  browserPath = await packageManager.ensureCamoufoxInstalled();
  executablePath = packageManager.launchPath(browserPath);
} catch (error) {
  packageManagerError = error;
  const code = String(error?.code || '');
  const validationFailure = new Set(['CAMOUFOX_BROWSER_PATH_UNMANAGED', 'CAMOUFOX_EXECUTABLE_INVALID', 'CAMOUFOX_PROVISION_OUTPUT_INVALID']).has(code);
  if (process.env.SEEDING_CAMOUFOX_OFFICIAL_FALLBACK !== 'true' || validationFailure) throw error;
  const official = await import(pathToFileURL(process.env.SEEDING_CAMOUFOX_OFFICIAL_MODULE).href);
  const result = await official.provisionOfficialCamoufoxBrowser({ cacheHome });
  browserPath = result.browserPath;
  executablePath = result.executablePath;
}
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
const payload = { schemaVersion: 1, provider: 'camoufox', packageVersion: '0.5.8', playwrightVersion: '1.62.0', runtimeRoot: root, profileRoot: process.env.SEEDING_CAMOUFOX_PROFILE_ROOT, browserPath, executablePath, provisionSource: packageManagerError ? 'official-github-release-fallback' : 'camoufox-pkgman', provisionedAt: new Date().toISOString() };
await writeFile(process.env.SEEDING_CAMOUFOX_CONFIG_FILE, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ provider: payload.provider, packageVersion: payload.packageVersion, executableReady: true }));
NODE
  CODE=$(sed -n 's/.*"code":"\([A-Za-z0-9_]*\)".*/\1/p' "$DATA_ROOT/camoufox-provision-error" | tail -1)
  [ -n "$CODE" ] || CODE='CAMOUFOX_BROWSER_INSTALL_FAILED'
  printf 'unavailable:%s\n' "$(printf '%s' "$CODE" | tr '[:upper:]' '[:lower:]')" >"$STATUS"
  exit 4
fi
chmod 600 "$CONFIG"
printf '%s\n' 'ready' >"$STATUS"
