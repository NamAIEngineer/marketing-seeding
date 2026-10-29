#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE=$ROOT
OUTPUT="$ROOT/desktop/dist"
APP="$OUTPUT/Marketing Seeding OS.app"
NODE_BIN=$(command -v node)
SWIFT_BIN=$(command -v swiftc)

test -f "$SOURCE/src/server.mjs"
test -d "$SOURCE/public"
test -f "$NODE_BIN"
test -f "$SWIFT_BIN"
"$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app" "$APP/Contents/Resources/bin"
ditto "$SOURCE/src" "$APP/Contents/Resources/app/src"
ditto "$SOURCE/public" "$APP/Contents/Resources/app/public"
ditto "$SOURCE/scripts" "$APP/Contents/Resources/app/scripts"
cp "$NODE_BIN" "$APP/Contents/Resources/bin/node"
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
export SEEDING_BUILD_COMMIT=$(cat "$APP_ROOT/source-commit.txt")
export SEEDING_BUILD_DIRTY=false
cd "$APP_ROOT"
exec "$NODE" src/server.mjs
SERVICE
chmod 755 "$APP/Contents/MacOS/launch"
chmod 755 "$APP/Contents/MacOS/service"
plutil -lint "$APP/Contents/Info.plist"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/Marketing-Seeding-OS-macOS.zip"
echo "$APP"
