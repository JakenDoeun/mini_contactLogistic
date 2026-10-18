# Campus Branch: install or update on Windows 10/11, Home or Pro (plan Revision 4).
#
# Before the first run: install Git for Windows, Node.js 24.21.0 (the Windows .msi from nodejs.org) and Tailscale; sign
# Tailscale in to your tailnet; clone this repository. Then, in PowerShell as administrator, from the clone:
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
#
# To update later: git pull in the clone, then the same command. It:
#  1. checks Node.js, then runs npm ci and npm run build in the clone;
#  2. stops the running app and copies the build to C:\Program Files\CampusBranch\app and Node.js to ...\node
#     (the previous version is kept as app.old);
#  3. creates the standard local account "campusbranch" that only runs the app (random password given only to Task
#     Scheduler, hidden from the sign-in screen) and lets it run a task with nobody signed in;
#  4. creates the data folder C:\ProgramData\CampusBranch that only that account, Administrators and SYSTEM can open;
#  5. registers the task "Campus Branch": at startup with nobody signed in, no time limit, restart on failure;
#  6. keeps the computer awake on mains power (no sleep; closing the lid does nothing), hibernates on a critical
#     battery, and turns on automatic time if it was off;
#  7. starts the app, waits until it answers, shares it on the tailnet with Tailscale Serve, then prints its address
#     and, on a new install, the one-time code for the first account.
#Requires -RunAsAdministrator
param(
  [string]$InstallDir = "$env:ProgramFiles\CampusBranch",
  [string]$DataDir = "$env:ProgramData\CampusBranch",
  [string]$Account = 'campusbranch',
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Campus Branch'
$Source = (Resolve-Path "$PSScriptRoot\..\..").Path
$AppDir = "$InstallDir\app"
$NodeExe = "$InstallDir\node\node.exe"
$LogFile = "$DataDir\logs\serve.log"

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') failed (exit code $LASTEXITCODE)." }
}
# Robocopy empties a folder even when node_modules paths are longer than Remove-Item handles.
function Remove-Folder([string]$dir) {
  if (-not (Test-Path $dir)) { return }
  $empty = New-Item -ItemType Directory -Force -Path "$env:TEMP\campusbranch-empty"
  robocopy $empty.FullName $dir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item $dir -Recurse -Force
}
function Test-BatchRight([string]$sid) {
  $inf = "$env:TEMP\campusbranch-rights-check.inf"
  secedit /export /cfg $inf /areas USER_RIGHTS | Out-Null
  $line = "$(Get-Content $inf | Where-Object { $_ -match '^SeBatchLogonRight' })"
  Remove-Item $inf -Force -ErrorAction SilentlyContinue
  return @{ Has = $line -match [regex]::Escape("*$sid"); Line = $line }
}

# ---- 1. Node.js and the build ----------------------------------------------------------------------------------------
Step 'Checking Node.js and building the app'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw 'Node.js is not installed. Install Node.js 24.21.0 (the Windows .msi from nodejs.org), open a new PowerShell as administrator and run this again.'
}
$version = [version]((& $node --version).Trim().TrimStart('v'))
if ($version.Major -ne 24 -or $version -lt [version]'24.21.0') {
  throw "Node.js 24.21.0 or a later 24.x is required; found $version at $node."
}
if (-not (Test-Path "$Source\package-lock.json") -or -not (Test-Path "$Source\scripts\serve.ts")) {
  throw "$Source is not a Campus Branch clone. Run this script from the clone: deploy\windows\install.ps1"
}
$env:NEXT_TELEMETRY_DISABLED = '1'
Push-Location $Source
try {
  Run 'npm.cmd' @('ci', '--no-audit', '--no-fund')
  Run 'npm.cmd' @('run', 'build')
} finally {
  Pop-Location
}

# ---- 2. Stop the running app and copy the new version ---------------------------------------------------------------
Step 'Stopping the running app'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName }
# Every app process runs the node.exe copied below, so this finds all of them.
$deadline = (Get-Date).AddSeconds(30)
do {
  $left = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $NodeExe })
  $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($left.Count) { Start-Sleep -Seconds 1 }
} while ($left.Count -and (Get-Date) -lt $deadline)
if ($left.Count) { throw "The app is still running ($($left.Count) node.exe). Close it in Task Manager and run this again." }

Step "Copying the app to $InstallDir"
New-Item -ItemType Directory -Force -Path "$InstallDir\node" | Out-Null
Copy-Item $node $NodeExe -Force
robocopy $Source "$AppDir.new" /MIR /XD "$Source\.git" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the app failed (robocopy exit code $LASTEXITCODE)." }
Remove-Folder "$AppDir.old"
if (Test-Path $AppDir) { Rename-Item $AppDir 'app.old' }
Rename-Item "$AppDir.new" 'app'

# ---- 3. The app account ---------------------------------------------------------------------------------------------
Step "Setting up the account $Account"
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes) + 'a1!'
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
if (Get-LocalUser -Name $Account -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $Account -Password $secure -PasswordNeverExpires $true
} else {
  New-LocalUser -Name $Account -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description 'Runs Campus Branch' | Out-Null
}
$hide = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
New-Item -Path $hide -Force | Out-Null
New-ItemProperty -Path $hide -Name $Account -Value 0 -PropertyType DWord -Force | Out-Null

