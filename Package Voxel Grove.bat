@echo off
setlocal
cd /d "%~dp0"
title Package Voxel Grove

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required only on the computer that packages the game.
  echo Install the LTS version from https://nodejs.org/
  echo Your friend will not need Node after you send the installer.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies. This can take a few minutes the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
  )
)

echo Building Windows installer...
echo This will bump the patch version, clean old release files, and package the latest game files.
call npm run package:win -- %*
if errorlevel 1 (
  echo.
  echo Packaging failed.
  pause
  exit /b 1
)

echo.
echo Done. Send the Voxel-Grove-Setup file from the release folder to your friend.
pause
