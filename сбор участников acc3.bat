@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Запуск сбора участников acc3.
echo.

call npm run parse:acc3
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Нажмите любую кнопку, чтобы выйти.
pause >nul
exit /b %EXIT_CODE%
