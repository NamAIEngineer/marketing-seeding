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
ditto "$SOURCE/desktop/provision-camoufox.sh" "$APP/Contents/Resources/app/provision-camoufox.sh"
ditto "$SOURCE/desktop/update-macos.sh" "$APP/Contents/Resources/app/update-macos.sh"
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
DATA_ROOT="$HOME/Library/Application Support/Marketing Seeding OS"
PORT=4321
mkdir -p "$DATA_ROOT"
chmod 700 "$DATA_ROOT"
for TOKEN in operator automation; do
  FILE="$DATA_ROOT/$TOKEN-token"
  if [ ! -s "$FILE" ]; then
    /usr/bin/openssl rand -hex 32 > "$FILE"
    chmod 600 "$FILE"
  fi
done
export SEEDING_DATA_DIR="$DATA_ROOT"
export SEEDING_OPERATOR_TOKEN=$(cat "$DATA_ROOT/operator-token")
export SEEDING_AUTOMATION_TOKEN=$(cat "$DATA_ROOT/automation-token")
export SEEDING_HOST=127.0.0.1
export SEEDING_PORT=$PORT
if ! /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health/live" >/dev/null 2>&1; then
  LABEL=ai.marketing-seeding.packaged
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>$APP_ROOT/../../MacOS/service</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$DATA_ROOT/server.log</string>
<key>StandardErrorPath</key><string>$DATA_ROOT/server.log</string>
</dict></plist>
EOF
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  /bin/launchctl bootstrap "gui/$(id -u)" "$PLIST"
  READY=0
  for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
    if /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health/live" >/dev/null 2>&1; then READY=1; break; fi
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
DATA_ROOT="$HOME/Library/Application Support/Marketing Seeding OS"
export SEEDING_DATA_DIR="$DATA_ROOT"
export SEEDING_OPERATOR_TOKEN=$(cat "$DATA_ROOT/operator-token")
export SEEDING_AUTOMATION_TOKEN=$(cat "$DATA_ROOT/automation-token")
export SEEDING_HOST=127.0.0.1
export SEEDING_PORT=4321
export SEEDING_9ROUTER_ENDPOINT="${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}"
export SEEDING_NODE_BIN="$APP_ROOT/../bin/node"
export SEEDING_NPM_BIN="$APP_ROOT/../bin/npm"
export PATH="$APP_ROOT/../bin:$APP_ROOT/../lib/node_modules/npm/bin:$PATH"
export SEEDING_BUILD_COMMIT=$(cat "$APP_ROOT/source-commit.txt")
export SEEDING_BUILD_DIRTY=false
export SEEDING_9ROUTER_ENDPOINT="${SEEDING_9ROUTER_ENDPOINT:-http://127.0.0.1:20128/v1}"
export SEEDING_CONTENT_AUTO_PROVISION="${SEEDING_CONTENT_AUTO_PROVISION:-true}"
export SEEDING_CONTENT_MODE="${SEEDING_CONTENT_MODE:-PRODUCTION}"
if [ -x "$APP_ROOT/provision-9router.sh" ]; then
  if ! "$APP_ROOT/provision-9router.sh" "$DATA_ROOT" >"$DATA_ROOT/9router-provision-command" 2>"$DATA_ROOT/9router-provision-error"; then
    printf '%s\n' "provision_failed" >"$DATA_ROOT/9router-provision-status"
  else
    printf '%s\n' "ready" >"$DATA_ROOT/9router-provision-status"
  fi
fi
if [ -x "$APP_ROOT/provision-camoufox.sh" ]; then
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
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/Marketing-Seeding-OS-macOS.zip"
echo "$APP"
