#!/usr/bin/env bash
cd "$(dirname "$0")/.."

echo "Запуск рассылки acc1."
# termux-wake-lock не даст Андроиду убить бота при выключении экрана
termux-wake-lock 
npm run start:acc1
