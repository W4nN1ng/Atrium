$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WinDbg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public static List<IntPtr> All() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static string Title(IntPtr h) {
    int n = GetWindowTextLength(h);
    var sb = new System.Text.StringBuilder(n + 2);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@

$procs = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
  $_.ExecutablePath -and ($_.ExecutablePath.Replace('/', '\') -like '*node_modules\electron\dist\electron.exe')
})
Write-Output ('our electron pids: ' + ($procs | Select-Object -ExpandProperty ProcessId | Sort-Object | Out-String).Trim())
foreach ($p in ($procs | Sort-Object CreationDate)) {
  $cl = $p.CommandLine
  if ($cl.Length -gt 150) { $cl = $cl.Substring(0, 150) }
  Write-Output ('PID ' + $p.ProcessId + ' started ' + $p.CreationDate + ' cmd: ' + $cl)
}

$all = [WinDbg]::All()
foreach ($p in $procs) {
  foreach ($h in $all) {
    $pid2 = [uint32]0
    [void][WinDbg]::GetWindowThreadProcessId($h, [ref]$pid2)
    if ($pid2 -eq [uint32]$p.ProcessId) {
      $r = [WinDbg]::Rect($h)
      $vis = [WinDbg]::IsWindowVisible($h)
      $t = [WinDbg]::Title($h)
      Write-Output ('  WIN pid=' + $p.ProcessId + ' hwnd=' + $h + ' visible=' + $vis + ' rect=' + ($r.Right - $r.Left) + 'x' + ($r.Bottom - $r.Top) + ' title=[' + $t + ']')
    }
  }
}
