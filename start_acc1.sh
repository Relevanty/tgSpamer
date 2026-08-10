#!/usr/bin/env bash
echo "Запуск рассылки acc1."
# termux-wake-lock не даст Андроиду убить бота при выключении экрана
termux-wake-lock 
npm run start:acc1
