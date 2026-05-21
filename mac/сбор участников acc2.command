#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "Запуск сбора участников acc2."
echo

npm run parse:acc2
EXIT_CODE=$?

pause_and_exit "$EXIT_CODE"
