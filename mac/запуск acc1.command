#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Запуск рассылки acc1."
echo

npm run start:acc1
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
