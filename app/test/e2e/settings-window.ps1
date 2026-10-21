# Settings window (Windows): opens Settings in its own window, then clicks its caption buttons and
# a settings toggle with REAL mouse input, checks the window maximizes/restores/closes and that the
# toggle wrote .obsidian/app.json. Screenshots of every settings tab: app/test/e2e/settings-tabs.mjs.
# Usage: powershell -File app/test/e2e/settings-window.ps1
$ErrorActionPreference = "Stop"
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class SW {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static void Focus(IntPtr h) { keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x12,0,2,UIntPtr.Zero); SetForegroundWindow(h); System.Threading.Thread.Sleep(300); }
  public struct RECT { public int L, T, R, B; }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(120); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
  public static IntPtr Find(string prefix) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (IsWindowVisible(h) && sb.ToString().StartsWith(prefix)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
[SW]::SetProcessDPIAware() | Out-Null
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$tmp = Join-Path $env:TEMP ("bedrock-sw-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force "$tmp\vault", "$tmp\data" | Out-Null
Set-Content "$tmp\vault\Hello.md" "# Hello"
$env:BEDROCK_USER_DATA = "$tmp\data"; $env:BEDROCK_NO_UPDATE = "1"
$port = 9659
$p = Start-Process "$root\node_modules\electron\dist\electron.exe" -ArgumentList "$root\app", "--vault", "$tmp\vault", "--remote-debugging-port=$port" -PassThru
$fail = 0
function Check($name, $ok) { if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ } }
function Eval($expr) {
  $js = "const e=process.argv[1];(async()=>{const l=(await (await fetch('http://127.0.0.1:$port/json')).json()).find(t=>t.url.includes('index.html'));const ws=new WebSocket(l.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=m=>{const j=JSON.parse(m.data);if(j.id===1){console.log(JSON.stringify(j.result.result.value));ws.close()}};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:e,awaitPromise:true,returnByValue:true}}))})()"
  return (node -e $js $expr)
}
try {
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 500; try { if ((Eval "!!(window.app&&app.workspace.layoutReady)") -eq "true") { break } } catch {} }
  Eval "app.setting.open(); app.setting.openTabById('editor'); 1" | Out-Null
  Start-Sleep 2
  $h = [SW]::Find("Settings - ")
  Check "settings opens in its own window" ($h -ne [IntPtr]::Zero)
  [SW]::Focus($h); Start-Sleep -Milliseconds 500
  $r = New-Object SW+RECT; [SW]::GetWindowRect($h, [ref]$r) | Out-Null
  $y = $r.T + 15
  [SW]::Click($r.R - 66, $y); Start-Sleep -Milliseconds 1200
  Check "settings maximize button maximizes" ([SW]::IsZoomed($h))
  [SW]::Focus($h); [SW]::GetWindowRect($h, [ref]$r) | Out-Null; $b = [Math]::Max(0, -$r.T)
  [SW]::Click($r.R - $b - 66, $r.T + $b + 15); Start-Sleep -Milliseconds 800
  Check "settings restore button restores" (-not [SW]::IsZoomed($h))
  # Click the "Line numbers" toggle (real click at its on-screen position).
  $pos = Eval "(()=>{const d=app.setting.modalEl.ownerDocument;const row=[...d.querySelectorAll('.setting-item')].find(e=>e.querySelector('.setting-item-name')?.textContent==='Line numbers');row.scrollIntoView({block:'center'});const r=row.querySelector('.checkbox-container').getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2),d.defaultView.screenX,d.defaultView.screenY,d.defaultView.outerHeight-d.defaultView.innerHeight]})()"
  $a = $pos | ConvertFrom-Json
  [SW]::Focus($h)
  [SW]::GetWindowRect($h, [ref]$r) | Out-Null
  [SW]::Click($r.L + $a[0] + 1, $r.B - (Eval "app.setting.modalEl.ownerDocument.defaultView.innerHeight" ) + $a[1]); Start-Sleep -Milliseconds 1200
  $cfg = Get-Content "$tmp\vault\.obsidian\app.json" -Raw -ErrorAction SilentlyContinue
  Check "clicking a toggle writes app.json" ($cfg -match '"showLineNumber": true')
  [SW]::Focus($h); Start-Sleep -Milliseconds 400
  [SW]::GetWindowRect($h, [ref]$r) | Out-Null
  Write-Host "settings window rect $($r.L),$($r.T),$($r.R),$($r.B)"
  [SW]::Click($r.R - 30, $r.T + 15); Start-Sleep -Milliseconds 1000
  Check "settings close button closes the window" (-not [SW]::IsWindow($h))
  Check "app knows settings closed" ((Eval "app.setting.isActive") -eq "false")
}
finally {
  Get-Process -Id $p.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$tmp*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 1; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
if ($fail) { Write-Host "$fail check(s) failed"; exit 1 } else { Write-Host "all settings-window checks passed" }
