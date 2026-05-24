@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM   Abu Salah - Update to the latest version, then launch
REM ============================================================

cd /d "%~dp0"

echo.
echo ===============================================
echo    Abu Salah - Update
echo ===============================================
echo.

REM 1. Verify Node.js is on PATH
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo         Install Node.js 20+ from https://nodejs.org/
    pause
    exit /b 1
)

REM 2. Verify Git is on PATH
where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git was not found.
    echo         Install Git from https://git-scm.com/
    pause
    exit /b 1
)

REM 3. Download the latest code and force the working copy to match it.
REM    (reset --hard keeps the update bullet-proof: it never hits a merge
REM     conflict, and it leaves the local database/backups untouched because
REM     those live outside the project folder.)
echo Downloading the latest version...
call git fetch origin
if errorlevel 1 (
    echo [ERROR] Could not reach the server. Check the internet connection.
    pause
    exit /b 1
)
call git reset --hard origin/main
if errorlevel 1 (
    echo [ERROR] Update failed while applying the latest code.
    pause
    exit /b 1
)

REM 4. Refresh dependencies in case they changed
echo Updating components (this may take a minute)...
call npm install --no-fund --no-audit
if errorlevel 1 (
    echo [ERROR] Component update failed.
    pause
    exit /b 1
)
type nul > "node_modules\.installed"

REM 5. Rebuild the application
echo Rebuilding...
call npx electron-vite build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

REM 6. Launch the real electron.exe directly so the app keeps running
REM    after this window closes (npx would spawn a shim that dies with it)
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
    echo [ERROR] Electron binary not found after install.
    pause
    exit /b 1
)
echo.
echo Update complete. Launching Abu Salah...
start "Abu Salah" "%ELECTRON_EXE%" "%~dp0out\main\index.js"

REM Give the window a moment to appear
ping -n 2 127.0.0.1 >nul

endlocal
exit /b 0
