#!/bin/bash
# 唱机启动器。
# CHANGJI_DETACH=1：拉起服务、打开浏览器后退出（给 .app / AppleScript 用）。
# 否则会一直挂着，直到服务结束。
LOG="${HOME}/Library/Logs/changji.log"
mkdir -p "$(dirname "$LOG")" "${HOME}/Library/Application Support/changji"
if [[ ! -t 1 ]]; then
  exec >>"$LOG" 2>&1
fi

echo
echo "==== $(date '+%Y-%m-%d %H:%M:%S') pid=$$ detach=${CHANGJI_DETACH:-0} ===="
echo "PATH=${PATH-}"

alert() {
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"好\"} default button 1 with title \"唱机\" with icon stop" >/dev/null 2>&1 || true
}

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"唱机\"" >/dev/null 2>&1 || true
}

resolve_root() {
  if [[ -n "${CHANGJI_ROOT:-}" && -f "${CHANGJI_ROOT}/package.json" ]]; then
    printf '%s' "$CHANGJI_ROOT"
    return
  fi
  local here bundled
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$here/../Resources/project-root" ]]; then
    bundled="$(tr -d '\n' < "$here/../Resources/project-root")"
    if [[ -f "$bundled/package.json" ]]; then
      printf '%s' "$bundled"
      return
    fi
  fi
  if [[ -f "$here/project-root" ]]; then
    bundled="$(tr -d '\n' < "$here/project-root")"
    if [[ -f "$bundled/package.json" ]]; then
      printf '%s' "$bundled"
      return
    fi
  fi
  if [[ "$(basename "$here")" == "MacOS" && -f "$here/../../../package.json" ]]; then
    (cd "$here/../../.." && pwd)
    return
  fi
  if [[ -f "$here/../package.json" ]]; then
    (cd "$here/.." && pwd)
    return
  fi
  return 1
}

ROOT="$(resolve_root || true)"
echo "ROOT=$ROOT"
if [[ -z "${ROOT:-}" || ! -f "$ROOT/package.json" ]]; then
  alert "找不到唱机项目。请在项目目录运行 npm run install-app。"
  exit 1
fi

export HOME="${HOME:-/Users/$(id -un)}"
export LANG="${LANG:-zh_CN.UTF-8}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  for bin in "${HOME}/.nvm/versions/node/"*/bin; do
    if [[ -x "$bin/node" ]]; then
      export PATH="$bin:$PATH"
    fi
  done
fi
for extra in \
  "${HOME}/.volta/bin" \
  "${HOME}/.local/share/fnm/aliases/default/bin" \
  "${HOME}/.asdf/shims"; do
  [[ -d "$extra" ]] && export PATH="$extra:$PATH"
done

NODE="$(command -v node || true)"
NPM="$(command -v npm || true)"
if [[ -z "$NODE" || -z "$NPM" ]]; then
  NODE="$(/bin/zsh -lic 'whence -p node' 2>/dev/null | tail -1 || true)"
  NPM="$(/bin/zsh -lic 'whence -p npm' 2>/dev/null | tail -1 || true)"
fi
echo "node=$NODE"
echo "npm=$NPM"
if [[ -z "$NODE" || -z "$NPM" || ! -x "$NODE" ]]; then
  alert "找不到 Node.js。请先在终端执行 node -v 确认已安装，然后再打开唱机。"
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"

PORT=8787
URL="http://localhost:${PORT}"
PID_FILE="${HOME}/Library/Application Support/changji/server.pid"
CURL="/usr/bin/curl"

health_ok() {
  "$CURL" -fsS --connect-timeout 1 --max-time 2 "${URL}/api/health" >/dev/null 2>&1
}

cd "$ROOT" || {
  alert "无法进入项目目录：$ROOT"
  exit 1
}

if health_ok; then
  echo "already running"
  /usr/bin/open "$URL"
  exit 0
fi

if [[ ! -d node_modules ]]; then
  notify "正在安装依赖，请稍候…"
  if ! "$NPM" install; then
    alert "依赖安装失败。日志：${LOG}"
    exit 1
  fi
fi

if [[ ! -f dist/index.html ]]; then
  notify "正在打包界面，请稍候…"
  if ! "$NPM" run build; then
    alert "界面打包失败。日志：${LOG}"
    exit 1
  fi
fi

notify "正在启动唱机…"
export NODE_ENV=production
nohup env NODE_ENV=production "$NODE" "$ROOT/server/index.js" >/dev/null 2>>"$LOG" &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
echo "server pid=$SERVER_PID"

ok=0
i=0
while [[ $i -lt 50 ]]; do
  if health_ok; then
    ok=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done

if [[ "$ok" != 1 ]]; then
  alert "唱机没有启动成功。可打开日志：${LOG}"
  exit 1
fi

/usr/bin/open "$URL"

if [[ "${CHANGJI_DETACH:-0}" == "1" ]]; then
  echo "detached"
  exit 0
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM
wait "$SERVER_PID"
