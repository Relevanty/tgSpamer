@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Универсальный вход нового аккаунта.
echo Конфиг будет создан только после успешного QR-входа.
echo.

call node tools/login-new.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Нажмите любую кнопку, чтобы выйти.
pause >nul
exit /b %EXIT_CODE%

