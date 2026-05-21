#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Запуск рассылки acc3."
echo

npm run start:acc3
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
