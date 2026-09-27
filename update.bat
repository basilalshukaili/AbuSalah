@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM   Abu Salah - Safe update and rebuild. It does NOT open the program.
REM   (Asked for 2026-09-27: "no need for it to auto open the app. It just
REM   updates." Open Abu Salah afterwards the way you normally do.)
REM ============================================================

cd /d "%~dp0"

REM Keep this in one parsed block. The updater temporarily safeguards this
REM batch file while Git advances the project to the latest version.
(
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1" %*
    set "UPDATE_EXIT=!ERRORLEVEL!"

    if not "!UPDATE_EXIT!"=="0" (
        echo.
        echo [ERROR] The update did not complete.
        echo         Local changes were not intentionally discarded.
        pause
    )

    exit /b !UPDATE_EXIT!
)
