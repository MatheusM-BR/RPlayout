# Free physical memory in bytes on Windows PowerShell 5.1 (.NET Framework) and
# PowerShell 7 (.NET). GetGCMemoryInfo exists only on .NET Core/5+.
function Get-RPlayoutAvailableMemoryBytes {
  [GC]::Collect()
  if ([GC].GetMethod('GetGCMemoryInfo', [Type[]]@())) {
    $metric = [GC]::GetGCMemoryInfo()
    return [long]($metric.TotalAvailableMemoryBytes - $metric.MemoryLoadBytes)
  }
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  return [long]$os.FreePhysicalMemory * 1KB
}
