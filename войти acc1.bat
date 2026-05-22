@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env.acc1" (
  if exist "example.env.acc1" (
    copy "example.env.acc1" ".env.acc1" >nul
    echo Создан .env.acc1 из example.env.acc1.
    echo.
  ) else (
    echo Не найден example.env.acc1. Невозможно создать .env.acc1.
    echo.
    echo Нажмите любую кнопку, чтобы выйти.
    pause >nul
    exit /b 1
  )
)

echo Вход acc1.
echo После сканирования QR SESSION_STRING сохранится в .env.acc1.
echo.

call npm run login:acc1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Нажмите любую кнопку, чтобы выйти.
pause >nul
exit /b %EXIT_CODE%
