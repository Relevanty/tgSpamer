#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

if ! require_node_and_npm; then
  pause_and_exit 1
fi

echo "Устанавливаю зависимости..."
echo

npm install
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  echo
  echo "Ошибка при установке зависимостей."
  pause_and_exit "$EXIT_CODE"
fi

echo
echo "Зависимости установлены."
pause_and_exit 0
