@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

echo Archive acc3.
echo.

call npm run archive:acc3
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%

