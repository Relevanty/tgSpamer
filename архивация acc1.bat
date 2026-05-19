@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Архивация acc1.
echo.

call npm run archive:acc1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
