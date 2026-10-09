$ErrorActionPreference = 'SilentlyContinue'
# 只列出 electron 的主进程（没有 --type= 参数的那些）
$all = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
$main = @($all | Where-Object { $_.CommandLine -notmatch '--type=' })
Write-Output ('electron total=' + @($all).Count + ' main=' + $main.Count)
foreach ($m in $main) {
  Write-Output ('MAIN pid=' + $m.ProcessId + ' started=' + $m.CreationDate)
}
