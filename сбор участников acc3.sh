#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск сбора участников acc3."
echo

npm run parse:acc3
exit $?
