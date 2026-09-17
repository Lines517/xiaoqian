@echo off
chcp 65001 >nul
title [Xiaoqian] Netease API
cd /d "%~dp0.."
echo ============================================
echo   1/2  installing NeteaseCloudMusicApi ...
echo ============================================
if not exist "ncm-api" mkdir ncm-api
cd ncm-api
if not exist "node_modules\NeteaseCloudMusicApi\app.js" (
  call npm init -y >nul 2>&1
  call npm install NeteaseCloudMusicApi
)
echo.
echo ============================================
echo   2/2  starting  (port 3000)
echo ============================================
echo   Keep this window open !
echo.
set PORT=3000
node node_modules\NeteaseCloudMusicApi\app.js
echo.
echo   (the API has stopped)
pause
