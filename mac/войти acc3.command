#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Вход acc3."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc3."
echo

npm run login:acc3
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
