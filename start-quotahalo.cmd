@echo off
setlocal
cd /d "%~dp0"
if exist "release\QuotaHalo-1.0.0-x64.exe" (
  start "" "release\QuotaHalo-1.0.0-x64.exe"
  exit /b 0
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo QuotaHalo dependencies are not installed. Run: npm install
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
