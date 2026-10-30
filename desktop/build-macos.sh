#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE=$ROOT
OUTPUT="$ROOT/desktop/dist"
APP="$OUTPUT/Marketing Seeding OS.app"
NODE_BIN=$(command -v node)
SWIFT_BIN=$(command -v swiftc)
NPM_BIN=$(command -v npm || true)
NPM_ROOT=$(npm root -g 2>/dev/null || true)

# A bundle records only the committed HEAD. Refuse to package an overlay that
# would make the source stamp lie about the bytes in the app. Developers may
# explicitly opt into a disposable dirty build, but it must be visible in the
# command and is never accepted by release CI.
if [ "${SEEDING_ALLOW_DIRTY_BUILD:-false}" != "true" ] && [ -n "$(git -C "$SOURCE" status --porcelain)" ]; then
  echo 'refusing dirty build: commit all source changes or set SEEDING_ALLOW_DIRTY_BUILD=true for a local disposable build' >&2
  exit 2
fi

test -f "$SOURCE/src/server.mjs"
test -d "$SOURCE/public"
test -f "$NODE_BIN"
test -f "$SWIFT_BIN"
"$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app" "$APP/Contents/Resources/bin" "$APP/Contents/Resources/lib/node_modules"
ditto "$SOURCE/src" "$APP/Contents/Resources/app/src"
ditto "$SOURCE/public" "$APP/Contents/Resources/app/public"
ditto "$SOURCE/scripts" "$APP/Contents/Resources/app/scripts"
if [ -d "$SOURCE/plans/crawl4ai-integration" ]; then
  mkdir -p "$APP/Contents/Resources/app/plans"
  ditto "$SOURCE/plans/crawl4ai-integration" "$APP/Contents/Resources/app/plans/crawl4ai-integration"
fi
ditto "$SOURCE/desktop/provision-9router.sh" "$APP/Contents/Resources/app/provision-9router.sh"
ditto "$SOURCE/desktop/9router-provenance.json" "$APP/Contents/Resources/app/9router-provenance.json"
ditto "$SOURCE/desktop/provision-camoufox.sh" "$APP/Contents/Resources/app/provision-camoufox.sh"
ditto "$SOURCE/desktop/update-macos.sh" "$APP/Contents/Resources/app/update-macos.sh"
ditto "$SOURCE/desktop/health-probe.mjs" "$APP/Contents/Resources/app/health-probe.mjs"
cp "$NODE_BIN" "$APP/Contents/Resources/bin/node"
if [ -n "$NPM_BIN" ] && [ -n "$NPM_ROOT" ] && [ -d "$NPM_ROOT/npm" ]; then
  ditto "$NPM_ROOT/npm" "$APP/Contents/Resources/lib/node_modules/npm"
  # The host npm executable is a symlink/script whose relative require path
  # breaks once copied into the app bundle. Keep npm's own package intact and
  # invoke its CLI with the bundled Node binary instead.
  cat > "$APP/Contents/Resources/bin/npm" <<'NPM'
#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$HERE/bin/node" "$HERE/lib/node_modules/npm/bin/npm-cli.js" "$@"
NPM
  chmod 755 "$APP/Contents/Resources/bin/npm"
  printf '%s\n' 'bundled' > "$APP/Contents/Resources/app/npm-provision-status.txt"
else
  printf '%s\n' 'unavailable:npm_missing_at_build_time' > "$APP/Contents/Resources/app/npm-provision-status.txt"
