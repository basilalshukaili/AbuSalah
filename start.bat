@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM   Abu Salah Pro - Windows launcher (no compilation required)
REM ============================================================

cd /d "%~dp0"

echo.
echo ===============================================
echo    Abu Salah Pro - Billing System
echo ===============================================
echo.

REM 1. Verify Node.js is on PATH
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH.
    echo         Please install Node.js 20+ from https://nodejs.org/
    pause
    exit /b 1
)

REM 2. Install dependencies on first run
if not exist "node_modules\.installed" (
    echo Installing dependencies, this may take a few minutes...
    call npm install --no-fund --no-audit
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
    type nul > "node_modules\.installed"
)

REM 3. Build production bundles if missing
if not exist "out\main\index.js" (
    echo Building application...
    call npx electron-vite build
    if errorlevel 1 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
)

REM 4. Launch the real electron.exe directly so the app keeps running
REM    after this window closes (npx would spawn a shim that dies with it)
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
    echo [ERROR] Electron binary not found. Delete node_modules\.installed and re-run.
    pause
    exit /b 1
)
echo Launching Abu Salah...
start "Abu Salah" "%ELECTRON_EXE%" "%~dp0out\main\index.js"

REM Give the window a moment to appear
ping -n 2 127.0.0.1 >nul

endlocal
exit /b 0
