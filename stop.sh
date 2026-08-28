#!/usr/bin/env bash
# 停止 deepseek-harness-WTAgent Web 服务。
# 用法：bash stop.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$REPO_DIR/dsh-web.pid"

stop_pid() {
  local pid="$1"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    # 等待优雅退出，最多 10 秒后强制结束
    for _ in $(seq 1 10); do
      if ! kill -0 "$pid" 2>/dev/null; then
        return 0
      fi
      sleep 1
    done
    echo "进程 $pid 未在 10 秒内退出，强制结束"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

# 1. 优先用 PID 文件记录的进程（pnpm 包装进程）
if [ -f "$PID_FILE" ]; then
  stop_pid "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
fi

# 2. 兜底：按端口清理监听 3080 的真实进程
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT:-3080}/tcp" 2>/dev/null || true
elif command -v ss >/dev/null 2>&1; then
  for pid in $(ss -ltnp 2>/dev/null | awk '/:3080/ {match($0, /pid=([0-9]+)/, m); print m[1]}' | sort -u); do
    [ -n "$pid" ] && stop_pid "$pid"
  done
fi

sleep 1
if ss -ltn 2>/dev/null | grep -q ':3080'; then
  echo "❌ 端口 3080 仍被占用"
  exit 1
fi
echo "✅ 服务已停止"
