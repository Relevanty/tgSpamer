@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env.acc3" (
  if exist "example.env.acc3" (
    copy "example.env.acc3" ".env.acc3" >nul
    echo Создан .env.acc3 из example.env.acc3.
    echo.
  ) else (
    echo Не найден example.env.acc3. Невозможно создать .env.acc3.
    echo.
    pause
    exit /b 1
  )
)

set "AUTH_METHOD=qr"
set "PROBE_MODE=true"
set "PROBE_IDLE_MS=1000"

echo Вход acc3.
echo После сканирования QR SESSION_STRING сохранится в .env.acc3.
echo.

call npm run start:acc3
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
