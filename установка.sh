#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo "Node.js не найден."
  echo "Установите Node.js LTS: https://nodejs.org/"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "npm не найден. Переустановите Node.js с официального сайта: https://nodejs.org/"
  exit 1
fi

echo "Устанавливаю зависимости..."
echo

npm install
EXIT_CODE=$?

if [ "$EXIT_CODE" != "0" ]; then
  echo
  echo "Ошибка при установке зависимостей."
  exit $EXIT_CODE
fi

echo
echo "Зависимости установлены."
exit 0
