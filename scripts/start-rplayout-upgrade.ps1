param([string]$Workspace='', [ValidateSet('STAGE','ACTIVATE')][string]$Mode='STAGE', [switch]$MigrateSchema, [switch]$AdoptProfile)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
try {
  if (!$Workspace) { $Workspace=Read-Host 'Pasta da atualizacao preparada em quarentena' }
  if (!$Workspace) { throw 'Pasta de preparacao obrigatoria.' }
  if ($AdoptProfile -and $Mode -ne 'ACTIVATE') { throw 'Adocao permanente exige modo ACTIVATE; nao faz parte da conferencia em quarentena.' }
  $Workspace=[IO.Path]::GetFullPath($Workspace)
  $profile=Join-Path $Workspace 'installation-profile.candidate.json'
  $manifest=Join-Path $Workspace 'restore-quarantine.json'
  $review=Join-Path $PSScriptRoot 'review-rplayout-upgrade.ps1'
  $launcher=Join-Path $PSScriptRoot 'RPlayout-Server.exe'
  foreach ($file in @($profile,$manifest,$review,$launcher)) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Preparacao/ferramenta incompleta.' } }
  if ($Mode -eq 'ACTIVATE') {
    Write-Host 'ATENCAO: esta etapa pode retomar os canais, abrir saidas e recuperar o PGM salvo.' -ForegroundColor Yellow
    Write-Host 'Confira o predecessor parado/liberado, os destinos e a midia. Esta ferramenta nao para o servidor anterior.'
    $confirmation=if($AdoptProfile){'ATIVAR E ADOTAR'}else{'ATIVAR'}
    if ($AdoptProfile) { Write-Host 'Apos confirmacao nativa, o perfil desta NOVA edicao sera trocado para a copia preparada. O perfil anterior sera preservado; isso nao e rollback de dados.' }
    if ((Read-Host "Digite $confirmation para autorizar, sem repeticao automatica") -cne $confirmation) { throw 'Ativacao nao autorizada; preparacao preservada.' }
  }
  # Review is fresh, but its receipt is not transferred as a native capability.
  # The backend acquires and retains its own admission again on startup.
  & $review -Workspace $Workspace -MigrateSchema:$MigrateSchema
  if ($LASTEXITCODE -ne 0) { throw 'Revisao nao confirmada; inicio recusado.' }
  $arguments=@('--server-only',('--installation-profile='+$profile))
  if ($Mode -eq 'ACTIVATE') { $arguments+=@(('--activate-restored='+$manifest),'--confirm-restored-activation') }
  else { $arguments+=@('--stage-restored='+$manifest) }
  if ($AdoptProfile) { $arguments+='--adopt-upgrade-profile' }
  else { Write-Host 'Perfil ativo nao sera substituido.' }
  Write-Host 'A janela seguinte pertence somente a este inicio explicitamente selecionado.'
  & $launcher @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Inicio terminou sem confirmacao. Confira o diario de ativacao; nao repita a tentativa automaticamente.' }
  Write-Host 'Processo selecionado encerrado. Confira o historico antes de tentar ativacao novamente ou retornar de versao.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Edicao anterior preservada. Se houve tentativa de adocao, confira perfis/diario antes de reiniciar: resultado incerto nao sera repetido automaticamente.'
  exit 1
}
