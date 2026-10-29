# Campus Branch: install or update on Windows 10 (1803 or later) or 11, Home or Pro, x64 or ARM64 (plan Revision 4).
#
# Download this one file and run it; it fetches and checks everything else:
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Run the same command again to update. It asks for administrator rights if needed, then:
#  1. installs Tailscale if missing (checked against its published SHA-256), keeps it running with nobody signed in
#     ("Run unattended"), and asks you to sign in once if this computer is not on your tailnet yet;
#  2. downloads the app (the newest published GitHub Release, or -Version, or -Branch, or uses the clone this script
#     sits in) and its own Node.js 24.21.0 (checked against nodejs.org's SHA-256 list) into
#     C:\Program Files\CampusBranch; no system Node.js or Git needed;
#  3. builds it next to the running version, then stops the app, saves a backup and swaps the folders (the previous
#     one kept as app.old), so the app is down only for seconds; if the new version does not answer, the previous one
#     goes back (with the database as it was, when the new version changed it);
#  4. creates the standard local account "campusbranch" that only runs the app (random password given only to Task
#     Scheduler, hidden from the sign-in screen) with the right to run while nobody is signed in;
#  5. creates the data folder C:\ProgramData\CampusBranch that only that account, Administrators and SYSTEM can open,
#     and the shared folder "Campus Branch Imports" (Public Documents, with a desktop shortcut) for the courier export;
#  6. registers the task "Campus Branch": at startup with nobody signed in, no time limit, restart on failure;
#  7. keeps the computer awake on mains power (no sleep; closing the lid does nothing), hibernates on a critical
#     battery, and turns on automatic time if it was off;
#  8. starts the app, waits until it answers, shares it on the tailnet with Tailscale Serve, then prints its address
#     and, on a new install, the one-time code for the first account;
#  9. registers the task "Campus Branch Update" (deploy/windows/update.ps1): once, 3 minutes after each start, it
#     installs a newer published release by running that release's install.ps1 -Unattended. -Channel test (the test
#     VM) also takes pre-releases; the office never does.
# -Unattended is for that task: no questions, it waits until no SMS is being sent before the switch, and it reports
# its steps in the data folder's update.json for the pages.
param(
  [string]$Repo = 'JakenDoeun/mini_contactLogistic',
  [string]$Branch = 'main', # used only when given, or when the repository has no published release yet
  [string]$Version = '', # a release tag such as v0.2.0; empty: the newest published release
  [ValidateSet('', 'office', 'test')]
  [string]$Channel = '', # empty keeps the computer's channel (office on a new install)
  [switch]$Unattended,
  [string]$InstallDir = "$env:ProgramFiles\CampusBranch",
  [string]$DataDir = "$env:ProgramData\CampusBranch",
  [string]$Account = 'campusbranch',
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$StatusFile = "$DataDir\update.json"
$Shown = $Version.TrimStart('v')
$script:Retry = $true # a failed download or check is tried again at the next start; a failed build or start is not
# The pages show the updater's steps from this file; only the updater's own run writes it.
function Set-UpdateStatus([hashtable]$status) {
  if ($Unattended) { [IO.File]::WriteAllText($StatusFile, ($status | ConvertTo-Json -Compress)) }
}
$ProgressPreference = 'SilentlyContinue' # the progress bar makes downloads in Windows PowerShell 5.1 very slow

# ---- Administrator rights: reopen this script elevated, in a window that stays open ---------------------------------
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $forward = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  foreach ($p in $PSBoundParameters.GetEnumerator()) {
    if ($p.Value -is [switch]) { if ($p.Value) { $forward += "-$($p.Key)" } }
    else { $forward += @("-$($p.Key)", "`"$($p.Value)`"") }
  }
  Write-Host 'Asking for administrator rights; the installation continues in the new window.'
  Start-Process powershell.exe -Verb RunAs -ArgumentList $forward
  exit
}
trap {
  Write-Host "`nInstallation stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Fix the problem above, then run this script again; it continues where it can.' -ForegroundColor Red
  # Stop-App disables the task; turn it back on so the version in place keeps running.
  Enable-ScheduledTask -TaskName 'Campus Branch' -ErrorAction SilentlyContinue | Out-Null
  Start-ScheduledTask -TaskName 'Campus Branch' -ErrorAction SilentlyContinue
  try { Set-UpdateStatus @{ state = 'failed'; version = $Shown; retry = $script:Retry } } catch { }
  exit 1
}
# nodejs.org, GitHub and Tailscale accept TLS 1.2 or later only; older Windows PowerShell may not offer it by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$NodeVersion = '24.21.0'
$TaskName = 'Campus Branch'
$AppDir = "$InstallDir\app"
$NodeDir = "$InstallDir\node"
$NodeExe = "$NodeDir\node.exe"
$LogFile = "$DataDir\logs\serve.log"
$TailscaleExe = "$env:ProgramFiles\Tailscale\tailscale.exe"
$Work = "$env:TEMP\campusbranch-install"
$cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if (-not [Environment]::Is64BitOperatingSystem -or $cpu -notin @('AMD64', 'ARM64')) {
  throw "Campus Branch needs 64-bit Windows on an x64 or ARM64 processor; this is $cpu."
}
# Node.js 24 and Tailscale need Windows 10 version 1809 (build 17763) or later.
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 17763) {
  throw "This Windows is too old (build $build). Update it in Settings > Update & Security > Windows Update to Windows 10 version 1809 or later, then run this again."
}
# Downloads, the build beside the running version and the previous version need about 3 GB.
$freeGB = [math]::Floor((Get-PSDrive ($env:ProgramFiles.Substring(0, 1))).Free / 1GB)
if ($freeGB -lt 3) {
  throw "Only $freeGB GB is free on drive $($env:ProgramFiles.Substring(0, 2)); about 3 GB is needed. Free some space, then run this again."
}
$NodeArch = if ($cpu -eq 'ARM64') { 'arm64' } else { 'x64' }
$TailscaleArch = if ($cpu -eq 'ARM64') { 'arm64' } else { 'amd64' }

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Get-File([string]$url, [string]$sha256) {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  $file = Join-Path $Work ([IO.Path]::GetFileName(([uri]$url).AbsolutePath))
  Write-Host "Downloading $url"
  Invoke-WebRequest $url -OutFile $file -UseBasicParsing
  if ($sha256 -and (Get-FileHash $file -Algorithm SHA256).Hash -ne $sha256) {
    Remove-Item $file -Force
    throw "The download of $url does not match its published SHA-256; it was deleted. Try again later."
  }
  return $file
}
function Expand-Zip([string]$zip, [string]$dest) {
  Remove-Folder $dest
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $tar = "$env:SystemRoot\System32\tar.exe"
  if (Test-Path $tar) {
    & $tar -xf $zip -C $dest
    if ($LASTEXITCODE -ne 0) { throw "Could not unpack $zip." }
  } else {
    Expand-Archive $zip -DestinationPath $dest -Force
  }
}
# Junctions are unlinked first: robocopy and Remove-Item would follow them and delete what they point to (the
# Next.js build links its external packages with junctions). Robocopy then empties the folder even when node_modules
# paths are longer than Remove-Item handles.
function Remove-Folder([string]$dir) {
  if (-not (Test-Path $dir)) { return }
  cmd /c "dir /s /b /al `"$dir`" 2>nul" | ForEach-Object { cmd /c "rmdir `"$_`"" }
  $empty = New-Item -ItemType Directory -Force -Path "$Work-empty"
  robocopy $empty.FullName $dir /MIR /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item $dir -Recurse -Force
}
function Copy-Folder([string]$from, [string]$to, [string[]]$skip) {
  $exclude = if ($skip) { @('/XD') + $skip } else { @() }
  robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP @exclude | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy exit code $LASTEXITCODE)." }
}
# Every app process runs the node.exe in $NodeDir, so this finds all of them, a web app left behind included.
function Stop-App {
  # Disabled first: the every-minute trigger would start it again while files are being swapped.
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $TaskName | Out-Null
    Stop-ScheduledTask -TaskName $TaskName
  }
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $left = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $NodeExe })
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($left.Count) { Start-Sleep -Seconds 1 }
  } while ($left.Count -and (Get-Date) -lt $deadline)
  if ($left.Count) { throw "Campus Branch is still running ($($left.Count) node.exe). End it in Task Manager." }
}
function Get-TailscaleState {
  $ErrorActionPreference = 'Continue' # a warning on stderr must not count as a failure here
  try { return ((& $TailscaleExe status --json 2>$null) -join "`n" | ConvertFrom-Json).BackendState } catch { return $null }
}
# New-Item -Force on an existing registry key would erase its other values, so only create a missing key.
function Set-RegistryValue([string]$key, [string]$name, $value, [string]$type) {
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name $name -Value $value -PropertyType $type -Force | Out-Null
}
function Test-BatchRight([string]$sid) {
  $inf = "$Work\rights-check.inf"
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  secedit /export /cfg $inf /areas USER_RIGHTS | Out-Null
  $line = "$(Get-Content $inf | Where-Object { $_ -match '^SeBatchLogonRight' })"
  Remove-Item $inf -Force -ErrorAction SilentlyContinue
  # secedit lists a local account by name, not by SID.
  $holders = if ($line) { ($line -split '=', 2)[1] -split ',' | ForEach-Object { $_.Trim() } } else { @() }
  return @{ Has = ($holders -contains "*$sid") -or ($holders -contains $Account); Line = $line }
}

