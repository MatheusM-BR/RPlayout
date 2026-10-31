# Vigia do RPlayout: religa o servidor se ele parar (queda, console fechado,
# falta de energia seguida de logon). Roda escondido, iniciado pela tarefa
# agendada que instalar-vigia-rplayout.ps1 cria. Nao mexe em Firewall/UAC.
#
# Nao religa quando existe o marcador "<Root>.manutencao":
#   - conteudo OPERADOR    -> parada pedida pelo operador (desligar-rplayout.ps1),
#                             vale ate ligar de novo;
#   - qualquer outro texto -> atualizacao em curso, vale no maximo 30 min.
# Protecao contra laco: no maximo 5 partidas por hora; depois so registra.
param(
  [string]$Root='D:\RPlayout Atual',
  [string]$Log="$env:LOCALAPPDATA\RPlayout\vigia",
  [int]$EverySeconds=15,
  [int]$MissesBeforeStart=2,
  [int]$MaxStartsPerHour=5,
  [switch]$Once,
  [int]$Loops=0,   # testes: para depois de N voltas (0 = sempre)
  [scriptblock]$Starter
)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $Log | Out-Null
$logFile=Join-Path $Log 'vigia.log'
function Say($m){ "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date),$m | Add-Content -Encoding UTF8 $logFile }
function Owned(){
  $prefix=$Root.TrimEnd('\')+'\'
  @(Get-CimInstance Win32_Process -Filter "Name='RPlayout-Server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })
}
function Paused(){
  $marker=$Root.TrimEnd('\')+'.manutencao'
  if(!(Test-Path -LiteralPath $marker)){ return $null }
  $text=(Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue)
  if($text -and $text.Trim() -eq 'OPERADOR'){ return 'parado pelo operador' }
  $age=((Get-Date)-(Get-Item -LiteralPath $marker).LastWriteTime).TotalMinutes
  if($age -le 30){ return 'atualizacao em curso' }
  return $null   # marcador velho de atualizacao interrompida nao segura o canal
}
if(!$Starter){
  $Starter={
    $stamp=Get-Date -Format yyyyMMdd-HHmmss
    Start-Process -FilePath (Join-Path $Root 'RPlayout-Server.exe') -WorkingDirectory $Root `
      -RedirectStandardOutput (Join-Path $Log "servidor-$stamp.out.log") -RedirectStandardError (Join-Path $Log "servidor-$stamp.err.log") -WindowStyle Minimized | Out-Null
  }
}
$turn=0; $misses=0; $starts=New-Object System.Collections.Generic.List[datetime]; $lastNote=''
Say "vigia iniciado para $Root (a cada $EverySeconds s)"
while($true){
  try{
    $why=Paused
    if($why){ if($lastNote -ne $why){ Say "sem acao: $why"; $lastNote=$why }; $misses=0 }
    elseif(!(Test-Path -LiteralPath (Join-Path $Root 'RPlayout-Server.exe'))){ if($lastNote -ne 'sem-exe'){ Say "RPlayout-Server.exe ausente em $Root; nada a fazer"; $lastNote='sem-exe' } }
    elseif(@(Owned).Count -gt 0){ if($lastNote -ne 'ok'){ Say 'servidor rodando'; $lastNote='ok' }; $misses=0 }
    else{
      $misses++
      if($misses -ge $MissesBeforeStart){
        $recent=@($starts | Where-Object { $_ -gt (Get-Date).AddHours(-1) })
        if($recent.Count -ge $MaxStartsPerHour){
          if($lastNote -ne 'limite'){ Say "servidor parado e $MaxStartsPerHour partidas na ultima hora: nao religa mais ate a proxima hora"; $lastNote='limite' }
        }else{
          Say 'servidor parado; religando'
          & $Starter
          $starts.Add((Get-Date)); $misses=0; $lastNote='religado'
        }
      }
    }
  }catch{ Say ('erro do vigia: '+$_.Exception.Message) }
  $turn++
  if($Once -or ($Loops -gt 0 -and $turn -ge $Loops)){ break }
  Start-Sleep -Seconds $EverySeconds
}
