#!/bin/bash
cd "$(dirname "$0")"

echo "Запуск рассылки acc1."
echo

npm run start:acc1
exit $?
