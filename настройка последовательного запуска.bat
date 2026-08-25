@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

call node tools/setup-sequential.js
set "EXIT_CODE=%ERRORLEVEL%"

exit /b %EXIT_CODE%
