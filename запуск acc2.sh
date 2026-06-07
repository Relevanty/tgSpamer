#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск рассылки acc2."
echo

npm run start:acc2
exit $?
