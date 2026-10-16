# Campus Branch: start at boot on Windows (plan Revision 4). Run once, in PowerShell as administrator, from the built
# app folder (after `npm ci` and `npm run build`):   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
#
# It creates a standard local account that only runs the app (its random password is given to Task Scheduler and never
# shown), a data folder only that account and administrators can open, and a scheduled task that starts
# `node scripts\serve.ts` at boot, with nobody logged in. serve.ts restarts the web app after a crash and makes backups.
# It also sets the critical battery action to Hibernate, so an empty battery pauses the app instead of cutting it off.
#Requires -RunAsAdministrator
param(
  [string]$AppDir = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$DataDir = "$env:ProgramData\CampusBranch",
  [string]$Node = (Get-Command node -ErrorAction Stop).Source,
  [string]$Account = 'campusbranch',
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Campus Branch'

if (-not (Test-Path "$AppDir\.next\BUILD_ID")) { throw "No production build in $AppDir. Run npm ci and npm run build there first." }
$version = & $Node --version
if ($version -notmatch '^v24\.') { throw "Node 24 is required, found $version at $Node." }

# 1. The app account: standard user, hidden from the sign-in screen, random password known only to Task Scheduler.
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes) + 'a1!'
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
if (Get-LocalUser -Name $Account -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $Account -Password $secure
} else {
  New-LocalUser -Name $Account -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description 'Runs Campus Branch' | Out-Null
}
$hide = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
New-Item -Path $hide -Force | Out-Null
New-ItemProperty -Path $hide -Name $Account -Value 0 -PropertyType DWord -Force | Out-Null

# 2. Data folder: only the app account, Administrators (S-1-5-32-544) and SYSTEM (S-1-5-18), nothing inherited.
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
icacls $DataDir /inheritance:r /grant:r "${Account}:(OI)(CI)M" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
# Next.js writes its cache inside the build; everything else in the app folder stays read-only for the account.
New-Item -ItemType Directory -Force -Path "$AppDir\.next\cache" | Out-Null
icacls "$AppDir\.next\cache" /grant "${Account}:(OI)(CI)M" | Out-Null

# 3. The task: at startup, whether or not anyone is logged on; no time limit; on battery too; restart if it fails.
$action = New-ScheduledTaskAction -Execute $Node -Argument "scripts\serve.ts --data-dir=`"$DataDir`" --port=$Port" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User $Account -Password $plain -RunLevel Limited -Force | Out-Null
$plain = $null

# 4. Empty battery: hibernate rather than shut off (2 = Hibernate).
powercfg /hibernate on
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATACTIONCRIT 2
powercfg /setactive SCHEME_CURRENT

Start-ScheduledTask -TaskName $TaskName
Write-Host "Campus Branch is installed and starting. Data folder: $DataDir"
Write-Host 'Check once: Settings > Time & language > Date & time > "Set time automatically" is On.'
Write-Host "If not done yet, share the app over Tailscale once: tailscale serve --bg $Port"
Write-Host "Stop: Stop-ScheduledTask '$TaskName'   Start: Start-ScheduledTask '$TaskName'   Remove: Unregister-ScheduledTask '$TaskName'"