# A task that runs with nobody signed in needs the "Log on as a batch job" right.
$sid = (Get-LocalUser -Name $Account).SID.Value
$right = Test-BatchRight $sid
if (-not $right.Has) {
  $inf = "$env:TEMP\campusbranch-rights"
  $line = if ($right.Line) { "$($right.Line),*$sid" } else { "SeBatchLogonRight = *$sid" }
  Set-Content "$inf.inf" -Encoding Unicode -Value @('[Unicode]', 'Unicode=yes', '[Version]', 'signature="$CHICAGO$"', 'Revision=1', '[Privilege Rights]', $line)
  secedit /configure /db "$inf.sdb" /cfg "$inf.inf" /areas USER_RIGHTS /quiet | Out-Null
  Remove-Item "$inf.*" -Force -ErrorAction SilentlyContinue
}

# ---- 4. Data folder: only the app account, Administrators (S-1-5-32-544) and SYSTEM (S-1-5-18) ---------------------
Step "Locking the data folder $DataDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
icacls $DataDir /inheritance:r /grant:r "${Account}:(OI)(CI)M" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions of $DataDir (icacls exit code $LASTEXITCODE)." }
# Next.js may write its cache inside the build; the rest of the app folder stays read-only for the account.
New-Item -ItemType Directory -Force -Path "$AppDir\.next\cache" | Out-Null
icacls "$AppDir\.next\cache" /grant "${Account}:(OI)(CI)M" | Out-Null

# ---- 5. The task ------------------------------------------------------------------------------------------------------
Step "Registering the task '$TaskName'"
$arguments = "scripts\serve.ts --data-dir=`"$DataDir`" --port=$Port --log=`"$LogFile`""
$action = New-ScheduledTaskAction -Execute $NodeExe -Argument $arguments -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
# Priority 5 = normal; the default 7 also lowers disk priority.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew -Priority 5
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -User "$env:COMPUTERNAME\$Account" -Password $plain -RunLevel Limited -Force | Out-Null
$plain = $null
if (-not (Test-BatchRight $sid).Has) {
  Write-Warning "The account $Account lacks the 'Log on as a batch job' right, so the task may not start at boot. On Windows Pro: secpol.msc > Local Policies > User Rights Assignment > Log on as a batch job > add $Account."
}

# ---- 6. Power and time ------------------------------------------------------------------------------------------------
Step 'Power and time settings'
# On mains power the computer never sleeps and closing the lid does nothing, so phones can reach the app all day.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
# On a critical battery it hibernates (2) instead of shutting off.
powercfg /hibernate on
if ($LASTEXITCODE -ne 0) { Write-Warning 'This computer cannot hibernate; on an empty battery it will shut down instead.' }
else { powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATACTIONCRIT 2 }
powercfg /setactive SCHEME_CURRENT
# SMS checks compare this clock with the gateway phone, so the time must be set automatically.
$w32 = 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Parameters'
if ((Get-ItemProperty $w32).Type -eq 'NoSync') {
  Set-ItemProperty $w32 -Name Type -Value 'NTP'
  Write-Host 'Turned on "Set time automatically".'
}
Set-Service w32time -StartupType Automatic
Start-Service w32time
w32tm /resync /nowait | Out-Null

# ---- 7. Start, check, share ---------------------------------------------------------------------------------------------
Step 'Starting Campus Branch'
Start-ScheduledTask -TaskName $TaskName
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest "http://127.0.0.1:$Port/login" -UseBasicParsing -TimeoutSec 5 | Out-Null
    $up = $true
  } catch {
    if ($_.Exception.Response) { $up = $true }
  }
}
if (-not $up) {
  $result = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
  Write-Warning "Campus Branch did not answer within 2 minutes (task result $result). Last lines of $LogFile`:"
  if (Test-Path $LogFile) { Get-Content $LogFile -Tail 40 }
  throw 'Campus Branch did not start.'
}
Write-Host "The app answers on http://127.0.0.1:$Port"

Step 'Sharing it on the tailnet'
$ts = @("$env:ProgramFiles\Tailscale\tailscale.exe", (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source) |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$address = $null
if (-not $ts) {
  Write-Warning "Tailscale is not installed. Install it, sign in, then run: tailscale serve --bg $Port"
} else {
  & $ts serve --bg $Port
  if ($LASTEXITCODE -ne 0) { Write-Warning "tailscale serve failed. Sign in to Tailscale, then run: tailscale serve --bg $Port" }
  try {
    $address = 'https://' + ((& $ts status --json) -join "`n" | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
  } catch {
    Write-Warning 'Could not read this computer''s Tailscale name (tailscale status).'
  }
  # Without "Run unattended", Tailscale stops when nobody is signed in, so phones lose the app after a reboot.
  try {
    $prefs = (& $ts debug prefs) -join "`n" | ConvertFrom-Json
    if ($prefs.PSObject.Properties.Name -contains 'ForceDaemon' -and -not $prefs.ForceDaemon) {
      Write-Warning 'Turn on Tailscale "Run unattended" (Tailscale icon > Settings > Run unattended), or the app is unreachable after a reboot until someone signs in.'
    }
  } catch {
    Write-Host 'Check once: Tailscale icon > Settings > "Run unattended" is on.'
  }
}

Step 'Done'
if ($address) { Write-Host "Staff open: $address" -ForegroundColor Green }
Push-Location $AppDir
$env:DATA_DIR = $DataDir
try { & $NodeExe scripts\first-run-code.ts } finally { Pop-Location; Remove-Item Env:\DATA_DIR }
Write-Host @"

Data and backups: $DataDir
Log:              $LogFile
Stop:   Stop-ScheduledTask '$TaskName'
Start:  Start-ScheduledTask '$TaskName'
Restore a backup (stop it first, as administrator, in $AppDir):
        `$env:DATA_DIR = '$DataDir'; npm run restore
Remove: Unregister-ScheduledTask '$TaskName' -Confirm:`$false; Remove-LocalUser $Account; then delete $InstallDir
        (and $DataDir, which holds the customer data)
"@
