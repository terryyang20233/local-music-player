#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/唱机.app"
RES="$APP/Contents/Resources"
ICONSET="$RES/AppIcon.iconset"
DESKTOP_APP="${HOME}/Desktop/唱机.app"
APPS_DIR="${HOME}/Applications"
APPS_APP="${APPS_DIR}/唱机.app"

chmod +x "$ROOT/scripts/launch.sh"

# 用 AppleScript 小程序做入口：Finder 双击不会拦截 do shell script
TMP_APP="$(mktemp -d)/唱机.app"
osacompile -s -o "$TMP_APP" "$ROOT/scripts/Changji.applescript"
rm -rf "$APP"
ditto "$TMP_APP" "$APP"
rm -rf "$(dirname "$TMP_APP")"

mkdir -p "$RES"
printf '%s' "$ROOT" > "$RES/project-root"
cp "$ROOT/scripts/launch.sh" "$RES/launch.sh"
chmod +x "$RES/launch.sh"

python3 "$ROOT/scripts/make-icon.py" "$RES/icon.png"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
sips -z 16 16 "$RES/icon.png" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$RES/icon.png" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$RES/icon.png" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$RES/icon.png" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$RES/icon.png" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$RES/icon.png" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$RES/icon.png" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$RES/icon.png" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$RES/icon.png" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$RES/icon.png" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"
rm -rf "$ICONSET" "$RES/icon.png"

/usr/libexec/PlistBuddy -c "Set :CFBundleName 唱机" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 唱机" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 唱机" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.changji.player" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.changji.player" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSMultipleInstancesProhibited bool true" "$APP/Contents/Info.plist" 2>/dev/null || true

touch "$APP"

if command -v npm >/dev/null 2>&1; then
  (cd "$ROOT" && npm run build)
fi

xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>/dev/null || true

install_copy() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  ditto "$APP" "$dest"
  xattr -cr "$dest" 2>/dev/null || true
  codesign --force --deep --sign - "$dest" 2>/dev/null || true
}

install_copy "$DESKTOP_APP"
install_copy "$APPS_APP"

echo "已创建：$APP"
echo "已放到桌面：$DESKTOP_APP"
echo "已放到：$APPS_APP"
echo "双击「唱机」即可启动；从程序坞退出会关掉后台服务。"
