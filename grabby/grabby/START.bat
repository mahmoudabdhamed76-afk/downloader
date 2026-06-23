@echo off
chcp 65001 >nul
title Grabby
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org  ^(v22+^)
  pause
  exit /b
)

if not exist "bin\yt-dlp.exe" (
  echo.
  echo [!] Tools not downloaded yet. Running SETUP first...
  echo.
  call "%~dp0SETUP.bat"
)

echo.
echo   Grabby is starting...
echo   On this PC:  http://127.0.0.1:7654
echo.
start "" http://127.0.0.1:7654
node server.js
pause