# ---- 1. Tailscale: installed, unattended, signed in (the only step that may need you) --------------------------------
Step 'Tailscale'
# Run unattended: Tailscale keeps running with nobody signed in, so phones reach the app after a reboot.
$policy = 'HKLM:\SOFTWARE\Policies\Tailscale'
$policyChanged = (Get-ItemProperty $policy -ErrorAction SilentlyContinue).UnattendedMode -ne 'always'
Set-RegistryValue $policy 'UnattendedMode' 'always' 'String'
if (-not (Test-Path $TailscaleExe)) {
  $index = Invoke-RestMethod 'https://pkgs.tailscale.com/stable/?mode=json' -UseBasicParsing
  $msiName = $index.MSIs.$TailscaleArch
  if (-not $msiName) { throw "Tailscale offers no installer for $TailscaleArch." }
  $sum = (Get-Content (Get-File "https://pkgs.tailscale.com/stable/$msiName.sha256") -Raw).Trim().Split()[0]
  $msi = Get-File "https://pkgs.tailscale.com/stable/$msiName" $sum
  Write-Host "Installing $msiName"
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -notin @(0, 3010)) { throw "The Tailscale installer failed (exit code $($p.ExitCode))." }
} elseif ($policyChanged) {
  Restart-Service Tailscale
}
$state = $null
for ($i = 0; $i -lt 30 -and -not $state; $i++) { Start-Sleep -Seconds 2; $state = Get-TailscaleState }
if (-not $state) { throw 'The Tailscale service does not answer. Restart the computer and run this script again.' }
if ($state -ne 'Running' -and $Unattended) {
  throw 'Tailscale is not signed in on this computer. Sign in from the Tailscale icon next to the clock; the update is tried again at the next start.'
}
if ($state -ne 'Running') {
  Write-Host 'Sign this computer in to your tailnet: open the link printed below in a browser and sign in.' -ForegroundColor Yellow
  Write-Host '(Use the same Tailscale account as the staff phones. The script continues by itself afterwards.)'
  & $TailscaleExe up --unattended
  if ($LASTEXITCODE -ne 0 -or (Get-TailscaleState) -ne 'Running') {
    throw 'Tailscale is not signed in. Sign in from the Tailscale icon next to the clock, then run this script again.'
  }
}
# The app's own account cannot ask Tailscale for this name on Windows, so the task passes it to the app.
$address = 'https://' + "$(((& $TailscaleExe status --json) -join "`n" | ConvertFrom-Json).Self.DNSName)".TrimEnd('.')
if ($address -eq 'https://') { throw 'Tailscale reports no name for this computer. Turn on MagicDNS in the Tailscale admin console > DNS, then run this again.' }
Write-Host "Tailscale is running; this computer is $address"

# ---- 2. Node.js for the app (private copy, never the system one) ----------------------------------------------------
Step "Node.js $NodeVersion"
if ((Test-Path $NodeExe) -and (& $NodeExe --version).Trim() -eq "v$NodeVersion") {
  Write-Host "Already in $NodeDir"
} else {
  $name = "node-v$NodeVersion-win-$NodeArch"
  $sums = Get-Content (Get-File "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt")
  $sum = ($sums | Where-Object { $_ -match "\s$name\.zip$" }) -split '\s+' | Select-Object -First 1
  if (-not $sum) { throw "nodejs.org lists no $name.zip." }
  $zip = Get-File "https://nodejs.org/dist/v$NodeVersion/$name.zip" $sum
  Expand-Zip $zip "$Work\node"
  Stop-App
  Copy-Folder "$Work\node\$name" $NodeDir
}
$env:Path = "$NodeDir;$env:Path"
$env:NEXT_TELEMETRY_DISABLED = '1'
# This npm is pinned with Node.js above; its "new version available" notice does not apply.
$env:npm_config_update_notifier = 'false'

# ---- 3. The app: download (or take the clone), build beside the running version, swap ------------------------------
Step 'Getting the app'
$clone = Join-Path $PSScriptRoot '..\..'
if (Test-Path (Join-Path $clone 'scripts\serve.ts')) {
  $from = (Resolve-Path $clone).Path
  Write-Host "Using the clone $from"
} else {
  $tag = $Version
  if (-not $tag -and -not $PSBoundParameters.ContainsKey('Branch')) {
    try {
      $tag = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing).tag_name
    } catch {
      Write-Host "$Repo has no published release yet; installing branch $Branch."
    }
  }
  $zip = if ($tag) { Get-File "https://github.com/$Repo/archive/refs/tags/$tag.zip" } else { Get-File "https://github.com/$Repo/archive/refs/heads/$Branch.zip" }
  Expand-Zip $zip "$Work\source"
  $from = (Get-ChildItem "$Work\source" -Directory | Select-Object -First 1).FullName
  $what = if ($tag) { "Version $tag" } else { "Branch $Branch" }
  if (-not (Test-Path "$from\scripts\serve.ts")) { throw "$what of $Repo has no scripts\serve.ts; it is not a Campus Branch version that installs." }
  Write-Host "$what of $Repo"
}
Copy-Folder $from "$AppDir.new" @('.git', 'node_modules', '.next')

Step 'Building (a few minutes)'
Push-Location "$AppDir.new"
try {
  & "$NodeDir\npm.cmd" ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit code $LASTEXITCODE)." }
  $script:Retry = $false # the same code builds the same way next time
  & "$NodeDir\npm.cmd" run build
  if ($LASTEXITCODE -ne 0) { throw "The build failed (exit code $LASTEXITCODE); the running version is unchanged." }
  $script:Retry = $true
} finally {
  Pop-Location
}

# The new version's helpers (scripts/update.ts), run with this Node.js on the data folder.
function Invoke-Helper([string]$app, [string[]]$helperArgs) {
  $env:DATA_DIR = $DataDir
  $ErrorActionPreference = 'Continue' # a native command's stderr must not count as a failure here
  $out = & $NodeExe --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$app\scripts\update.ts" @helperArgs 2>&1
  $script:HelperCode = $LASTEXITCODE
  return "$out".Trim()
}
if ($Unattended) {
  # An SMS being handed to the phone, or a batch sending: switch only once it is quiet (owner, 2026-10-27).
  while ($true) {
    $out = Invoke-Helper "$AppDir.new" @('busy')
    if ($script:HelperCode -eq 0) { break }
    if ($script:HelperCode -ne 3) { throw "Could not check whether SMS are being sent: $out" }
    Set-UpdateStatus @{ state = 'updating'; step = 'wait'; version = $Shown }
    Start-Sleep -Seconds 60
  }
  # Open pages ask every 3 seconds while an update runs; this lets them show the switch before the app stops.
  Set-UpdateStatus @{ state = 'updating'; step = 'switch'; version = $Shown }
  Start-Sleep -Seconds 8
}

Step 'Swapping in the new version'
Stop-App
# A copy with every last change, taken after the app stopped and before the new version can touch the database.
if (Test-Path "$DataDir\branch.db") {
  $out = Invoke-Helper "$AppDir.new" @('backup')
  if ($script:HelperCode -ne 0) { throw "Could not save a backup before the switch, so nothing was switched: $out" }
  Write-Host "Backup before the switch: $out"
}
Remove-Folder "$AppDir.old"
if (Test-Path $AppDir) { Rename-Item $AppDir 'app.old' }
Rename-Item "$AppDir.new" 'app'
# On Windows the build links its external packages (better-sqlite3) with junctions whose targets are absolute, so
# they still point into app.new; point them at app.
Get-ChildItem "$AppDir\.next\node_modules" -Force -ErrorAction SilentlyContinue | Where-Object { $_.LinkType -eq 'Junction' } |
  ForEach-Object {
    $target = "$($_.Target)".Replace("$AppDir.new\", "$AppDir\")
    if (-not (Test-Path $target)) { throw "The build links $($_.Name) to $target, which does not exist." }
    cmd /c "rmdir `"$($_.FullName)`""
    New-Item -ItemType Junction -Path $_.FullName -Target $target | Out-Null
  }

