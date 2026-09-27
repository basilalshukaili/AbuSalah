# Abu Salah — remote access tunnel (factory PC side)
#
# WHAT THIS DOES: dials OUT from this PC to our VPS and forwards ONE local
# port (127.0.0.1:47831, the app's existing LAN/phone server — see
# src/main/http/lan-server.ts) to ONE fixed port on the VPS's own loopback
# (127.0.0.1:8461). It never opens anything for anyone to connect INTO on
# this PC or on this network. If this PC's internet drops, or the VPS is
# unreachable, this script just keeps retrying — it does not print, log, or
# store the invoice/customer data that passes through it.
#
# WHY: so the founder (or, later, the shop) can reach the SAME running app
# from a different network (e.g. from home) at https://abusalah.techmate.om,
# through Caddy on our VPS, which requires a password before it will even
# attempt to reach this PC. That password is NOT in this file or this repo.
#
# WHAT IT NEEDS, which this script does NOT create for you:
#   1. A private key file at the path below (given to you separately —
#      never commit it, never put it inside this cloned repo folder, because
#      update.bat can reset this folder to match GitHub).
#   2. The Abu Salah app itself running (Settings shows its own LAN status;
#      this tunnel is only useful while that server is listening).
#
# Run this once via install-tunnel-task.ps1, which registers it as a
# Scheduled Task that starts at log-on and restarts itself — you should not
# normally need to run this .ps1 file directly.

$ErrorActionPreference = 'Stop'

# ---- fixed configuration — do not change without also updating the VPS ----
$VpsHost      = '187.127.115.143'
$VpsUser      = 'abusalah-tunnel'
$RemotePort   = 8461      # loopback-only on the VPS; the tunnel key can ONLY bind this one
$LocalPort    = 47831     # the app's existing LAN server port (fixed, see README "Phone access")
$KeyPath      = Join-Path $env:APPDATA 'AbuSalahTunnel\abusalah_tunnel_key'
$LogPath      = Join-Path $env:APPDATA 'AbuSalahTunnel\tunnel.log'

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try {
        $dir = Split-Path -Parent $LogPath
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogPath -Value $line
    } catch { }
}

function Resolve-Ssh {
    $cmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # Git for Windows bundles its own OpenSSH client; Git is already a
    # prerequisite for this app (see README "First install"), so this is a
    # reliable fallback if Windows' own OpenSSH Client feature is off.
    $gitSsh = 'C:\Program Files\Git\usr\bin\ssh.exe'
    if (Test-Path $gitSsh) { return $gitSsh }
    return $null
}

if (-not (Test-Path $KeyPath)) {
    Write-Log "ERROR: tunnel key not found at $KeyPath"
    Write-Log "Copy the private key file you were given to that exact path, then re-run this script."
    exit 1
}

$sshExe = Resolve-Ssh
if (-not $sshExe) {
    Write-Log "ERROR: no ssh.exe found (checked PATH and Git's bundled copy)."
    Write-Log "Install Git for Windows (already required by this app) or enable Windows' 'OpenSSH Client' optional feature, then re-run this script."
    exit 1
}

Write-Log "Starting Abu Salah remote-access tunnel using $sshExe"

# Loop forever: a dropped connection (Wi-Fi hiccup, VPS reboot, PC sleep/wake)
# is normal here, not an error — retry with a short, fixed delay rather than
# giving up. ExitOnForwardFailure means a REJECTED bind (wrong port, wrong
# key) fails fast instead of sitting open and silently not working.
while ($true) {
    try {
        & $sshExe `
            -i $KeyPath `
            -o StrictHostKeyChecking=accept-new `
            -o ExitOnForwardFailure=yes `
            -o ServerAliveInterval=15 `
            -o ServerAliveCountMax=3 `
            -o ConnectTimeout=15 `
            -N -R "127.0.0.1:${RemotePort}:127.0.0.1:${LocalPort}" `
            "${VpsUser}@${VpsHost}"
        Write-Log "Tunnel process exited (code $LASTEXITCODE) - reconnecting in 5s."
    } catch {
        Write-Log "Tunnel process failed to start: $($_.Exception.Message) - retrying in 5s."
    }
    Start-Sleep -Seconds 5
}
