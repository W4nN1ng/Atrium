$ErrorActionPreference = 'SilentlyContinue'
# 列出打包版 Atrium.exe 的主进程（子进程命令行里带 --type=）
$all = @(Get-CimInstance Win32_Process -Filter "Name='Atrium.exe'")
$main = @($all | Where-Object { $_.CommandLine -notmatch '--type=' })
Write-Output ('Atrium total=' + $all.Count + ' main=' + $main.Count)
foreach ($m in $main) { Write-Output ('MAIN pid=' + $m.ProcessId + ' started=' + $m.CreationDate) }
if ($all.Count -eq 0) {
  Write-Output 'NOT-RUNNING'
  $log = Join-Path $env:APPDATA 'A\logs\main.log'
  if (Test-Path $log) {
    Write-Output ('--- tail ' + $log + ' ---')
    Get-Content $log -Tail 12 | ForEach-Object { Write-Output $_ }
  }
}
