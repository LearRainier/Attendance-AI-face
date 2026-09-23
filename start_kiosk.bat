@echo off
setlocal enabledelayedexpansion
title SHC MG Face Attendance System - Kiosk Station

set "PORT=8000"
set "VENV_PY=.venv\Scripts\python.exe"
set "VERCHECK=import sys; sys.exit(0 if (3,10) <= sys.version_info < (3,13) else 1)"
set "DEPCHECK=import uvicorn, fastapi, cv2, deepface"

echo ============================================================
echo      SHC MG FACE ATTENDANCE SYSTEM - KIOSK STATION
echo ============================================================
echo.

cd /d "%~dp0backend"

:: ------------------------------------------------------------
:: 1. Refuse to start if another program already owns the port.
::    Otherwise the browser opens onto THAT program and every
::    page shows "Not Found" instead of the kiosk.
:: ------------------------------------------------------------
netstat -ano -p tcp | findstr /C:":%PORT% " | findstr /I "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port %PORT% is already used by another program.
    echo         The kiosk cannot start, and the browser would show that
    echo         other program's pages instead ^(usually "Not Found"^).
    echo.
    echo         Currently listening on port %PORT%:
    for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /C:":%PORT% " ^| findstr /I "LISTENING"') do (
        for /f "tokens=1 delims=," %%N in ('tasklist /fi "PID eq %%P" /nh /fo csv') do echo           PID %%P  %%N
    )
    echo.
    echo         Close that program, then run this file again.
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 2. Virtual environment. TensorFlow publishes no wheels for
::    Python 3.13+, so a venv built on 3.13/3.14 installs nothing
::    and the server dies with "No module named uvicorn".
:: ------------------------------------------------------------
set "NEED_VENV=0"
if not exist "%VENV_PY%" (
    set "NEED_VENV=1"
) else (
    "%VENV_PY%" -c "!VERCHECK!" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] The existing virtual environment uses a Python version the
        echo        AI libraries do not support. Rebuilding it ...
        rmdir /s /q .venv
        set "NEED_VENV=1"
    )
)

if "!NEED_VENV!"=="1" (
    call :find_python
    if not defined PY_CMD (
        echo [ERROR] No supported Python found. Python 3.10, 3.11 or 3.12 is required
        echo         ^(TensorFlow does not support Python 3.13 or newer yet^).
        echo         Install Python 3.12 from https://www.python.org/downloads/
        echo         and tick "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )
    echo [INFO] First-time setup: creating the Python virtual environment ...
    !PY_CMD! -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create the virtual environment!
        pause
        exit /b 1
    )
)

:: Install dependencies whenever they are missing - not just when the
:: folder is absent. A half-installed venv used to look "ready" here.
"%VENV_PY%" -c "!DEPCHECK!" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Python dependencies. This can take several minutes ...
    "%VENV_PY%" -m pip install --upgrade pip
    "%VENV_PY%" -m pip install -r requirements.txt
    "%VENV_PY%" -c "!DEPCHECK!" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed - see the messages above.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [OK] Virtual environment and dependencies found.
)

:: ------------------------------------------------------------
:: 3. The web interface has to be built before it can be served.
:: ------------------------------------------------------------
if not exist "%~dp0frontend\dist\index.html" (
    echo [INFO] Web interface not built yet - building it now ...
    pushd "%~dp0frontend"
    call npm install
    call npm run build
    popd
    if not exist "%~dp0frontend\dist\index.html" (
        echo [ERROR] The frontend build failed. Open a terminal in the frontend
        echo         folder, run "npm install" then "npm run build", and fix the
        echo         errors it reports.
        echo.
        pause
        exit /b 1
    )
)

:: ------------------------------------------------------------
:: 4. Start the server and wait until it really answers.
:: ------------------------------------------------------------
echo [INFO] Starting AI Face ID server on http://localhost:%PORT% ...
start "MG Attendance Backend" /min "%VENV_PY%" -m uvicorn server:app --host 0.0.0.0 --port %PORT%

echo [INFO] Waiting for the server and AI models to initialise ...
set "READY=0"
where curl.exe >nul 2>&1
if errorlevel 1 (
    ping 127.0.0.1 -n 11 >nul
    set "READY=1"
) else (
    for /l %%A in (1,1,60) do (
        if "!READY!"=="0" (
            ping 127.0.0.1 -n 2 >nul
            curl.exe -sf -o nul http://localhost:%PORT%/api/status && set "READY=1"
        )
    )
)

if "!READY!"=="0" (
    echo.
    echo [ERROR] The server never answered on port %PORT%.
    echo         The "MG Attendance Backend" window probably closed with an error.
    echo         Run this command to see it:
    echo             backend\.venv\Scripts\python.exe -m uvicorn server:app --port %PORT%
    echo.
    pause
    exit /b 1
)

echo [INFO] Launching Kiosk display in Fullscreen (Press F11 to exit fullscreen)...
start "" chrome.exe --start-fullscreen http://localhost:%PORT%/kiosk 2>nul || start "" msedge.exe --start-fullscreen http://localhost:%PORT%/kiosk 2>nul || start "" http://localhost:%PORT%/kiosk

echo.
echo ============================================================
echo   KIOSK STATION IS RUNNING!
echo   - Local Kiosk Display: http://localhost:%PORT%/kiosk
echo   - Admin Dashboard:     http://localhost:%PORT%
echo.
echo   To stop the kiosk server, run stop_kiosk.bat or
echo   close the minimized "MG Attendance Backend" window.
echo ============================================================
echo.
pause
exit /b 0

:: ------------------------------------------------------------
:: Helper: pick an interpreter the AI stack supports.
:: ------------------------------------------------------------
:find_python
set "PY_CMD="
for %%V in (3.12 3.11 3.10) do (
    if not defined PY_CMD (
        py -%%V -c "import sys" >nul 2>&1 && set "PY_CMD=py -%%V"
    )
)
if not defined PY_CMD (
    for %%V in (312 311 310) do (
        if not defined PY_CMD (
            if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
        )
    )
)
if not defined PY_CMD (
    python -c "!VERCHECK!" >nul 2>&1
    if not errorlevel 1 set "PY_CMD=python"
)
goto :eof
