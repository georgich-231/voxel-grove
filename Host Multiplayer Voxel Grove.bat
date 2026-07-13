@echo off
setlocal
cd /d "%~dp0"
title Voxel Grove Multiplayer Host

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Voxel Grove from this folder.
  echo Install the LTS version from https://nodejs.org/
  echo Then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing game dependencies. This can take a few minutes the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
  )
)

echo Starting server and game...
echo Friends on your Wi-Fi should join ws://YOUR-IP:25565
echo In your own game, join ws://127.0.0.1:25565
call npm run friend:host
if errorlevel 1 (
  echo.
  echo Multiplayer host closed with an error.
  pause
)
