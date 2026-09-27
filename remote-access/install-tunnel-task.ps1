# Abu Salah — one-time setup for the remote-access tunnel (factory PC side)
#
# Run this ONCE, as the normal Windows user who runs the app (no admin
# rights needed — it registers a per-user Scheduled Task, not a system
# service). Re-running it is safe; it just replaces the existing task.
#
# BEFORE running this: copy the private key file you were given to
#   %APPDATA%\AbuSalahTunnel\abusalah_tunnel_key
# It must NOT be placed inside this AbuSalah folder — update.bat can reset
# this folder to match GitHub, and a private key must never be in that
# folder or in git history.
#
# WHAT THIS REGISTERS: a Scheduled Task named "AbuSalahTunnel" that runs
# abusalah-tunnel.ps1 (in this same folder) at log-on, and restarts it
# automatically if it ever stops. It does not open any inbound port or
# change any firewall rule — see abusalah-tunnel.ps1 for what it actually
# does.

$ErrorActionPreference = 'Stop'

$TaskName   = 'AbuSalahTunnel'
$ScriptPath = Join-Path $PSScriptRoot 'abusalah-tunnel.ps1'
$KeyPath    = Join-Path $env:APPDATA 'AbuSalahTunnel\abusalah_tunnel_key'

if (-not (Test-Path $ScriptPath)) {
    Write-Host "ERROR: could not find abusalah-tunnel.ps1 next to this script ($ScriptPath)." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $KeyPath)) {
    Write-Host "ERROR: tunnel key not found at $KeyPath" -ForegroundColor Red
    Write-Host "Copy the private key file you were given to that exact path FIRST, then re-run this script." -ForegroundColor Yellow
    exit 1
}

# A plain file copy (Explorer, or `cp`) keeps this folder's INHERITED
# permissions, which normally allow more than just the current user to read
# the file. Windows' own OpenSSH client refuses to use a private key like
# that at all ("UNPROTECTED PRIVATE KEY FILE... this private key will be
# ignored") and the tunnel fails with "Permission denied (publickey)" --
# confirmed by testing this exact script against a freshly copied key before
# this fix. Locking it down here means nobody running this script has to
# know what an NTFS ACL is.
Write-Host "Restricting the tunnel key file to your Windows account only..."
icacls $KeyPath /inheritance:r | Out-Null
icacls $KeyPath /grant:r "${env:USERNAME}:(R)" | Out-Null
$verify = icacls $KeyPath
Write-Host ($verify -join "`n")

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

# Runs as the current user, only while they're logged on — matches the
# existing "keep the PC awake, keep the app open" precondition for phone
# access (see README). No stored password is needed for this trigger type.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Force | Out-Null

Write-Host "Registered Scheduled Task '$TaskName'." -ForegroundColor Green
Write-Host "Starting it now so the tunnel comes up without waiting for the next log-on..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Last run result: $($info.LastTaskResult) (0 = still running / started OK)"
Write-Host ""
Write-Host "Check %APPDATA%\AbuSalahTunnel\tunnel.log for status, or ask whoever set this up to check https://abusalah.techmate.om from another network."
