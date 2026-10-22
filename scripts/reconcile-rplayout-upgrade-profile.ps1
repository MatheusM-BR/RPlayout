param([string]$Workspace='', [string]$AdoptionId='', [switch]$RecoverMaintenance)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
try {
  if (!$Workspace) { $Workspace=Read-Host 'Pasta dos dados da atualizacao cuja troca de perfil ficou incerta' }
  if (!$Workspace) { throw 'Pasta obrigatoria.' }
  $Workspace=[IO.Path]::GetFullPath($Workspace)
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne 1 -or !$manifest.files) { throw 'Pacote incompleto.' }
  $prefix=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $manifest.files) {
    $file=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.file))
    if (!$declared.Add([string]$entry.file) -or !$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Integridade do pacote nao confirmada.' }
  }
  foreach ($required in @('runtime/node/node.exe','apps/server/dist/reconcile-upgrade-profile.cjs','apps/engine/target/release/rplayout-host-guard.exe')) { if (!$declared.Contains($required)) { throw 'Ferramenta de reconciliacao ausente.' } }
  $node=Join-Path $PSScriptRoot 'runtime/node/node.exe'
  $tool=Join-Path $PSScriptRoot 'apps/server/dist/reconcile-upgrade-profile.cjs'
  $arguments=@('--database',(Join-Path $Workspace 'service.db'),'--vault-file',(Join-Path $Workspace 'vault.json'),'--installation',$PSScriptRoot)
  if (!$AdoptionId) {
    $output=& $node $tool @arguments --adoption-id LISTAR --confirm CONFERIR
    if ($LASTEXITCODE -ne 0) { throw 'Consulta recusada; confira cofre, banco e posse do servidor.' }
    $pending=$output | ConvertFrom-Json
    if (!$pending.pending.Count) { Write-Host 'Nenhuma troca de perfil pendente. Nada foi alterado.';return }
    foreach ($entry in $pending.pending) { Write-Host "Adoção pendente: $($entry.id)" }
    $AdoptionId=Read-Host 'ID exato da adocao que deseja reconciliar'
  }
  Write-Host 'Esta etapa so reconhece o perfil realmente observado e o diario autenticado. Nao troca arquivos, nao faz TAKE e nao para processos.'
  $confirmation=if($RecoverMaintenance){'LIBERAR RESERVA E RECONCILIAR'}else{'RECONCILIAR'}
  if ($RecoverMaintenance) { Write-Host 'Recuperacao adicional de reserva somente se detentor/instancias locais estiverem comprovadamente mortos e predecessor liberado. Nao ha roubo por timeout.' }
  if ((Read-Host "Digite $confirmation para conferir e registrar esse resultado") -cne $confirmation) { throw 'Reconciliacao nao autorizada.' }
  if ($RecoverMaintenance) { $arguments+=@('--recover-maintenance','LIBERAR') }
  $output=& $node $tool @arguments --adoption-id $AdoptionId --confirm RECONCILIAR
  if ($LASTEXITCODE -ne 0) { throw 'Reconciliacao recusada/incerta. Preserve os perfis e o diario; nao force partida.' }
  $report=$output | ConvertFrom-Json
  if ($report.reconciled -ne $true -or $report.profileChanged -ne $false -or $report.automaticTake -ne $false) { throw 'Relatorio inesperado; confira o diario antes de abrir o servidor.' }
  Write-Host "Resultado observado registrado: $($report.phase)"
  Write-Host 'Nenhum canal foi iniciado. Isso nao comprova o ACK historico perdido, a saida fisica ou compatibilidade de rollback.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nenhum perfil anterior foi apagado e nenhuma ativacao foi repetida.'
  exit 1
}
