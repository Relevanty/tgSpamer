#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск сбора участников acc1."
echo

npm run parse:acc1
exit $?
