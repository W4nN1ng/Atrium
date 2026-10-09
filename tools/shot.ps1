param([string]$ProcName = 'Atrium', [string]$Out = '', [switch]$Raise, [switch]$Nudge)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Shot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<IntPtr> Of(uint target) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == target && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        if ((r.Right - r.Left) > 200 && (r.Bottom - r.Top) > 200) list.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
}
"@
[void][Shot]::SetProcessDPIAware()

$procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Output ("NO-PROCESS " + $ProcName); exit 1 }

$best = [IntPtr]::Zero
$bestArea = 0
foreach ($p in $procs) {
  foreach ($h in [Shot]::Of([uint32]$p.Id)) {
    $r = [Shot]::Rect($h)
    $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($area -gt $bestArea) { $bestArea = $area; $best = $h }
  }
}
if ($best -eq [IntPtr]::Zero) { Write-Output ("NO-WINDOW for " + $ProcName); exit 2 }

$rect = [Shot]::Rect($best)
$w = $rect.Right - $rect.Left
$h2 = $rect.Bottom - $rect.Top

# Chromium skips painting while the window is covered, and PrintWindow then
# hands back the previous frame. SetForegroundWindow is usually refused
# (Windows focus-stealing protection), so the reliable trick is a
# minimize -> restore round trip: that forces a fresh frame.
if ($Raise) {
  [void][Shot]::ShowWindow($best, 9)   # SW_RESTORE
  [void][Shot]::SetForegroundWindow($best)
  Start-Sleep -Milliseconds 700
  Write-Output ("foreground=" + ([Shot]::GetForegroundWindow() -eq $best))
}
if ($Nudge) {
  [void][Shot]::ShowWindow($best, 6)   # SW_MINIMIZE
  Start-Sleep -Milliseconds 500
  [void][Shot]::ShowWindow($best, 9)   # SW_RESTORE
  Start-Sleep -Milliseconds 900
}

$bmp = New-Object System.Drawing.Bitmap($w, $h2, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Shot]::PrintWindow($best, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
if ($Out -eq '') { $Out = Join-Path $env:TEMP ('shot-' + $ProcName + '.png') }
# 相对路径 + 目录不存在时 Bitmap.Save 直接抛 ExternalException（实测踩过：
# `-Out screenshots/x.png` 在 PowerShell 的 CWD 下没这个目录，报错信息还不说为什么）。
$Out = [System.IO.Path]::GetFullPath($Out)
$parent = Split-Path -Parent $Out
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("OK " + $w + "x" + $h2 + " PrintWindow=" + $ok + " -> " + $Out)
