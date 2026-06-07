#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f ".env.acc3" ]; then
  if [ -f "example.env.acc3" ]; then
    cp "example.env.acc3" ".env.acc3"
    echo "Создан .env.acc3 из example.env.acc3."
    echo
  else
    echo "Не найден example.env.acc3. Невозможно создать .env.acc3."
    exit 1
  fi
fi

echo "Вход acc3."
echo "После сканирования QR SESSION_STRING сохранится в .env.acc3."
echo

npm run login:acc3
exit $?
