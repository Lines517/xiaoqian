@echo off
chcp 65001 >nul
title [Xiaoqian] Listen Together Bridge
cd /d "%~dp0"
echo ============================================
echo   Xiaoqian - Netease Listen Together Bridge
echo ============================================
if not exist "node_modules" (
  echo   first run: installing ...
  call npm install
)
echo.
node bridge.js
echo.
echo   (window can be closed)
pause
