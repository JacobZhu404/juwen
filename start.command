#!/usr/bin/env bash
# 一键启动聚问 - 大模型聚合对比
# 双击此文件或从终端执行均可

set -e
cd "$(dirname "$0")"

PORT="${PORT:-5178}"
URL="http://localhost:$PORT"

# 如果端口已被占用，直接打开页面
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "✅ 聚问已在运行，打开 $URL"
  open "$URL"
  exit 0
fi

echo "→ 启动聚问服务 (端口 $PORT)..."
PORT="$PORT" npm start &
PID=$!

sleep 3
if kill -0 "$PID" 2>/dev/null; then
  echo "✅ 服务已启动！打开 $URL"
  open "$URL"
  wait "$PID"
else
  echo "❌ 服务启动失败，请查看上方日志"
  exit 1
fi