# ---- 4. The app account ---------------------------------------------------------------------------------------------
Step "Account $Account"
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes) + 'a1!'
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
if (Get-LocalUser -Name $Account -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $Account -Password $secure -PasswordNeverExpires $true
} else {
  New-LocalUser -Name $Account -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description 'Runs Campus Branch' | Out-Null
}
Set-RegistryValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList' $Account 0 'DWord'
# A task that runs with nobody signed in needs the "Log on as a batch job" right.
$sid = (Get-LocalUser -Name $Account).SID.Value
$right = Test-BatchRight $sid
if (-not $right.Has) {
  $line = if ($right.Line) { "$($right.Line),*$sid" } else { "SeBatchLogonRight = *$sid" }
  Set-Content "$Work\rights.inf" -Encoding Unicode -Value @('[Unicode]', 'Unicode=yes', '[Version]', 'signature="$CHICAGO$"', 'Revision=1', '[Privilege Rights]', $line)
  secedit /configure /db "$Work\rights.sdb" /cfg "$Work\rights.inf" /areas USER_RIGHTS /quiet | Out-Null
}

# ---- 5. Data folder: only the app account, Administrators (S-1-5-32-544) and SYSTEM (S-1-5-18) ---------------------
Step "Data folder $DataDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
icacls $DataDir /inheritance:r /grant:r "${Account}:(OI)(CI)M" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions of $DataDir (icacls exit code $LASTEXITCODE)." }
# /grant:r keeps entries added by hand; drop the groups the app refuses to start with (BROAD in src/server/db/paths.ts):
# Everyone, Users, Authenticated Users, Interactive users, Guests.
icacls $DataDir /remove:g '*S-1-1-0' '*S-1-5-32-545' '*S-1-5-11' '*S-1-5-4' '*S-1-5-32-546' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions of $DataDir (icacls exit code $LASTEXITCODE)." }
# The watched folder's default (src/server/folder/folder.ts): staff signed in at this computer save the courier export
# here, and the app's account can read it. It holds customer data, so it is not open to everyone.
$ImportsDir = "$env:PUBLIC\Documents\Campus Branch Imports"
New-Item -ItemType Directory -Force -Path $ImportsDir | Out-Null
icacls $ImportsDir /inheritance:r /grant:r "${Account}:(OI)(CI)RX" '*S-1-5-32-545:(OI)(CI)M' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions of $ImportsDir (icacls exit code $LASTEXITCODE)." }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:PUBLIC\Desktop\Campus Branch Imports.lnk")
$shortcut.TargetPath = $ImportsDir
$shortcut.Save()
# Next.js may write its cache inside the build; the rest of the app folder stays read-only for the account.
New-Item -ItemType Directory -Force -Path "$AppDir\.next\cache" | Out-Null
icacls "$AppDir\.next\cache" /grant "${Account}:(OI)(CI)M" | Out-Null

