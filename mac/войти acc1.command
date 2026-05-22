#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Вход acc1."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc1."
echo

npm run login:acc1
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
