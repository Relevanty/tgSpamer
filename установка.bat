@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден.
  echo Открываю сайт Node.js.
  start "" "https://nodejs.org/"
  echo Установите Node.js LTS, затем запустите установка.bat снова.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm не найден. Переустановите Node.js с официального сайта.
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)

echo Устанавливаю зависимости...
echo.

call npm install
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Ошибка при установке зависимостей.
  echo.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Зависимости установлены.
echo.
pause
exit /b 0
