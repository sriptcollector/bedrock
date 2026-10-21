# Installs the real installer the way the Toolbay hub does (/S /D=<dir>), then checks the hub
# contract on the INSTALLED app: --from-toolbay start, running.json, --hide / --show / --quit via a
# second launch (single instance), --selftest on a vault, the bedrock CLI shim, and silent uninstall.
# Isolated: own app data (BEDROCK_USER_DATA), own vault (BEDROCK_MAIN_VAULT), own install dir.
# Usage: powershell -File app/test/e2e/hub-contract.ps1 -Installer <setup.exe> [-Vault <copy of a real vault>]
param([Parameter(Mandatory)][string]$Installer, [string]$Vault = "")
$ErrorActionPreference = "Stop"
$fail = 0
function Check($name, $ok, $detail = "") { if ($ok) { Write-Host "PASS $name $detail" } else { Write-Host "FAIL $name $detail"; $script:fail++ } }
$tmp = Join-Path $env:TEMP ("bedrock-hub-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$dir = Join-Path $tmp "Toolbay Tools\bedrock"
New-Item -ItemType Directory -Force "$tmp\data", "$tmp\vault" | Out-Null
$env:BEDROCK_USER_DATA = "$tmp\data"; $env:BEDROCK_MAIN_VAULT = "$tmp\vault"; $env:BEDROCK_NO_UPDATE = "1"; $env:TOOLBAY_HUB = "1"
$state = "$tmp\data\running.json"
function State { if (Test-Path $state) { Get-Content $state -Raw | ConvertFrom-Json } else { $null } }
function WaitFor([scriptblock]$cond, [int]$ms = 15000) { $t = [Diagnostics.Stopwatch]::StartNew(); while ($t.ElapsedMilliseconds -lt $ms) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 200 }; return $false }
try {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$dir" -PassThru -Wait
  Check "silent per-user install (/S /D=)" ($p.ExitCode -eq 0 -and (Test-Path "$dir\bedrock.exe")) "$([int]$t.Elapsed.TotalSeconds) s, exit $($p.ExitCode)"
  Check "uninstaller present" (Test-Path "$dir\Uninstall Bedrock.exe")
  Check "CLI shim present" (Test-Path "$dir\bin\bedrock.cmd")
  Get-Process bedrock -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir*" } | Stop-Process -Force -ErrorAction SilentlyContinue  # runAfterFinish

  if ($Vault) {
    $out = & "$dir\bedrock.exe" --selftest $Vault --no-ui 2>$null | Out-String
    $j = $null; try { $j = ($out.Substring($out.IndexOf("{"))) | ConvertFrom-Json } catch {}
    Check "installed app indexes the real-vault copy (--selftest)" ($j -ne $null) ($out.Trim() -replace "\s+", " ").Substring(0, [Math]::Min(300, $out.Trim().Length))
  }

  $t = [Diagnostics.Stopwatch]::StartNew()
  $app = Start-Process "$dir\bedrock.exe" -ArgumentList "--from-toolbay" -PassThru
  Check "starts from the hub and writes running.json (visible)" (WaitFor { $s = State; $s -and $s.visible -eq $true -and $s.pid }) "$([int]$t.ElapsedMilliseconds) ms"
  Check "welcome note created in the one vault (also after an interrupted first run)" (WaitFor { Test-Path "$tmp\vault\*.md" })
  Start-Process "$dir\bedrock.exe" -ArgumentList "--hide" -Wait
  Check "--hide (second launch) hides the window" (WaitFor { (State).visible -eq $false })
  Start-Process "$dir\bedrock.exe" -ArgumentList "--show" -Wait
  Check "--show brings it back" (WaitFor { (State).visible -eq $true })
  Check "still one app instance" (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$dir*" -and $_.CommandLine -notmatch "--type=" }).Count -eq 1)
  $cli = & cmd /c "`"$dir\bin\bedrock.cmd`" search Welcome --json" 2>$null | Out-String
  $cj = $null; try { $cj = $cli | ConvertFrom-Json } catch {}
  Check "bedrock CLI answers through the running app" ($cj -and $cj.total -ge 1) ($cli.Trim().Substring(0, [Math]::Min(120, $cli.Trim().Length)))
  Start-Process "$dir\bedrock.exe" -ArgumentList "--quit" -Wait
  Check "--quit exits and removes running.json" (WaitFor { -not (Get-Process -Id $app.Id -ErrorAction SilentlyContinue) -and -not (Test-Path $state) })
  $log = Get-Content "$tmp\data\logs\main.log" -Raw -ErrorAction SilentlyContinue
  Check "no errors in the app log" (-not ($log -match " ERROR ")) (($log -split "`n" | Select-String " ERROR " | Select-Object -First 2) -join " | ")

  $p = Start-Process "$dir\Uninstall Bedrock.exe" -ArgumentList "/S" -PassThru -Wait
  Check "silent uninstall removes the program" (WaitFor { -not (Test-Path "$dir\bedrock.exe") } 30000)
}
finally {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$tmp*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 1; if ($fail -and $env:KEEP) { Write-Host "kept $tmp" } else { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
if ($fail) { Write-Host "$fail check(s) failed"; exit 1 } else { Write-Host "all hub-contract checks passed" }
