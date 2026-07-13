@echo off
setlocal
cd /d "%~dp0"
title Voxel Grove

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

echo Starting Voxel Grove...
call npm run friend:play
if errorlevel 1 (
  echo.
  echo Voxel Grove closed with an error.
  pause
)