fi
cp "$SOURCE/package.json" "$APP/Contents/Resources/app/package.json"
git -C "$SOURCE" rev-parse HEAD > "$APP/Contents/Resources/app/source-commit.txt"
"$SWIFT_BIN" "$SOURCE/desktop/MarketingSeedingApp.swift" -o "$APP/Contents/MacOS/webview" -framework Cocoa -framework WebKit

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0//EN">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Marketing Seeding OS</string>
<key>CFBundleDisplayName</key><string>Marketing Seeding OS</string>
<key>CFBundleIdentifier</key><string>ai.marketing-seeding.local</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.3.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../Resources/app" && pwd)
# Keep the durable runtime root overridable for packaged smoke/tests.  launchd
# receives this exact value through EnvironmentVariables below; never derive a
# second root from launchd's (potentially different) HOME.
DATA_ROOT="${SEEDING_DATA_DIR:-$HOME/Library/Application Support/Marketing Seeding OS}"
PORT=4321
mkdir -p "$DATA_ROOT"
chmod 700 "$DATA_ROOT"
HEALTH_NONCE_FILE="$DATA_ROOT/health-nonce"
if [ ! -s "$HEALTH_NONCE_FILE" ]; then
  /usr/bin/openssl rand -hex 32 > "$HEALTH_NONCE_FILE"
  chmod 600 "$HEALTH_NONCE_FILE"
fi
HEALTH_NONCE=$(cat "$HEALTH_NONCE_FILE")
SOURCE_COMMIT=$(cat "$APP_ROOT/source-commit.txt")
for TOKEN in operator automation control; do
  FILE="$DATA_ROOT/$TOKEN-token"
  if [ ! -s "$FILE" ]; then
    /usr/bin/openssl rand -hex 32 > "$FILE"
    chmod 600 "$FILE"
  fi
done
export SEEDING_DATA_DIR="$DATA_ROOT"
export SEEDING_OPERATOR_TOKEN=$(cat "$DATA_ROOT/operator-token")
export SEEDING_AUTOMATION_TOKEN=$(cat "$DATA_ROOT/automation-token")
export SEEDING_CONTROL_TOKEN=$(cat "$DATA_ROOT/control-token")
export SEEDING_HOST=127.0.0.1
export SEEDING_PORT=$PORT
if ! "$APP_ROOT/../bin/node" "$APP_ROOT/health-probe.mjs" "http://127.0.0.1:$PORT/health" "$HEALTH_NONCE" "$SOURCE_COMMIT" >/dev/null 2>&1; then
  LABEL=ai.marketing-seeding.packaged
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  # launchd does not inherit the environment of this launcher.  Escape values
  # before writing XML so a custom HOME/data path cannot corrupt the plist.
  xml_escape() {
    printf '%s' "$1" | sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g' -e 's/"/\\&quot;/g' -e "s/'/\\&apos;/g"
  }
  XML_HOME=$(xml_escape "$HOME")
  XML_DATA_ROOT=$(xml_escape "$DATA_ROOT")
  XML_OPERATOR_TOKEN=$(xml_escape "$SEEDING_OPERATOR_TOKEN")
  XML_AUTOMATION_TOKEN=$(xml_escape "$SEEDING_AUTOMATION_TOKEN")
  XML_CONTROL_TOKEN=$(xml_escape "$SEEDING_CONTROL_TOKEN")
  XML_HEALTH_NONCE=$(xml_escape "$HEALTH_NONCE")
  XML_BUILD_COMMIT=$(xml_escape "$SOURCE_COMMIT")
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>$APP_ROOT/../../MacOS/service</string></array>
<key>EnvironmentVariables</key><dict>
<key>HOME</key><string>$XML_HOME</string>
<key>SEEDING_DATA_DIR</key><string>$XML_DATA_ROOT</string>
<key>SEEDING_OPERATOR_TOKEN</key><string>$XML_OPERATOR_TOKEN</string>
<key>SEEDING_AUTOMATION_TOKEN</key><string>$XML_AUTOMATION_TOKEN</string>
<key>SEEDING_CONTROL_TOKEN</key><string>$XML_CONTROL_TOKEN</string>
<key>SEEDING_HEALTH_NONCE</key><string>$XML_HEALTH_NONCE</string>
<key>SEEDING_HOST</key><string>127.0.0.1</string>
<key>SEEDING_PORT</key><string>4321</string>
<key>SEEDING_BUILD_COMMIT</key><string>$XML_BUILD_COMMIT</string>
<key>SEEDING_NODE_BIN</key><string>$APP_ROOT/../bin/node</string>
<key>SEEDING_NPM_BIN</key><string>$APP_ROOT/../bin/npm</string>
<key>SEEDING_9ROUTER_ENDPOINT</key><string>${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}</string>
<key>SEEDING_9ROUTER_PROVISION</key><string>${SEEDING_9ROUTER_PROVISION:-true}</string>
<key>SEEDING_CAMOUFOX_PROVISION</key><string>${SEEDING_CAMOUFOX_PROVISION:-true}</string>
<key>SEEDING_CONTENT_AUTO_PROVISION</key><string>${SEEDING_CONTENT_AUTO_PROVISION:-true}</string>
<key>SEEDING_CONTENT_MODE</key><string>${SEEDING_CONTENT_MODE:-PRODUCTION}</string>
<key>SEEDING_JEV_WORKER_ENABLED</key><string>${SEEDING_JEV_WORKER_ENABLED:-true}</string>
<key>SEEDING_JEV_LIVE_ENABLED</key><string>${SEEDING_JEV_LIVE_ENABLED:-true}</string>
<key>SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED</key><string>${SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED:-true}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$DATA_ROOT/server.log</string>
<key>StandardErrorPath</key><string>$DATA_ROOT/server.log</string>
</dict></plist>
EOF
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  chmod 600 "$PLIST"
  /bin/launchctl bootstrap "gui/$(id -u)" "$PLIST"
  READY=0
  for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
    if "$APP_ROOT/../bin/node" "$APP_ROOT/health-probe.mjs" "http://127.0.0.1:$PORT/health" "$HEALTH_NONCE" "$SOURCE_COMMIT" >/dev/null 2>&1; then READY=1; break; fi
    sleep 1
  done
  if [ "$READY" -ne 1 ]; then
    /usr/bin/osascript -e 'display dialog "Ứng dụng chưa khởi động được. Xem server.log trong Library/Application Support/Marketing Seeding OS." buttons {"OK"} default button "OK"'
    exit 1
  fi
