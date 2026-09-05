@echo off
title Stop MG Attendance Kiosk
echo ============================================================
echo   Stopping MG Attendance AI Kiosk Station...
echo ============================================================
echo.

echo [1/3] Closing backend server...
taskkill /f /fi "WINDOWTITLE eq MG Attendance Backend*" >nul 2>&1

echo [2/3] Closing Cloudflare Tunnel...
taskkill /f /im cloudflared.exe >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq Cloudflare Tunnel*" >nul 2>&1

echo [3/3] Closing Kiosk browser...
taskkill /f /im chrome.exe /fi "WINDOWTITLE eq *MG Attendance*" >nul 2>&1
taskkill /f /im msedge.exe /fi "WINDOWTITLE eq *MG Attendance*" >nul 2>&1

echo.
echo ============================================================
echo   All MG Attendance processes have been stopped.
echo ============================================================
ping 127.0.0.1 -n 3 >nul
