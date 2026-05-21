#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

if ! ensure_env_file "acc2"; then
  pause_and_exit 1
fi

export AUTH_METHOD=qr
export PROBE_MODE=true
export PROBE_IDLE_MS=1000

echo "Вход acc2."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc2."
echo

npm run start:acc2
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
