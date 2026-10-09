$ErrorActionPreference = 'SilentlyContinue'
# 列出所有 electron.exe / node.exe，按可执行文件路径判断归属，只报告不动手
$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='node.exe'"
foreach ($p in $procs) {
  $id = $p.ProcessId
  $name = $p.Name
  $exe = $p.ExecutablePath
  $cmd = $p.CommandLine
  if ($null -eq $cmd) { $cmd = '' }
  if ($cmd.Length > 220) { $cmd = $cmd.Substring(0, 220) }
  Write-Output ("PID=" + $id + " | " + $name + " | EXE=" + $exe)
  Write-Output ("    CMD=" + $cmd)
}
Write-Output ("TOTAL=" + $procs.Count)
