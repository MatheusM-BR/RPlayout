param([int]$ServerPid,[string]$ProbePath,[string]$MediaPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RPlayoutObservedExit {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(25)
$expected = [IO.Path]::GetFullPath($ProbePath)
$null = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ServerPid")
[Console]::WriteLine((@{event='READY'} | ConvertTo-Json -Compress))
[Console]::Out.Flush()
while ([DateTime]::UtcNow -lt $deadline) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ServerPid")
  foreach ($child in $children) {
    if (!$child.ExecutablePath -or ![string]::Equals([IO.Path]::GetFullPath($child.ExecutablePath),$expected,[StringComparison]::OrdinalIgnoreCase)) { continue }
    if (!$child.CommandLine.Contains($MediaPath) -or !$child.CommandLine.Contains('--parent-pipe') -or $child.CommandLine.Contains('--no-loudness')) { continue }
    # Acquire an OS process handle while the exact child is alive. Wait on
    # this handle, never guess death by later PID lookup; never kill a child.
    $process = [Diagnostics.Process]::GetProcessById([int]$child.ProcessId)
    try {
      $null = $process.Handle
      if ($process.HasExited) { continue }
      $seen = @{event='ACTIVE';pid=$child.ProcessId;parentPid=$ServerPid;startTicks=$process.StartTime.ToUniversalTime().Ticks;commandLine=$child.CommandLine;observedUtc=[DateTime]::UtcNow.ToString('o')}
      [Console]::WriteLine(($seen | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
      if (!$process.WaitForExit(30000)) { throw 'Observed own native probe did not exit within bound.' }
      [uint32]$nativeCode = 0
      if (![RPlayoutObservedExit]::GetExitCodeProcess($process.Handle,[ref]$nativeCode)) { throw 'Unable to read exit from exact observed OS handle.' }
      [Console]::WriteLine((@{event='EXIT';pid=$child.ProcessId;exitCode=$nativeCode;managedExitCode=$process.ExitCode;observedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress))
      exit 0
    } finally { $process.Dispose() }
  }
  Start-Sleep -Milliseconds 50
}
throw 'No exact active own native probe observed; no crash proof obtained.'
