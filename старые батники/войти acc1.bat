@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if not exist ".env.acc1" (
  if exist "templates\example.env" (
    copy "templates\example.env" ".env.acc1" >nul
    >>".env.acc1" echo.
    >>".env.acc1" echo PROFILE=acc1
    echo Created .env.acc1 from templates\example.env.
    echo.
  ) else (
    echo Missing templates\example.env. Cannot create .env.acc1.
    echo.
    echo Press any key to exit.
    pause >nul
    exit /b 1
  )
)

echo Login acc1.
echo SESSION_STRING will be saved to .env.acc1 after QR login.
echo.

call npm run login:acc1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%

