@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if not exist ".env.acc2" (
  if exist "templates\example.env" (
    copy "templates\example.env" ".env.acc2" >nul
    >>".env.acc2" echo.
    >>".env.acc2" echo PROFILE=acc2
    echo Created .env.acc2 from templates\example.env.
    echo.
  ) else (
    echo Missing templates\example.env. Cannot create .env.acc2.
    echo.
    echo Press any key to exit.
    pause >nul
    exit /b 1
  )
)

echo Login acc2.
echo SESSION_STRING will be saved to .env.acc2 after QR login.
echo.

call npm run login:acc2
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to exit.
pause >nul
exit /b %EXIT_CODE%

