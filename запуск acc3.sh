#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск рассылки acc3."
echo

npm run start:acc3
exit $?
