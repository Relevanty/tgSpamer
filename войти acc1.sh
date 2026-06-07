#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f ".env.acc1" ]; then
  if [ -f "example.env.acc1" ]; then
    cp "example.env.acc1" ".env.acc1"
    echo "Создан .env.acc1 из example.env.acc1."
    echo
  else
    echo "Не найден example.env.acc1. Невозможно создать .env.acc1."
    exit 1
  fi
fi

echo "Вход acc1."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc1."
echo

npm run login:acc1
exit $?
