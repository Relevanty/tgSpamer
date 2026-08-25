@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

echo Start campaign acc1.
echo.

call npm run start:acc1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%

