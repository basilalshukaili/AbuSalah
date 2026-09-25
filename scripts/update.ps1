param(
    [switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,

        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,

        [Parameter(Mandatory = $true)]
        [string] $FailureMessage
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

function Get-StashHash {
    $value = & git rev-parse --quiet --verify refs/stash 2>$null
    if ($LASTEXITCODE -eq 0) {
        return ($value | Select-Object -First 1).Trim()
    }
    return $null
}

function Restore-Stash {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Hash
    )

    & git stash apply --index $Hash
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '[ERROR] The update reached a conflict while restoring local changes.' -ForegroundColor Red
        Write-Host '        The safeguard stash was kept, so the changes are recoverable.'
        Write-Host '        Ask for help before editing or running the updater again.'
        exit 1
    }

    $stashLine = & git stash list --format='%H%x09%gd' |
        Where-Object { $_ -like "$Hash`t*" } |
        Select-Object -First 1

    if ($stashLine) {
        $stashReference = ($stashLine -split "`t", 2)[1]
        & git stash drop $stashReference | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host '[WARNING] Update succeeded, but the applied safeguard stash could not be removed.' -ForegroundColor Yellow
        }
    }
}

try {
    Write-Host ''
    Write-Host '==============================================='
    Write-Host '   Abu Salah - Safe Update'
    Write-Host '==============================================='
    Write-Host ''

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js was not found. Install Node.js 20 or newer.'
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm was not found on PATH.'
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git was not found. Install Git for Windows.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
        throw "The project folder is not a Git working copy: $projectRoot"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ensure-electron.cjs'))) {
        throw 'The Electron repair helper is missing.'
    }

    if ($ValidateOnly) {
        Write-Host 'Updater validation passed. No files or remote state were changed.' -ForegroundColor Green
        exit 0
    }

    $gitDir = (& git rev-parse --git-dir).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the Git working copy.'
    }
    $resolvedGitDir = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $gitDir))
    foreach ($operation in @('MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD')) {
        if (Test-Path -LiteralPath (Join-Path $resolvedGitDir $operation)) {
            throw "A Git operation is already in progress ($operation). Finish it before updating."
        }
    }

    Write-Host 'Safeguarding local repairs and other local changes...'
    $previousStash = Get-StashHash
    $stashMessage = 'AbuSalah updater safeguard ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    & git stash push --include-untracked --message $stashMessage | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not safeguard local changes. The update was stopped before changing the project.'
    }
    $currentStash = Get-StashHash
    $createdStash = $currentStash -and ($currentStash -ne $previousStash)

    try {
        Write-Host 'Downloading the latest version...'
        Invoke-Checked -Command 'git' -Arguments @('fetch', 'origin') -FailureMessage 'Could not download the latest version'

        Write-Host 'Applying the update (fast-forward only)...'
        Invoke-Checked -Command 'git' -Arguments @('merge', '--ff-only', 'origin/main') -FailureMessage 'The local branch cannot be safely fast-forwarded'
    }
    catch {
        if ($createdStash) {
            Write-Host 'Restoring safeguarded local changes after the stopped update...'
            Restore-Stash -Hash $currentStash
        }
        throw
    }

    if ($createdStash) {
        Write-Host 'Restoring local repairs and other local changes...'
        Restore-Stash -Hash $currentStash
    }

    # Stop only Electron processes launched from this exact project so files can
    # be refreshed without disturbing unrelated Electron applications.
    $projectProcesses = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        }
    foreach ($process in $projectProcesses) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Updating components...'
    Invoke-Checked -Command 'npm' -Arguments @('install', '--no-fund', '--no-audit') -FailureMessage 'Component update failed'

    Write-Host 'Checking the Electron runtime...'
    Invoke-Checked -Command 'node' -Arguments @('scripts\ensure-electron.cjs') -FailureMessage 'Electron runtime repair failed'

    $electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $electronExe)) {
        throw 'Electron is still missing after the repair step.'
    }
    New-Item -ItemType File -Path (Join-Path $projectRoot 'node_modules\.installed') -Force | Out-Null

    Write-Host 'Rebuilding the application...'
    Invoke-Checked -Command 'npm' -Arguments @('run', 'build') -FailureMessage 'Application build failed'

    $mainEntry = Join-Path $projectRoot 'out\main\index.js'
    if (-not (Test-Path -LiteralPath $mainEntry)) {
        throw 'The production build did not create out\main\index.js.'
    }

    Write-Host ''
    Write-Host 'Update complete. Launching Abu Salah...' -ForegroundColor Green
    $quotedMainEntry = '"' + $mainEntry + '"'
    Start-Process -FilePath $electronExe -ArgumentList $quotedMainEntry -WorkingDirectory $projectRoot
    exit 0
}
catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
