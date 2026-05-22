@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env.acc2" (
  if exist "example.env.acc2" (
    copy "example.env.acc2" ".env.acc2" >nul
    echo Создан .env.acc2 из example.env.acc2.
    echo.
  ) else (
    echo Не найден example.env.acc2. Невозможно создать .env.acc2.
    echo.
    echo Нажмите любую кнопку, чтобы выйти.
    pause >nul
    exit /b 1
  )
)

echo Вход acc2.
echo После сканирования QR SESSION_STRING сохранится в .env.acc2.
echo.

call npm run login:acc2
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Нажмите любую кнопку, чтобы выйти.
pause >nul
exit /b %EXIT_CODE%
