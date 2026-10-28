# Atualiza o RPlayout SEMPRE na mesma pasta (D:\RPlayout Atual).
# Motivo: o Firewall do Windows guarda a permissao por caminho do executavel.
# Cada versao em pasta nova pedia de novo node, mediamtx, engine e devices.
# Usa so as ferramentas oficiais (instalador, preparo em quarentena, ativacao).
param(
  [Parameter(Mandatory)][string]$Tag,          # ex.: r88-18
  [Parameter(Mandatory)][string]$OldRoot,      # instalacao em uso
  [Parameter(Mandatory)][string]$OldData,      # dados em uso (tem backups\upgrade)
  [string]$Stable='D:\RPlayout Atual',
  [string]$StableShortcuts='D:\RPlayout Atual atalhos',
  [string]$MediaRoot='D:\Videos',
  [string]$Log='D:\IA\Claude\RPlayout',
  [int]$MaxBackupAgeMinutes=60,
  [string]$DataRoot='',          # pasta de dados nova; padrao "D:\RPlayout dados <Tag>"
  # Janela de manutencao: a troca tira o canal do ar por ~3 min. Fora da janela
  # o script recusa, a menos que -ForaDaJanela seja passado de proposito.
  [string]$JanelaInicio='02:00',
  [string]$JanelaFim='05:00',
  [switch]$ForaDaJanela
)
function DentroDaJanela([datetime]$agora){
  $ini=[datetime]::ParseExact($JanelaInicio,'HH:mm',$null).TimeOfDay; $fim=[datetime]::ParseExact($JanelaFim,'HH:mm',$null).TimeOfDay; $t=$agora.TimeOfDay
  if($ini -le $fim){ return ($t -ge $ini -and $t -lt $fim) } else { return ($t -ge $ini -or $t -lt $fim) }
}
if(!$ForaDaJanela -and !(DentroDaJanela (Get-Date))){ throw "Fora da janela de manutencao ($JanelaInicio-$JanelaFim). Use -ForaDaJanela so com o canal liberado." }
$ErrorActionPreference='Stop'
$data=if($DataRoot){$DataRoot}else{"D:\RPlayout dados $Tag"}
$work="D:\RPlayout-builds\migracao-$Tag"+$(if($DataRoot){"-"+(Split-Path $DataRoot -Leaf).Replace(' ','-')}else{''}); $bundle=Join-Path $work 'bundle'
$state=[ordered]@{tag=$Tag;stable=$Stable;data=$data;steps=@()}
$jsonFile=Join-Path $Log ("atualizar-$Tag"+$(if($DataRoot){"-"+(Split-Path $DataRoot -Leaf).Replace(" ","-")}else{""})+".json")
function Note($m){$script:state.steps+=("{0:HH:mm:ss} {1}" -f (Get-Date),$m);$script:state|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 $jsonFile}
function Owned($root){Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) }}
function StopRoot($root){
  foreach($p in (@(Owned $root) | Where-Object { $_.Name -imatch '^RPlayout-' })){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  $deadline=(Get-Date).AddSeconds(40); while((Get-Date) -lt $deadline -and @(Owned $root).Count){ Start-Sleep -Milliseconds 500 }
  foreach($p in @(Owned $root)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 3
  if(@(Owned $root).Count){ throw "processos ainda ativos em $root" }
}
function StartRoot($root,$tag){
  Start-Process -FilePath (Join-Path $root 'RPlayout-Server.exe') -WorkingDirectory $root -RedirectStandardOutput (Join-Path $Log "$tag.out.log") -RedirectStandardError (Join-Path $Log "$tag.err.log") -WindowStyle Minimized | Out-Null
}
$retired=$null;$retiredShortcuts=$null;$installedNew=$false
# Marca de manutencao: o vigia (vigiar-rplayout.ps1) nao religa nada durante a troca.
$maintenance=$Stable.TrimEnd('\')+'.manutencao'
$operatorStop=(Test-Path -LiteralPath $maintenance) -and ((Get-Content -LiteralPath $maintenance -Raw).Trim() -eq 'OPERADOR')
if(!$operatorStop){ Set-Content -LiteralPath $maintenance -Value "ATUALIZACAO $Tag" -Encoding ASCII }
try{
  $soak=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match 'soak2?\.ps1' })
  foreach($p in $soak){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  $zip=Get-ChildItem 'D:\RPlayout-builds' -Filter "RPlayout-1.1-parcial-*-$Tag-instalador.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(!$zip){ throw "instalador $Tag nao encontrado" }
  Note ("instalador: "+$zip.Name+" SHA256 "+(Get-FileHash $zip.FullName -Algorithm SHA256).Hash)
  $backup=Get-ChildItem $OldData -Recurse -Filter '*.db' | Where-Object { $_.FullName -match '\\backups\\upgrade\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(!$backup){ throw "backup de atualizacao nao encontrado em $OldData" }
  if(((Get-Date)-$backup.LastWriteTime).TotalMinutes -gt $MaxBackupAgeMinutes){ throw "backup de atualizacao mais antigo que $MaxBackupAgeMinutes min: $($backup.FullName)" }
  Note ("backup: "+$backup.FullName+" SHA256 "+(Get-FileHash $backup.FullName -Algorithm SHA256).Hash)
  if(Test-Path $data){ throw "pasta de dados ja existe: $data" }
  if(!(Test-Path $bundle)){ New-Item -ItemType Directory -Force -Path $work | Out-Null; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($zip.FullName,$bundle); Note 'instalador extraido' }

  StopRoot $OldRoot; Note "versao em uso parada: $OldRoot"

  # A pasta estavel em uso e aposentada com o nome da versao, para rollback.
  if(Test-Path $Stable){
    $oldEdition=(Get-Content (Join-Path $Stable 'installation-receipt.json') -Raw | ConvertFrom-Json).edition
    $suffix=if($oldEdition -match '(r\d+-\d+)$'){$Matches[1]}else{Get-Date -Format yyyyMMdd-HHmmss}
    $retired="$Stable (anterior $suffix)"; if(Test-Path $retired){ $retired="$retired $(Get-Date -Format HHmmss)" }
    Rename-Item -LiteralPath $Stable -NewName (Split-Path $retired -Leaf)
    Note "pasta estavel aposentada: $retired"
  }
  if(Test-Path $StableShortcuts){
    $retiredShortcuts="$StableShortcuts (anterior $(Get-Date -Format yyyyMMdd-HHmmss))"
    Rename-Item -LiteralPath $StableShortcuts -NewName (Split-Path $retiredShortcuts -Leaf)
  }

  & (Join-Path $bundle 'INSTALAR.ps1') -Payload (Join-Path $bundle 'RPlayout-payload.zip') -Destination $Stable -ShortcutDirectory $StableShortcuts *> (Join-Path $work 'instalar.log')
  if(!(Test-Path (Join-Path $Stable 'RPlayout-Server.exe'))){ throw 'instalacao nao concluida; ver instalar.log' }
  $installedNew=$true; Note "$Tag instalada em $Stable"

  & (Join-Path $Stable 'prepare-rplayout-upgrade.ps1') -Backup $backup.FullName -Destination $data -VaultFile (Join-Path $OldData 'vault.json') -MediaRoot $MediaRoot *> (Join-Path $work 'preparar.log')
  if(!(Test-Path (Join-Path $data 'installation-profile.candidate.json'))){ throw 'preparacao nao concluida; ver preparar.log' }
  Note 'dados preparados em quarentena'

  # Revisao previa com a saida capturada. A ativacao oficial repete a revisao,
  # mas o motivo de uma recusa vai so para o console; aqui ele fica no log e a
  # versao anterior volta logo, sem esperar o prazo da ativacao.
  $node=Join-Path $Stable 'runtime\node\node.exe'
  $previousRoot=$env:RPLAYOUT_INSTALL_ROOT; $previousPreference=$ErrorActionPreference
  try{
    $env:RPLAYOUT_INSTALL_ROOT=$Stable; $ErrorActionPreference='Continue'; Push-Location -LiteralPath $Stable
    & $node (Join-Path $Stable 'apps\server\dist\recover-restored-reservation.cjs') --database (Join-Path $data 'service.db') --manifest (Join-Path $data 'restore-quarantine.json') --vault-file (Join-Path $data 'vault.json') *> (Join-Path $work 'reserva.log')
    Note "reserva herdada: saida $LASTEXITCODE"
    & $node (Join-Path $Stable 'apps\server\dist\review-restored.cjs') --database (Join-Path $data 'service.db') --manifest (Join-Path $data 'restore-quarantine.json') --vault-file (Join-Path $data 'vault.json') *> (Join-Path $work 'revisao.log')
    $reviewExit=$LASTEXITCODE
  }finally{ Pop-Location; $env:RPLAYOUT_INSTALL_ROOT=$previousRoot; $ErrorActionPreference=$previousPreference }
  if($reviewExit -ne 0){ throw ('revisao previa recusada: '+((Get-Content (Join-Path $work 'revisao.log') -Raw) -replace '\s+',' ').Trim()) }
  Note 'revisao previa OK'

  $activate=Join-Path $work 'ativar.ps1'
@"
function global:Read-Host { param([string]`$Prompt)
  if(`$Prompt -like 'Digite ATIVAR E ADOTAR para autorizar*'){ return 'ATIVAR E ADOTAR' }
  throw "Prompt inesperado: `$Prompt" }
Start-Transcript -Path '$work\ativar.log' -Force | Out-Null
& '$Stable\start-rplayout-upgrade.ps1' -Workspace '$data' -Mode ACTIVATE -AdoptProfile
"exit `$LASTEXITCODE" | Out-File -Encoding utf8 -Append '$work\ativar.log'
Stop-Transcript | Out-Null
"@ | Set-Content -Encoding UTF8 $activate
  # Ferramentas nativas da revisao (guarda do computador) da etapa anterior
  # precisam ter saido antes da revisao da ativacao.
  Start-Sleep -Seconds 10
  # Saida e erro da ativacao em arquivo: o motivo de uma recusa da revisao
  # sai no erro padrao do node, que a transcricao do PowerShell nao guarda.
  $activation=Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$activate) -WindowStyle Minimized -PassThru `
    -RedirectStandardOutput (Join-Path $work 'ativar.out.log') -RedirectStandardError (Join-Path $work 'ativar.err.log')
  Note 'ativacao iniciada'
  $ok=$false; $deadline=(Get-Date).AddSeconds(240)
  while((Get-Date) -lt $deadline){
    try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'http://127.0.0.1:4000/api/state'; if($r.StatusCode -lt 500){$ok=$true;break} }catch{}
    # Ativacao que ja terminou sem API no ar foi recusada: volta logo, sem esperar o prazo.
    if($activation.HasExited){ throw ('ativacao encerrada sem subir a API: '+((Get-Content (Join-Path $work 'ativar.err.log') -Raw -ErrorAction SilentlyContinue) -replace '\s+',' ').Trim()) }
    Start-Sleep 3
  }
  if(!$ok){ throw 'API da nova versao nao respondeu em 240 s' }
  Note "API da $Tag respondendo (ativacao)"

  # Fim da sessao de ativacao: partida normal na mesma pasta.
  StopRoot $Stable
  StartRoot $Stable $Tag
  $ok=$false; $deadline=(Get-Date).AddSeconds(120)
  while((Get-Date) -lt $deadline){ try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'http://127.0.0.1:4000/api/state'; if($r.StatusCode -lt 500){$ok=$true;break} }catch{}; Start-Sleep 2 }
  if(!$ok){ throw 'partida normal nao respondeu em 120 s' }
  Note "partida normal OK em $Stable"
  $state.ok=$true
}catch{
  $state.error=$_.Exception.Message; Note ('ERRO: '+$_.Exception.Message)
  # Volta para a versao anterior intacta. A nova fica guardada para analise.
  try{
    if(Test-Path $Stable){ StopRoot $Stable }
    if($installedNew -and (Test-Path $Stable)){ Rename-Item -LiteralPath $Stable -NewName ((Split-Path $Stable -Leaf)+" (falhou $Tag $(Get-Date -Format HHmmss))") }
    if($retired -and !(Test-Path $Stable)){ Rename-Item -LiteralPath $retired -NewName (Split-Path $Stable -Leaf); Note 'pasta anterior restaurada' }
    if($retiredShortcuts -and !(Test-Path $StableShortcuts)){ Rename-Item -LiteralPath $retiredShortcuts -NewName (Split-Path $StableShortcuts -Leaf) }
    StartRoot $OldRoot ($Tag+'-rollback'); Note "versao anterior religada: $OldRoot"
  }catch{ Note ('ROLLBACK FALHOU: '+$_.Exception.Message) }
}
if(!$operatorStop -and (Test-Path -LiteralPath $maintenance)){ Remove-Item -LiteralPath $maintenance -Force -ErrorAction SilentlyContinue }
$state|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 $jsonFile
