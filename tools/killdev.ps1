$ErrorActionPreference = 'SilentlyContinue'
# Kill this project's dev electron.exe and the packaged Atrium.exe.
# Both hold the single-instance lock and better_sqlite3.node.
# Keep this file pure ASCII: Windows PowerShell 5.1 reads .ps1 as ANSI (cp936 here),
# so Chinese comments shift the byte stream and break parsing on a later quote.
$root = Split-Path -Parent $PSScriptRoot
$devExe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$pkgExe = Join-Path $root 'dist\win-unpacked\Atrium.exe'

$targets = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='Atrium.exe'" | Where-Object {
  $p = $_.ExecutablePath
  if (-not $p) {
    $p = ($_.CommandLine -split ' ')[0]
  }
  $norm = $p.Replace('/', '\').Trim('"')
  $norm -ieq $devExe -or $norm -ieq $pkgExe
})

if ($targets.Count -eq 0) {
  Write-Output 'no matching process'
  exit 0
}
foreach ($t in $targets) {
  Write-Output ('kill PID=' + $t.ProcessId + ' ' + $t.Name)
  Stop-Process -Id $t.ProcessId -Force
}
Write-Output ('killed ' + $targets.Count)

# Orphaned 7z.exe: a header-encrypted archive used to leave it blocked on the
# password prompt forever, holding the file open. Clean any whose parent chain
# is gone and that were started from this project's resources/bin.
$bins = @((Join-Path $root 'resources\bin\7z.exe'))
foreach ($b in $bins) {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='7z.exe' OR Name='7za.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine.Replace('/', '\').Trim('"') -ieq $b -or $_.ExecutablePath -ieq $b)
  })
  foreach ($p in $procs) {
    Write-Output ('kill orphan PID=' + $p.ProcessId + ' 7z')
    Stop-Process -Id $p.ProcessId -Force
  }
}
