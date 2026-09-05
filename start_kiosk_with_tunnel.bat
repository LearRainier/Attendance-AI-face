@echo off
setlocal enabledelayedexpansion
title MG Attendance - Kiosk Station with Cloudflare Tunnel

echo ============================================================
echo   MG ATTENDANCE - AI KIOSK STATION + CLOUDFLARE TUNNEL
echo ============================================================
echo.

cd /d "%~dp0backend"

:: 1. Check if virtual environment already exists
if exist ".venv\Scripts\python.exe" (
    echo [OK] Python virtual environment detected.
    goto :check_tunnel
)

:: 2. If virtual environment is missing, verify Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python is not installed or not in system PATH!
        echo Please download and install Python 3.10 or 3.11 from https://www.python.org/
        echo Make sure to check "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )
    set "SYS_PYTHON=py"
) else (
    set "SYS_PYTHON=python"
)

echo [INFO] First-time setup: Creating Python virtual environment...
%SYS_PYTHON% -m venv .venv
if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment!
    pause
    exit /b 1
)

echo [INFO] Installing required Python dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Dependency installation failed!
    pause
    exit /b 1
)

:check_tunnel
:: 3. Locate cloudflared executable
set "CF_EXE="
where cloudflared.exe >nul 2>&1
if not errorlevel 1 set "CF_EXE=cloudflared.exe"

if not defined CF_EXE if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF_EXE=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF_EXE if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF_EXE=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF_EXE if exist "%~dp0cloudflared.exe" set "CF_EXE=%~dp0cloudflared.exe"
if not defined CF_EXE if exist "%~dp0backend\cloudflared.exe" set "CF_EXE=%~dp0backend\cloudflared.exe"

:: 4. Start backend server
echo [INFO] Starting AI Face ID server on http://localhost:8000...
start "MG Attendance Backend" /min ".venv\Scripts\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000

:: 5. Start Cloudflare Tunnel if installed
if defined CF_EXE (
    echo [INFO] Launching Cloudflare Tunnel...
    if not exist "%~dp0backend\data" mkdir "%~dp0backend\data"
    if exist "%~dp0backend\data\tunnel.log" del /f /q "%~dp0backend\data\tunnel.log" >nul 2>&1
    start "Cloudflare Tunnel" "!CF_EXE!" tunnel --url http://127.0.0.1:8000 --logfile "%~dp0backend\data\tunnel.log"
) else (
    echo [WARNING] cloudflared.exe not found!
    echo Remote tunnel will not start. Download cloudflared from:
    echo https://github.com/cloudflare/cloudflared/releases
    echo.
)

:: 6. Wait for server and AI models to initialize
echo [INFO] Waiting for server and AI models to initialize...
where curl.exe >nul 2>&1
if errorlevel 1 (
    ping 127.0.0.1 -n 6 >nul
) else (
    set /a attempts=0
    :wait_server
    ping 127.0.0.1 -n 2 >nul
    set /a attempts+=1
    curl.exe -s -o nul http://localhost:8000/api/status >nul 2>&1
    if errorlevel 1 (
        if !attempts! lss 25 goto :wait_server
    )
)

:: 7. Detect public Cloudflare URL if tunnel was launched
set "TUNNEL_URL="
if defined CF_EXE (
    ping 127.0.0.1 -n 3 >nul
    if exist "%~dp0backend\data\tunnel.log" (
        for /f "tokens=*" %%u in ('.venv\Scripts\python.exe scripts\get_tunnel_url.py') do (
            set "TUNNEL_URL=%%u"
        )
    )
)

:: 8. Launch Kiosk in fullscreen
echo [INFO] Opening Kiosk display in Fullscreen (Press F11 to exit fullscreen)...
start "" chrome.exe --start-fullscreen http://localhost:8000/kiosk 2>nul || start "" msedge.exe --start-fullscreen http://localhost:8000/kiosk 2>nul || start "" http://localhost:8000/kiosk

echo.
echo ============================================================
echo   KIOSK STATION IS RUNNING!
echo   - Local Kiosk Display: http://localhost:8000/kiosk
echo   - Local Dashboard:     http://localhost:8000
if defined TUNNEL_URL (
echo   - Public Online URL:   !TUNNEL_URL!
) else (
echo   - Cloudflare Window:   Check "Cloudflare Tunnel" window for URL
)
echo.
echo   To stop the kiosk server, run stop_kiosk.bat or
echo   close the minimized "MG Attendance Backend" window.
echo ============================================================
echo.
pause
