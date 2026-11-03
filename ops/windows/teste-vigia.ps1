$ErrorActionPreference='Continue'
$out='D:\IA\Claude\RPlayout\vigia-teste.txt'
function Say($m){ ('{0:HH:mm:ss} {1}' -f (Get-Date),$m) | Add-Content -Encoding UTF8 $out }
$Root='D:\RPlayout Atual'; $prefix=$Root+'\'
function Srv(){ @(Get-CimInstance Win32_Process -Filter "Name='RPlayout-Server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) }) }
function Procs(){ (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name }) -join ',' }
function Api(){ try{ (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 'http://127.0.0.1:4000/api/state').StatusCode }catch{ 0 } }
function WaitApi($max){ $t=Get-Date; for($i=0;$i -lt $max;$i++){ if((Api) -eq 200){ return ((Get-Date)-$t).TotalSeconds }; Start-Sleep 5 }; return $null }
function VLog(){ Get-Content "$env:LOCALAPPDATA\RPlayout\vigia\vigia.log" -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "   vigia.log: $_" } }
Say "INICIO servidor=$((Srv).Count) api=$(Api) processos=$(Procs)"
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\RPlayout\scripts\instalar-vigia-rplayout.ps1' -Root $Root *>&1 | ForEach-Object { Say "instalar: $_" }
Start-Sleep 25
$task=Get-ScheduledTask -TaskName 'RPlayout - vigia' -ErrorAction SilentlyContinue
Say "tarefa agendada: $(if($task){$task.State}else{'AUSENTE'})"
VLog
Say 'TESTE A: queda do servidor (Stop-Process RPlayout-Server.exe)'
$t0=Get-Date; (Srv) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 2; Say "logo apos matar: servidor=$((Srv).Count) processos=$(Procs)"
$back=$null; for($i=0;$i -lt 36;$i++){ Start-Sleep 5; if((Srv).Count){ $back=(Get-Date); break } }
if($back){ Say ('A: vigia religou o servidor em {0:N0} s' -f ($back-$t0).TotalSeconds) } else { Say 'A: FALHA - vigia nao religou em 180 s' }
$s=WaitApi 48; if($s -ne $null){ Say ('A: API 200 apos {0:N0} s da queda' -f (((Get-Date)-$t0).TotalSeconds)) } else { Say 'A: FALHA - API nao voltou em 4 min' }
Say "A: processos=$(Procs)"; VLog
Say 'TESTE B: parada pedida pelo operador (vigia NAO deve religar)'
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\RPlayout\scripts\desligar-rplayout.ps1' -Root $Root *>&1 | ForEach-Object { Say "desligar: $_" }
Start-Sleep 75
Say "B: 75 s depois servidor=$((Srv).Count) (esperado 0) processos=$(Procs)"; VLog
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\RPlayout\scripts\ligar-rplayout.ps1' -Root $Root *>&1 | ForEach-Object { Say "ligar: $_" }
$t1=Get-Date; $s=WaitApi 48; if($s -ne $null){ Say ('B: API 200 apos {0:N0} s do ligar' -f (((Get-Date)-$t1).TotalSeconds)) } else { Say 'B: FALHA - API nao voltou em 4 min' }
Say "FIM servidor=$((Srv).Count) api=$(Api) processos=$(Procs)"
