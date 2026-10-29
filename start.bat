@echo off
title SyncTunes Party Server
cd /d "%~dp0"
set "PATH=%~dp0..\tools\node-v20.18.0-win-x64;%PATH%"
echo =============================================================
echo         🎵 STARTING SYNCTUNES PARTY SERVER 🎵
echo =============================================================
echo.
node server.js
pause