# ---- 6. The tasks -----------------------------------------------------------------------------------------------------
Step "Task '$TaskName'"
$arguments = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\serve.ts --data-dir=`"$DataDir`" --port=$Port --branch-url=$address --log=`"$LogFile`""
$action = New-ScheduledTaskAction -Execute $NodeExe -Argument $arguments -WorkingDirectory $AppDir
# At startup, and every minute: "restart on failure" covers only a task that fails to start, not a launcher that
# dies later (ended in Task Manager, crashed); IgnoreNew makes the minute trigger do nothing while the app runs.
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$trigger = @((New-ScheduledTaskTrigger -AtStartup), $repeat)
# Priority 5 = normal; the default 7 also lowers disk priority.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew -Priority 5
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -User "$env:COMPUTERNAME\$Account" -Password $plain -RunLevel Limited -Force | Out-Null
$plain = $null

# The update task (deploy/windows/update.ps1), kept outside the app folder so a switch never replaces it while it runs.
Copy-Item "$AppDir\deploy\windows\update.ps1" "$InstallDir\update.ps1" -Force
if ($Channel) { Set-Content "$InstallDir\channel.txt" $Channel }
elseif (-not (Test-Path "$InstallDir\channel.txt")) { Set-Content "$InstallDir\channel.txt" 'office' }
Write-Host "Updates: published releases for the $((Get-Content "$InstallDir\channel.txt" -Raw).Trim()) channel, checked once 3 minutes after each start."
# Registered by a run by hand only: re-registering it from inside its own run could end that run.
if (-not $Unattended) {
  $updateAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`" -Repo $Repo -InstallDir `"$InstallDir`" -DataDir `"$DataDir`""
  $updateTrigger = New-ScheduledTaskTrigger -AtStartup
  $updateTrigger.Delay = 'PT3M' # time for the network to come up
  # It checks the charger itself, so it can say so in its log; 12 hours covers a long wait for a batch to finish.
  $updateSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName "$TaskName Update" -Action $updateAction -Trigger $updateTrigger -Settings $updateSettings `
    -User 'NT AUTHORITY\SYSTEM' -RunLevel Highest -Force | Out-Null
}

# ---- 7. Power and time ------------------------------------------------------------------------------------------------
Step 'Power and time'
# On mains power the computer never sleeps and closing the lid does nothing, so phones can reach the app all day.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
# On a critical battery it hibernates (2) instead of shutting off.
$ErrorActionPreference = 'Continue'
powercfg /hibernate on 2>$null | Out-Null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { Write-Host 'This computer cannot hibernate; on an empty battery it shuts down instead.' }
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

# ---- 8. Start, check, share ---------------------------------------------------------------------------------------------
Step 'Starting Campus Branch'
# Wait for the sign-in page itself; showing it also creates the one-time code on a new install.
function Wait-App {
  # A deadline, not a count: on Windows each refused connection itself takes about two seconds. Generous, since rolling
  # back a good version that a slow computer starts late is worse than noticing a broken one a little later.
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      if ((Invoke-WebRequest "http://127.0.0.1:$Port/login" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) { return $true }
    } catch { }
  }
  return $false
}
Start-ScheduledTask -TaskName $TaskName
$up = Wait-App
if (-not $up -and (Test-Path "$AppDir.old\scripts\serve.ts")) {
  $script:Retry = $false
  Write-Host 'The new version did not answer within 5 minutes; putting the previous version back.' -ForegroundColor Yellow
  if (Test-Path $LogFile) { Get-Content $LogFile -Tail 40 }
  Stop-App
  # If the new version already changed the database, the previous one cannot open it: put back the copy the new
  # version took just before it changed it (scripts/restore.ts keeps the current one as a before-restore copy).
  $out = Invoke-Helper $AppDir @('db-newer', "$AppDir.old\drizzle")
  $restore = $null
  if ($script:HelperCode -eq 3) {
    $restore = Invoke-Helper $AppDir @('pre-migration')
    if ($script:HelperCode -ne 0) { throw "The new version changed the database and no copy from before was found: $restore. Restore a backup by hand (see Restore below)." }
  } elseif ($script:HelperCode -ne 0) {
    throw "Could not check the database: $out"
  }
  Remove-Folder "$AppDir.failed"
  Rename-Item $AppDir 'app.failed'
  Rename-Item "$AppDir.old" 'app'
  if ($restore) {
    Push-Location $AppDir
    try {
      $env:DATA_DIR = $DataDir
      & $NodeExe --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\restore.ts $restore
      if ($LASTEXITCODE -ne 0) { throw "Putting back the database copy failed (exit code $LASTEXITCODE). Restore a backup by hand (see Restore below)." }
    } finally {
      Pop-Location
    }
  }
  Enable-ScheduledTask -TaskName $TaskName | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  $back = if (Wait-App) { 'and it answers again' } else { "but it does not answer either; see $LogFile" }
  throw "The new version did not start, so the previous version is back, $back. The new one is kept in $AppDir.failed for its log."
}
if (-not $up) {
  $result = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
  Write-Host "Last lines of $LogFile`:"
  if (Test-Path $LogFile) { Get-Content $LogFile -Tail 40 }
  # 0x80070569: the account may not log on as a batch job.
  if ($result -eq 2147943785) {
    throw "Windows refused to start the task as $Account (no 'Log on as a batch job' right). On Windows Pro: secpol.msc > Local Policies > User Rights Assignment > Log on as a batch job > add $Account, then run this again."
  }
  throw "Campus Branch did not answer within 5 minutes (task result $result). The log lines above say why."
}
Write-Host "The app answers on http://127.0.0.1:$Port"
if ($Unattended -and (Test-Path $StatusFile)) { Remove-Item $StatusFile -Force } # the pages reload on the new version

