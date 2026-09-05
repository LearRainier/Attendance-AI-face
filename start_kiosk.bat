@echo off
setlocal enabledelayedexpansion
title MG Attendance - Kiosk Station

echo ============================================================
echo          MG ATTENDANCE - AI KIOSK STATION
echo ============================================================
echo.

cd /d "%~dp0backend"

:: 1. Check if virtual environment already exists
if exist ".venv\Scripts\python.exe" (
    echo [OK] Virtual environment found.
    goto :start_server
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

:start_server
echo [INFO] Starting AI Face ID server on http://localhost:8000...
start "MG Attendance Backend" /min ".venv\Scripts\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000

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

echo [INFO] Launching Kiosk display in Fullscreen (Press F11 to exit fullscreen)...
start "" chrome.exe --start-fullscreen http://localhost:8000/kiosk 2>nul || start "" msedge.exe --start-fullscreen http://localhost:8000/kiosk 2>nul || start "" http://localhost:8000/kiosk

echo.
echo ============================================================
echo   KIOSK STATION IS RUNNING!
echo   - Local Kiosk Display: http://localhost:8000/kiosk
echo   - Admin Dashboard:     http://localhost:8000
echo.
echo   To stop the kiosk server, run stop_kiosk.bat or
echo   close the minimized "MG Attendance Backend" window.
echo ============================================================
echo.
pause
