#!/usr/bin/env bash
# 启动 deepseek-harness-WTAgent Web 服务。
# 用法：bash start.sh   （或 chmod +x start.sh && ./start.sh）

set -euo pipefail

# 仓库根目录（脚本所在目录），脚本必须在仓库内运行
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# DSH 数据目录：跟随仓库，位于仓库根 .dsh-home
# 若环境里已设置 DSH_HOME，一律强制收敛到仓库 home，
# 否则服务会静默落到默认 ~/.dsh，导致历史会话"看起来全没了"。
export DSH_HOME="$REPO_DIR/.dsh-home"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3080}"
# 信任来源主机（服务所在机器的局域网 IP，用于远程浏览器访问）
TRUSTED_HOST="${TRUSTED_HOST:-10.8.11.4}"
LOG_FILE="$REPO_DIR/dsh-web.log"
PID_FILE="$REPO_DIR/dsh-web.pid"

echo "仓库目录: $REPO_DIR"
echo "DSH_HOME : $DSH_HOME"
echo "访问地址: http://$HOST:$PORT （本机 http://127.0.0.1:$PORT）"

# 已在运行则直接提示退出
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "服务已在运行 (PID $(cat "$PID_FILE"))，如需重启请先运行 stop.sh"
  exit 0
fi

# 后台启动；stdout/stderr 写入日志，用 PID 文件记录
nohup pnpm dsh --profile web --host "$HOST" --port "$PORT" --trusted-host "$TRUSTED_HOST" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "启动中 (PID $(cat "$PID_FILE"))，日志: $LOG_FILE"

# 轮询等待端口就绪（最多 30 秒）
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "✅ 服务就绪：http://$HOST:$PORT"
    exit 0
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "❌ 启动失败，请查看日志末尾：$LOG_FILE"
    tail -n 40 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "⚠️ 30 秒内未探测到就绪（可能仍在加载），请稍后访问 http://$HOST:$PORT 并查看日志 $LOG_FILE"
