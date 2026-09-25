@echo off
setlocal

cd /d "%~dp0"
title Abu Salah - Enable Phone Firewall Rule

REM Administrator rights are required to add a Windows Firewall rule.
net session >nul 2>nul
if errorlevel 1 (
    echo Requesting administrator permission...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$ruleName = 'Abu Salah Mobile';" ^
  "Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule;" ^
  "New-NetFirewallRule -DisplayName $ruleName -Description 'Allow Abu Salah phone access from the local subnet only.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 47831 -Profile Private -RemoteAddress LocalSubnet | Out-Null;" ^
  "Write-Host 'Abu Salah firewall rule added for Private networks only.' -ForegroundColor Green;" ^
  "$profiles = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' };" ^
  "if ($profiles.NetworkCategory -contains 'Public') { Write-Host ''; Write-Host 'Your active network is Public. In Windows Settings, change only your trusted shop/home Wi-Fi profile to Private.' -ForegroundColor Yellow }"

if errorlevel 1 (
    echo.
    echo [ERROR] Windows could not add the firewall rule.
    pause
    exit /b 1
)

echo.
echo Open Abu Salah Settings and use the displayed one-click URL.
pause
exit /b 0
