param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
try {
  $target = [System.IO.Path]::GetFullPath($Executable)
  $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $target, [StringComparison]::OrdinalIgnoreCase) })
  foreach ($entry in $running) { Stop-Process -Id $entry.ProcessId -Force -ErrorAction Stop }
  exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
