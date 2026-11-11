#!/bin/bash
# 改完代码后重启后台的唱机：重新打包界面 → 停掉启动器拉起的服务 → 重新启动并打开页面。
# 只停 PID 文件里记录的那个进程（也就是唱机.app / 启动器启动的），不碰别的 node 进程。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${HOME}/Library/Application Support/changji/server.pid"
cd "$ROOT"

PORT="${PORT:-$(node -e 'try { const c = require(process.argv[1]); console.log(Number(c.port) || 8787) } catch { console.log(8787) }' "$ROOT/config.json")}"
URL="http://localhost:${PORT}"
health_ok() {
  /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 "${URL}/api/health" >/dev/null 2>&1
}

echo "[唱机] 打包界面…"
npm run build

if [[ -f "$PID_FILE" ]]; then
  pid="$(tr -d '[:space:]' <"$PID_FILE")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    # 变量紧挨中文标点时要加花括号：macOS 自带的 bash 3.2 在 UTF-8 环境下会把"）"的字节当成变量名的一部分
    echo "[唱机] 停止正在运行的服务（pid ${pid}）…"
    kill "$pid"
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "[唱机] 服务没有在 5 秒内退出，请手动结束 pid ${pid} 后再试。" >&2
      exit 1
    fi
  fi
  rm -f "$PID_FILE"
fi

if health_ok; then
  echo "[唱机] ${URL} 上还有别的服务在运行（不是唱机.app 启动的），请先停掉它。" >&2
  exit 1
fi

echo "[唱机] 重新启动…"
# 和 Dock 上的唱机走同一个启动器：服务的 pid 写进 PID 文件，从 Dock 退出时会一并关掉
CHANGJI_DETACH=1 bash "$ROOT/scripts/launch.sh"
for _ in $(seq 1 50); do
  health_ok && break
  sleep 0.2
done
if ! health_ok; then
  echo "[唱机] 没有启动成功，日志：${HOME}/Library/Logs/changji.log" >&2
  exit 1
fi
echo "[唱机] 已重启：${URL}（浏览器里如果还开着旧页面，刷新一下即可）"
