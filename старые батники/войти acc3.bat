@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if not exist ".env.acc3" (
  if exist "templates\example.env" (
    copy "templates\example.env" ".env.acc3" >nul
    >>".env.acc3" echo.
    >>".env.acc3" echo PROFILE=acc3
    echo Created .env.acc3 from templates\example.env.
    echo.
  ) else (
    echo Missing templates\example.env. Cannot create .env.acc3.
    echo.
    echo Press any key to exit.
    pause >nul
    exit /b 1
  )
)

echo Login acc3.
echo SESSION_STRING will be saved to .env.acc3 after QR login.
echo.

call npm run login:acc3
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%

