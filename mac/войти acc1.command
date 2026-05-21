#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

if ! ensure_env_file "acc1"; then
  pause_and_exit 1
fi

export AUTH_METHOD=qr
export PROBE_MODE=true
export PROBE_IDLE_MS=1000

echo "Вход acc1."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc1."
echo

npm run start:acc1
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
