@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Архивация acc2.
echo.

call npm run archive:acc2
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
