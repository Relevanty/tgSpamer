#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f ".env.acc2" ]; then
  if [ -f "example.env.acc2" ]; then
    cp "example.env.acc2" ".env.acc2"
    echo "Создан .env.acc2 из example.env.acc2."
    echo
  else
    echo "Не найден example.env.acc2. Невозможно создать .env.acc2."
    exit 1
  fi
fi

echo "Вход acc2."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc2."
echo

npm run login:acc2
exit $?
