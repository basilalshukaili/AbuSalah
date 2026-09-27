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

    # Recorded so the operator is TOLD whether anything actually arrived. Reported
    # 2026-09-27: "it opens the application but still not working." The most likely
    # reading is that the update ran, found nothing to fetch (the work was still
    # only on the developer's machine), rebuilt the same code and opened it - and
    # every line on screen said success. "Already up to date." does print, but it
    # is one quiet line in the middle of ten, so the run is indistinguishable from
    # one that changed something. An update that reports nothing about WHAT it
    # changed is how a no-op reads as a failure, and a real update reads as a no-op.
    $headBefore = (& git rev-parse HEAD 2>$null | Select-Object -First 1)

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

    # Say plainly what arrived, before the noisy rebuild lines scroll past.
    $headAfter = (& git rev-parse HEAD 2>$null | Select-Object -First 1)
    $newCommits = 0
    if ($headBefore -and $headAfter -and ($headBefore -ne $headAfter)) {
        $countText = (& git rev-list --count "$headBefore..$headAfter" 2>$null | Select-Object -First 1)
        if ($countText) { [void][int]::TryParse($countText.Trim(), [ref] $newCommits) }
    }
    Write-Host ''
    if ($newCommits -gt 0) {
        Write-Host ("NEW VERSION DOWNLOADED - {0} change(s). Rebuilding now." -f $newCommits) -ForegroundColor Green
        Write-Host ("نسخة جديدة - {0} تغيير. جاري التحديث." -f $newCommits) -ForegroundColor Green
    }
    else {
        Write-Host 'ALREADY THE LATEST VERSION - nothing new to download.' -ForegroundColor Yellow
        Write-Host 'If you were expecting a change, it has not been published yet - tell us.' -ForegroundColor Yellow
        Write-Host 'النسخة محدثة بالفعل - لا يوجد جديد.' -ForegroundColor Yellow
    }
    Write-Host ''

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

    # DELIBERATELY DOES NOT LAUNCH THE APP. It used to end with Start-Process on
    # node_modules\electron\dist\electron.exe, which opened a second, dev-style
    # copy alongside however the operator normally starts the program - so the
    # window that appeared was not the one they use, and an update that had
    # genuinely applied still looked like it had not. Asked for directly on
    # 2026-09-27: "no need for it to auto open the app. It just updates."
    #
    # The Electron processes for this project were stopped further up so the
    # files could be replaced, so the operator does re-open the program - by
    # whatever shortcut they always use, which is the point.
    Write-Host ''
    Write-Host 'Update complete.' -ForegroundColor Green
    Write-Host 'Now open Abu Salah the way you normally do.' -ForegroundColor Green
    Write-Host 'تم التحديث. افتح البرنامج كما تفتحه عادة.' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
