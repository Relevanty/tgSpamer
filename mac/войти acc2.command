#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Вход acc2."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc2."
echo

npm run login:acc2
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