Step 'Sharing it on the tailnet'
Write-Host 'If Tailscale prints a link to enable HTTPS for your tailnet, open it, enable it, and this continues.'
& $TailscaleExe serve --bg $Port
if ($LASTEXITCODE -ne 0) { throw "tailscale serve failed. Fix what it printed above, then run this script again." }
Remove-Folder $Work

# A new install has no account yet: the sign-in page just wrote the one-time code into the data folder.
Push-Location $AppDir
try {
  $accounts = [int](& $NodeExe -e 'const D=require(''better-sqlite3'');const d=new D(process.argv[1],{readonly:true});console.log(d.prepare(''SELECT count(*) AS n FROM users'').get().n)' "$DataDir\branch.db")
} finally {
  Pop-Location
}
$codeFile = "$DataDir\first-run-code.txt"
$code = if ($accounts -eq 0 -and (Test-Path $codeFile)) { (Get-Content $codeFile -Raw).Trim() } else { $null }
if ($accounts -eq 0 -and -not $code) {
  Write-Host "Last lines of $LogFile`:"
  Get-Content $LogFile -Tail 30
  throw 'The app runs but could not create the one-time code for the first account. The log lines above say why.'
}

Write-Host "`n================================================================" -ForegroundColor Green
Write-Host " Campus Branch is installed and running" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "`n Address for staff:  $address/login" -ForegroundColor Green
if ($code) {
  Write-Host @"

 Create the first account (once, now):
   1. Open $address/login in a browser on this computer,
      or on any device signed in to the same Tailscale account.
   2. Type this one-time code:

          $code

   3. Choose the admin user name and password. The code then stops working.
   4. In Settings, "Ready for phones?" should show "Yes, over Tailscale HTTPS".
"@
} else {
  Write-Host "`n Accounts are kept ($accounts). Sign in as before."
}
Write-Host @"

 Staff phones:
   Install Tailscale on the phone and sign in with the same Tailscale account,
   then open the address above, or scan the QR code under Settings > "Set up a staff phone".

 For the administrator (PowerShell as administrator):
   Update:   automatic, once 3 minutes after each start, to the newest published release
             (log: $DataDir\logs\update.log); now: Start-ScheduledTask '$TaskName Update'
             or run this installer again; -Version v0.2.0 for one version
   Stop:     Disable-ScheduledTask '$TaskName'; Stop-ScheduledTask '$TaskName'   (else it restarts within a minute)
   Start:    Enable-ScheduledTask '$TaskName'; Start-ScheduledTask '$TaskName'
   Log:      $LogFile
   Data:     $DataDir   (database and backups; customer data, keep private)
   Imports:  $ImportsDir   (save the courier export here, then Scan Folder Now)
   Gateway:  cd '$AppDir'; `$env:DATA_DIR = '$DataDir'
             & '$NodeExe' --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\gateway.ts set   (address, user, password from SMSGate)
   Restore:  Disable-ScheduledTask '$TaskName'; Stop-ScheduledTask '$TaskName'
             cd '$AppDir'; `$env:DATA_DIR = '$DataDir'
             & '$NodeExe' --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\restore.ts      (lists backups)
             & '$NodeExe' --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\restore.ts 2    (puts back number 2)
             Enable-ScheduledTask '$TaskName'; Start-ScheduledTask '$TaskName'
   Remove:   Unregister-ScheduledTask '$TaskName' -Confirm:`$false; Unregister-ScheduledTask '$TaskName Update' -Confirm:`$false
             Remove-LocalUser $Account
             then delete $InstallDir (and $DataDir, which holds the customer data)
"@
