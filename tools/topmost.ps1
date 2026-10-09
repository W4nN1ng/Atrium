param(
  [ValidateSet('find', 'sample', 'close', 'list')] [string]$Action = 'find',
  [string]$ProcName = 'Atrium',
  [string]$TitleMatch = 'Atrium',
  [int]$Seconds = 6,
  [int]$IntervalMs = 100
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  // CharSet must be Unicode: with the default (Auto) the StringBuilder is marshalled as ANSI
  // and GetWindowTextW comes back empty/mojibake, which silently breaks title matching.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const uint WM_CLOSE = 0x0010;

  public static bool Topmost(IntPtr h) {
    long s = GetWindowLongPtrW(h, GWL_EXSTYLE).ToInt64();
    return (s & WS_EX_TOPMOST) != 0;
  }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static string Title(IntPtr h) {
    StringBuilder sb = new StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string Dump(uint target) {
    StringBuilder sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != target) return true;
      RECT r; GetWindowRect(h, out r);
      sb.AppendLine("hwnd=" + h + " vis=" + IsWindowVisible(h) + " min=" + IsIconic(h) +
        " top=" + Topmost(h) + " w=" + (r.Right - r.Left) + " h=" + (r.Bottom - r.Top) +
        " title=[" + Title(h) + "]");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  // Which window is "the main window" in THIS app: the title is EMPTY (Electron sets it via
  // document.title on the renderer, and the native window keeps no caption text), while a
  // 159x27 titleBarOverlay helper window is literally titled "Atrium". Matching by title picks
  // the wrong window, so we match by size: the biggest top-level window of the process that is
  // at least minW x minH. The needle is only a preference (used when it also passes the size gate).
  public static IntPtr Find(uint target, string needle, int minW, int minH) {
    IntPtr best = IntPtr.Zero;
    IntPtr bestAny = IntPtr.Zero;
    long bestArea = 0;
    long bestAnyArea = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != target) return true;
      RECT r; GetWindowRect(h, out r);
      long w = r.Right - r.Left;
      long hh = r.Bottom - r.Top;
      if (w < minW || hh < minH) return true;
      long area = w * hh;
      if (area > bestAnyArea) { bestAnyArea = area; bestAny = h; }
      string t = Title(h);
      if (!string.IsNullOrEmpty(needle) && t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) return true;
      if (area > bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    return best != IntPtr.Zero ? best : bestAny;
  }
}
"@

$procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Output ('NO-PROCESS ' + $ProcName); exit 2 }

if ($Action -eq 'list') {
  # Diagnostic: every top-level window of every process with this name (enumeration lives in
  # C# -- a PowerShell scriptblock turned into a native callback does not see $script: vars).
  foreach ($p in $procs) {
    $d = [Win]::Dump([uint32]$p.Id)
    if ($d.Trim().Length -gt 0) { Write-Output ('--- pid ' + $p.Id + ' ---'); Write-Output $d }
  }
  exit 0
}

$hwnd = [IntPtr]::Zero
$foundPid = 0
foreach ($p in $procs) {
  $h = [Win]::Find([uint32]$p.Id, $TitleMatch, 400, 300)
  if ($h -ne [IntPtr]::Zero) { $hwnd = $h; $foundPid = $p.Id; break }
}
if ($hwnd -eq [IntPtr]::Zero) { Write-Output ('NO-WINDOW pid-count=' + $procs.Count + ' needle=' + $TitleMatch); exit 3 }

if ($Action -eq 'close') {
  [void][Win]::PostMessageW($hwnd, [Win]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output ('WM_CLOSE posted hwnd=' + $hwnd + ' pid=' + $foundPid)
  exit 0
}

function Get-Row([double]$t) {
  $fg = [Win]::GetForegroundWindow()
  $isFg = ($fg -eq $hwnd)
  $fgTitle = [Win]::Title($fg)
  $v = [Win]::IsWindowVisible($hwnd)
  $min = [Win]::IsIconic($hwnd)
  $top = [Win]::Topmost($hwnd)
  return ('{0};{1};{2};{3};{4};{5};{6}' -f $t, $v, $min, $top, $isFg, $fgTitle, $hwnd)
}

if ($Action -eq 'find') {
  Write-Output ('hwnd=' + $hwnd + ' pid=' + $foundPid)
  Write-Output ('t;visible;minimized;topmost;isForeground;foregroundTitle')
  Write-Output (Get-Row 0)
  exit 0
}

Write-Output ('sampling hwnd=' + $hwnd + ' pid=' + $foundPid + ' seconds=' + $Seconds + ' interval=' + $IntervalMs)
Write-Output ('t;visible;minimized;topmost;isForeground;foregroundTitle;hwnd')
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
  Write-Output (Get-Row ([math]::Round($sw.Elapsed.TotalMilliseconds, 0)))
  Start-Sleep -Milliseconds $IntervalMs
}