fi
exec "$APP_ROOT/../../MacOS/webview" "http://127.0.0.1:$PORT/"
LAUNCH
cat > "$APP/Contents/MacOS/service" <<'SERVICE'
#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../Resources/app" && pwd)
NODE="$APP_ROOT/../bin/node"
DATA_ROOT="${SEEDING_DATA_DIR:-$HOME/Library/Application Support/Marketing Seeding OS}"
mkdir -p "$DATA_ROOT"
chmod 700 "$DATA_ROOT"
export SEEDING_DATA_DIR="$DATA_ROOT"
if [ -z "${SEEDING_OPERATOR_TOKEN:-}" ]; then
  export SEEDING_OPERATOR_TOKEN=$(cat "$DATA_ROOT/operator-token")
fi
if [ -z "${SEEDING_AUTOMATION_TOKEN:-}" ]; then
  export SEEDING_AUTOMATION_TOKEN=$(cat "$DATA_ROOT/automation-token")
fi
if [ -z "${SEEDING_CONTROL_TOKEN:-}" ]; then
  export SEEDING_CONTROL_TOKEN=$(cat "$DATA_ROOT/control-token")
fi
export SEEDING_HOST="${SEEDING_HOST:-127.0.0.1}"
export SEEDING_PORT="${SEEDING_PORT:-4321}"
if [ -z "${SEEDING_HEALTH_NONCE:-}" ]; then
  export SEEDING_HEALTH_NONCE=$(cat "$DATA_ROOT/health-nonce")
