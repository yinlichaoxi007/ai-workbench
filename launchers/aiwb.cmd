@echo off
setlocal
set "REPO=%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 20 or newer from https://nodejs.org/
  exit /b 3
)
node "%REPO%\src\cli\main.mjs" %*
exit /b %errorlevel%
