@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Запуск рассылки acc3.
echo.

call npm run start:acc3
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Нажмите любую кнопку, чтобы выйти.
pause >nul
exit /b %EXIT_CODE%
