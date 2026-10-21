# Regression test for the window caption buttons (Windows): launches Bedrock against a temp vault,
# then clicks Minimize / Maximize / Restore / Close with REAL mouse input (SendInput), the way a person
# does. Synthetic DOM clicks can't catch the original bug, where a drag region swallowed the clicks
# at the OS level. Also double-clicks the tab bar (maximize) and drags it (move).
# Usage: powershell -File app/test/e2e/window-controls.ps1 [-Exe <bedrock.exe>]   (default: dev electron)
param([string]$Exe = "")
$ErrorActionPreference = "Stop"
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(120); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
  public static void Drag(int x, int y, int dx, int dy) { SetCursorPos(x, y); System.Threading.Thread.Sleep(120); mouse_event(2,0,0,0,UIntPtr.Zero);
    for (int i = 1; i <= 10; i++) { SetCursorPos(x + dx*i/10, y + dy*i/10); System.Threading.Thread.Sleep(30); } mouse_event(4,0,0,0,UIntPtr.Zero); }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$tmp = Join-Path $env:TEMP ("bedrock-wc-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force "$tmp\vault", "$tmp\data" | Out-Null
Set-Content "$tmp\vault\Hello.md" "# Hello`nWindow controls test."
$env:BEDROCK_USER_DATA = "$tmp\data"; $env:BEDROCK_NO_UPDATE = "1"
if ($Exe) { $p = Start-Process $Exe -ArgumentList "--vault", "$tmp\vault" -PassThru }
else { $p = Start-Process "$root\node_modules\electron\dist\electron.exe" -ArgumentList "$root\app", "--vault", "$tmp\vault" -PassThru }

$fail = 0
function Check($name, $ok) { if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ } }
function Win {
  for ($i = 0; $i -lt 60; $i++) {
    $h = (Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowHandle
    if ($h -and $h -ne 0) { return $h }
    Start-Sleep -Milliseconds 250
  }
  throw "no window"
}
try {
  $h = Win
  Start-Sleep 3
  [W]::ShowWindow($h, 9) | Out-Null; [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 400
  $r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
  # Caption buttons: 3 x ~42px at the top-right, 39px tall. Click their centres.
  $y = $r.T + 18; $close = $r.R - 22; $max = $r.R - 66; $min = $r.R - 110

  [W]::Click($max, $y); Start-Sleep -Milliseconds 700
  Check "maximize button maximizes" ([W]::IsZoomed($h))
  # A maximized window's rect includes an invisible 8px border on every side.
  [W]::GetWindowRect($h, [ref]$r) | Out-Null; $b = [Math]::Max(0, -$r.T)
  [W]::Click($r.R - $b - 66, $r.T + $b + 18)
  Start-Sleep -Milliseconds 700
  Check "restore button restores" (-not [W]::IsZoomed($h))

  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  # Double-click an empty part of the tab bar (left of the tab list, right-sidebar toggle and caption buttons).
  $bx = $r.R - 260; $by = $r.T + 18
  [W]::Click($bx, $by); Start-Sleep -Milliseconds 60; [W]::Click($bx, $by); Start-Sleep -Milliseconds 800
  Check "double-click tab bar maximizes" ([W]::IsZoomed($h))
  [W]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 700

  [W]::GetWindowRect($h, [ref]$r) | Out-Null; $before = $r.L
  [W]::Drag($r.R - 260, $r.T + 18, -120, 40); Start-Sleep -Milliseconds 600
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  Check "dragging the tab bar moves the window" ([Math]::Abs($r.L - ($before - 120)) -le 12)

  [W]::Click($r.R - 110, $r.T + 18); Start-Sleep -Milliseconds 700
  Check "minimize button minimizes" ([W]::IsIconic($h))
  [W]::ShowWindow($h, 9) | Out-Null; [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 700

  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  [W]::Click($r.R - 22, $r.T + 18); Start-Sleep -Milliseconds 1500
  # Close hides to the tray (app keeps running, like other Toolbay tools) or quits: either way the window goes.
  Check "close button closes the window" (-not [W]::IsWindow($h) -or -not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowHandle -or ((Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowHandle -eq 0))
}
finally {
  Get-Process -Id $p.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$tmp*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 1; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
if ($fail) { Write-Host "$fail check(s) failed"; exit 1 } else { Write-Host "all window-control checks passed" }
