param([int]$Hours=8,[int]$EverySeconds=60,[string]$Root='D:\RPlayout r88-12',[string]$Tag='r88-12')
$ErrorActionPreference='Continue'
[Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::InvariantCulture
$stop='D:\IA\Claude\RPlayout\soak.stop'
if(Test-Path $stop){Remove-Item $stop}
$root=$Root
$csv="D:\IA\Claude\RPlayout\soak-$Tag-$(Get-Date -Format yyyyMMdd-HHmm).csv"
'time,apiMs,onAirItem,elapsed,playing,pgmPeakL,pgmPeakR,pgmLufs,alerts,nodeCpuS,nodeMB,engineCpuS,engineMB,mediamtxMB,freeMB' | Set-Content -Encoding UTF8 $csv
$end=(Get-Date).AddHours($Hours)
while((Get-Date) -lt $end -and !(Test-Path $stop)){
  $row=@{}
  try{
    $sw=[Diagnostics.Stopwatch]::StartNew()
    $state=Invoke-RestMethod -TimeoutSec 20 'http://127.0.0.1:4000/api/state'
    $snap=Invoke-RestMethod -TimeoutSec 20 ("http://127.0.0.1:4000/api/rundowns/"+$state.rundowns[0].id)
    $sw.Stop(); $row.apiMs=$sw.ElapsedMilliseconds
    $t=$snap.live.transport; $m=$snap.live.meters.program
    $row.onAir=$t.onAir.itemId; $row.elapsed=$t.onAir.elapsed; $row.playing=$t.playing
    $row.pl=$m.peakDbfs[0]; $row.pr=$m.peakDbfs[1]; $row.lufs=$m.shortTermLufs; $row.alerts=@($snap.live.alerts).Count
  }catch{ $row.apiMs=-1 }
  $procs=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) }
  $sum={param($n) $ps=@($procs|Where-Object{$_.Name -eq $n}); if(!$ps.Count){return @('','')}; $g=@($ps|ForEach-Object{Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}); @([math]::Round(($g|Measure-Object CPU -Sum).Sum,1),[math]::Round(($g|Measure-Object WorkingSet64 -Sum).Sum/1MB))}
  $n=& $sum 'node.exe'; $e=& $sum 'rplayout-engine.exe'; $mm=& $sum 'mediamtx.exe'
  $free=[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)
  ('{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14}' -f (Get-Date -Format s),$row.apiMs,$row.onAir,$row.elapsed,$row.playing,$row.pl,$row.pr,$row.lufs,$row.alerts,$n[0],$n[1],$e[0],$e[1],$mm[1],$free) | Add-Content -Encoding UTF8 $csv
  Start-Sleep -Seconds $EverySeconds
}
