@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

call node tools/run-sequential.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%
