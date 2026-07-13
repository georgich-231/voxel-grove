@echo off
setlocal
cd /d "%~dp0"
title Voxel Grove Dedicated Server

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the Voxel Grove server.
  echo Install the LTS version from https://nodejs.org/
  echo Then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing server dependencies. This can take a few minutes the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
  )
)

echo Starting dedicated server on port 25565...
echo Keep this window open while people play.
call npm run server
pause
