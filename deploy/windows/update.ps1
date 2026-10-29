# Campus Branch: the automatic update (owner, 2026-10-28). install.ps1 registers it as the task "Campus Branch Update",
# run as SYSTEM once, 3 minutes after each start of the computer. It:
#  1. puts right a switch a power cut interrupted (the previous version back, the app task on again);
#  2. stops when the computer runs on battery (it checks again at the next start);
#  3. asks GitHub once for a published release newer than this version (the office never takes a pre-release; the test
#     VM, installed with -Channel test, does);
#  4. skips a version whose build or start failed before (a failed download is tried again at the next start);
#  5. downloads that release and runs its own install.ps1 -Unattended, which builds it beside the running app, waits
#     until no SMS is being sent, saves a backup, switches, and puts the previous version back if the new one does not
#     start. The data folder is never replaced.
# The pages read its progress from <data folder>\update.json. Log: <data folder>\logs\update.log
param(
  [string]$Repo = 'JakenDoeun/mini_contactLogistic',
  [string]$InstallDir = "$env:ProgramFiles\CampusBranch",
  [string]$DataDir = "$env:ProgramData\CampusBranch"
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$AppDir = "$InstallDir\app"
$NodeExe = "$InstallDir\node\node.exe"
$TaskName = 'Campus Branch'
$StatusFile = "$DataDir\update.json"
$Log = "$DataDir\logs\update.log"
$Work = "$env:TEMP\campusbranch-update"
New-Item -ItemType Directory -Force -Path "$DataDir\logs" | Out-Null

function Log([string]$text) { Add-Content -Path $Log -Value "[update $(Get-Date -Format s)] $text" }
function Read-Status { if (Test-Path $StatusFile) { try { return Get-Content $StatusFile -Raw | ConvertFrom-Json } catch { } } return $null }
# Without a byte-order mark, which Windows PowerShell's Set-Content -Encoding UTF8 would add.
function Save-Status([hashtable]$s) { [IO.File]::WriteAllText($StatusFile, ($s | ConvertTo-Json -Compress)) }
# Junctions first, as in install.ps1: removing a folder must never follow one into what it points to.
function Remove-Folder([string]$dir) {
  if (-not (Test-Path $dir)) { return }
  cmd /c "dir /s /b /al `"$dir`" 2>nul" | ForEach-Object { cmd /c "rmdir `"$_`"" }
  $empty = New-Item -ItemType Directory -Force -Path "$Work-empty"
  robocopy $empty.FullName $dir /MIR /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item $dir -Recurse -Force
}
trap {
  Log "Stopped: $($_.Exception.Message)"
  exit 1
}

# ---- 1. An interrupted switch ----------------------------------------------------------------------------------------
# install.ps1 turns the app task off before it swaps the folders and on again after; still "updating" at a start with
# the task off means the computer went off in those seconds, before the new version ever ran: the previous one goes back.
$status = Read-Status
if ($status -and $status.state -eq 'updating') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Disabled' -and (Test-Path "$AppDir.old\scripts\serve.ts")) {
    Remove-Folder "$AppDir.failed"
    if (Test-Path $AppDir) { Rename-Item $AppDir 'app.failed' }
    Rename-Item "$AppDir.old" 'app'
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Log 'The computer went off during a switch; the previous version is back and running.'
  } else {
    Log 'The computer went off during an update; the app task was on, so the version in place stays.'
  }
  Save-Status @{ state = 'failed'; version = "$($status.version)"; retry = $true }
}

# ---- 2. Only on mains power ------------------------------------------------------------------------------------------
# BatteryStatus 1 = discharging; a desktop or a VM has no battery.
$batteries = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
if ($batteries.Count -and -not ($batteries | Where-Object { $_.BatteryStatus -ne 1 })) {
  Log 'On battery: no update now; it checks again at the next start with the charger in.'
  exit 0
}

# ---- 3. Ask GitHub once ------------------------------------------------------------------------------------------------
$channel = if (Test-Path "$InstallDir\channel.txt") { (Get-Content "$InstallDir\channel.txt" -Raw).Trim() } else { 'office' }
$installed = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version
# The update it reports on is in place after all (the computer went off just after the switch): nothing to report.
$status = Read-Status
if ($status -and $status.version -eq $installed) { Remove-Item $StatusFile -Force }
$env:DATA_DIR = $DataDir
$ErrorActionPreference = 'Continue' # a native command's stderr must not count as a failure here
$answer = & $NodeExe --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$AppDir\scripts\update.ts" latest $Repo $channel 2>&1
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) {
  Log "Could not ask GitHub for a newer version ($("$answer".Trim())); it asks again at the next start."
  exit 0
}
$tag = "$answer".Trim()
if (-not $tag) {
  Log "Version $installed is the newest ($channel)."
  exit 0
}
$version = $tag.TrimStart('v')

# ---- 4. A version that failed before -----------------------------------------------------------------------------------
$status = Read-Status
if ($status -and $status.state -eq 'failed' -and $status.version -eq $version -and -not $status.retry) {
  Log "Version $version did not work before; it waits for a newer one."
  exit 0
}

# ---- 5. Download, then the release's own installer ------------------------------------------------------------------
Log "Updating from $installed to $version."
Save-Status @{ state = 'updating'; step = 'download'; version = $version }
try {
  Remove-Folder $Work
  New-Item -ItemType Directory -Force -Path "$Work\source" | Out-Null
  Invoke-WebRequest "https://github.com/$Repo/archive/refs/tags/$tag.zip" -OutFile "$Work\source.zip" -UseBasicParsing
  & "$env:SystemRoot\System32\tar.exe" -xf "$Work\source.zip" -C "$Work\source"
  if ($LASTEXITCODE -ne 0) { throw 'could not unpack it' }
} catch {
  Save-Status @{ state = 'failed'; version = $version; retry = $true }
  Log "The download of $tag failed ($($_.Exception.Message)); it tries again at the next start."
  exit 0
}
$source = (Get-ChildItem "$Work\source" -Directory | Select-Object -First 1).FullName
Save-Status @{ state = 'updating'; step = 'build'; version = $version }
$ErrorActionPreference = 'Continue'
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$source\deploy\windows\install.ps1" `
  -Repo $Repo -InstallDir $InstallDir -DataDir $DataDir -Version $tag -Unattended 2>&1 | ForEach-Object { Add-Content -Path $Log -Value "  $_" }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Remove-Folder $Work
if ($code -eq 0) {
  if (Test-Path $StatusFile) { Remove-Item $StatusFile -Force }
  Log "Updated to $version."
} else {
  # install.ps1 saved why (and whether to try again); this covers a stop before it could.
  if ((Read-Status).state -ne 'failed') { Save-Status @{ state = 'failed'; version = $version; retry = $true } }
  Log "The update to $version did not finish (install.ps1 exit code $code); the lines above say why."
}
