$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WinCap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  public static List<IntPtr> WindowsOf(uint targetPid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == targetPid && IsWindowVisible(h)) {
        RECT r; if (GetWindowRect(h, out r)) {
          if ((r.Right - r.Left) > 60 && (r.Bottom - r.Top) > 60) list.Add(h);
        }
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static RECT RectOf(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
}
"@
[void][WinCap]::SetProcessDPIAware()

$procs = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
  $_.ExecutablePath -and ($_.ExecutablePath.Replace('/', '\') -like '*node_modules\electron\dist\electron.exe')
} | Select-Object -ExpandProperty ProcessId)

if ($procs.Count -eq 0) { Write-Output 'NO-ELECTRON-PROCESS'; exit 1 }

$best = [IntPtr]::Zero
$bestArea = 0
$bestPid = 0
foreach ($procId in $procs) {
  $wins = [WinCap]::WindowsOf([uint32]$procId)
  foreach ($h in $wins) {
    $r = [WinCap]::RectOf($h)
    $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($area -gt $bestArea) { $bestArea = $area; $best = $h; $bestPid = $procId }
  }
}
if ($best -eq [IntPtr]::Zero) { Write-Output 'NO-VISIBLE-WINDOW'; exit 2 }

$rect = [WinCap]::RectOf($best)
$w = $rect.Right - $rect.Left
$h2 = $rect.Bottom - $rect.Top
Write-Output ("WINDOW hwnd=" + $best + " pid=" + $bestPid + " rect=" + $w + "x" + $h2)

$bmp = New-Object System.Drawing.Bitmap($w, $h2, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 2： layered / 硬件加速窗口也能抓到自己的像素
$ok = [WinCap]::PrintWindow($best, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
Write-Output ("PrintWindow=" + $ok)

$out = Join-Path $env:TEMP 'avca-capture.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("SAVED " + $out)
