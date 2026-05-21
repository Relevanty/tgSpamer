#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

if ! ensure_env_file "acc3"; then
  pause_and_exit 1
fi

export AUTH_METHOD=qr
export PROBE_MODE=true
export PROBE_IDLE_MS=1000

echo "Вход acc3."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc3."
echo

npm run start:acc3
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