fi
export SEEDING_9ROUTER_ENDPOINT="${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}"
export SEEDING_9ROUTER_PROVISION="${SEEDING_9ROUTER_PROVISION:-true}"
export SEEDING_CAMOUFOX_PROVISION="${SEEDING_CAMOUFOX_PROVISION:-true}"
export SEEDING_NODE_BIN="${SEEDING_NODE_BIN:-$APP_ROOT/../bin/node}"
export SEEDING_NPM_BIN="${SEEDING_NPM_BIN:-$APP_ROOT/../bin/npm}"
export PATH="$APP_ROOT/../bin:$APP_ROOT/../lib/node_modules/npm/bin:$PATH"
export SEEDING_BUILD_COMMIT=$(cat "$APP_ROOT/source-commit.txt")
export SEEDING_BUILD_DIRTY=false
export SEEDING_9ROUTER_ENDPOINT="${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}"
export SEEDING_CONTENT_AUTO_PROVISION="${SEEDING_CONTENT_AUTO_PROVISION:-true}"
export SEEDING_CONTENT_MODE="${SEEDING_CONTENT_MODE:-PRODUCTION}"
# The packaged worker is on by default. Live submission remains fail-closed
# inside JevExecutionWorker until the exact standing authority, account agent,
# readiness, grant, adapter and independent verification contracts pass.
export SEEDING_JEV_WORKER_ENABLED="${SEEDING_JEV_WORKER_ENABLED:-true}"
export SEEDING_JEV_LIVE_ENABLED="${SEEDING_JEV_LIVE_ENABLED:-true}"
export SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED="${SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED:-true}"
if [ "${SEEDING_9ROUTER_PROVISION:-true}" = "true" ] && [ -x "$APP_ROOT/provision-9router.sh" ]; then
  : >"$DATA_ROOT/9router-provision-status"
  if ! "$APP_ROOT/provision-9router.sh" "$DATA_ROOT" >"$DATA_ROOT/9router-provision-command" 2>"$DATA_ROOT/9router-provision-error"; then
    if ! /usr/bin/grep -q '^UNAVAILABLE:' "$DATA_ROOT/9router-provision-status" 2>/dev/null; then
      printf '%s\n' "UNAVAILABLE:provision_failed" >"$DATA_ROOT/9router-provision-status"
    fi
  else
    printf '%s\n' "ready" >"$DATA_ROOT/9router-provision-status"
  fi
fi
if [ "${SEEDING_CAMOUFOX_PROVISION:-true}" = "true" ] && [ -x "$APP_ROOT/provision-camoufox.sh" ]; then
  if ! "$APP_ROOT/provision-camoufox.sh" "$DATA_ROOT" >"$DATA_ROOT/camoufox-provision-command" 2>"$DATA_ROOT/camoufox-provision-error"; then
    printf '%s\n' 'unavailable:provision_script_failed' >"$DATA_ROOT/camoufox-provision-status"
  fi
fi
cd "$APP_ROOT"
exec "$NODE" src/server.mjs
SERVICE
chmod 755 "$APP/Contents/MacOS/launch"
chmod 755 "$APP/Contents/MacOS/service"
chmod 755 "$APP/Contents/Resources/app/provision-9router.sh"
chmod 755 "$APP/Contents/Resources/app/provision-camoufox.sh"
chmod 755 "$APP/Contents/Resources/app/update-macos.sh"
plutil -lint "$APP/Contents/Info.plist"
if [ -n "${SEEDING_CODESIGN_IDENTITY:-}" ]; then
  /usr/bin/codesign --force --deep --strict --options runtime --timestamp --sign "$SEEDING_CODESIGN_IDENTITY" "$APP"
  /usr/bin/codesign --verify --deep --strict "$APP"
  printf '%s\n' "signed:$SEEDING_CODESIGN_IDENTITY" > "$APP/Contents/Resources/app/signing-status.txt"
else
  printf '%s\n' 'unsigned:no_codesign_identity_configured' > "$APP/Contents/Resources/app/signing-status.txt"
fi
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/Marketing-Seeding-OS-macOS.zip"
if [ -n "${SEEDING_NOTARY_PROFILE:-}" ]; then
  [ -n "${SEEDING_CODESIGN_IDENTITY:-}" ] || { echo 'SEEDING_NOTARY_PROFILE requires SEEDING_CODESIGN_IDENTITY' >&2; exit 2; }
  /usr/bin/xcrun notarytool submit "$OUTPUT/Marketing-Seeding-OS-macOS.zip" --keychain-profile "$SEEDING_NOTARY_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$APP"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/Marketing-Seeding-OS-macOS.zip"
fi
echo "$APP"
