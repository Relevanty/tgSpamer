#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск сбора участников acc2."
echo

npm run parse:acc2
exit $?
