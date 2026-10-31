param([string]$CurrentBackup='',[string]$BaselineBackup='',[string]$VaultFile='',[string]$TargetInstallation='',[string]$Destination='',[string]$MediaRoot='',[switch]$ExportSnapshots)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
$rollbackPreviousEncoding=[Console]::OutputEncoding
try {
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if($manifest.version -ne 1 -or !$manifest.files){throw 'Use a instalacao completa atual.'}
  $prefix=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\','/')+'\'
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $manifest.files){
    $file=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.file))
    if(!$declared.Add([string]$entry.file) -or !$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256){throw 'Integridade da edicao atual nao confirmada.'}
  }
  foreach($required in @('runtime/node/node.exe','apps/server/dist/prepare-compatible-rollback.cjs')){if(!$declared.Contains($required)){throw 'Ferramenta de retorno ausente.'}}
  if(!$CurrentBackup){$CurrentBackup=Read-Host 'Backup FECHADO mais recente, incluindo operacao apos a atualizacao'}
  if(!$BaselineBackup){$BaselineBackup=Read-Host 'Backup anterior a atualizacao, somente para comparar e preservar IDs do historico'}
  if(!$VaultFile){$VaultFile=Read-Host 'Cofre original em arquivo, na mesma conta Windows'}
  if(!$TargetInstallation){$TargetInstallation=Read-Host 'Instalacao completa da edicao para a qual deseja retornar'}
  if(!$Destination){$Destination=Read-Host 'Pasta NOVA para a copia de retorno em quarentena'}
  if(!$MediaRoot){$MediaRoot=Read-Host 'Pasta de midia que deve continuar disponivel'}
  foreach($value in @($CurrentBackup,$BaselineBackup,$VaultFile,$TargetInstallation,$Destination,$MediaRoot)){if(!$value){throw 'Todos os caminhos sao obrigatorios.'}}
  $priorRoot=$env:RPLAYOUT_INSTALL_ROOT
  try{
    $env:RPLAYOUT_INSTALL_ROOT=$PSScriptRoot
    $extra=@()
    if($ExportSnapshots){$extra=@('--export-snapshots','EXPORTAR');Write-Host 'Exportacao explicitamente solicitada: novas copias SQLite autocontidas, sem mudar origem ou apagar WAL/SHM.'}
    Push-Location -LiteralPath $PSScriptRoot
    try{$output=& (Join-Path $PSScriptRoot 'runtime/node/node.exe') (Join-Path $PSScriptRoot 'apps/server/dist/prepare-compatible-rollback.cjs') --current-backup ([IO.Path]::GetFullPath($CurrentBackup)) --baseline-backup ([IO.Path]::GetFullPath($BaselineBackup)) --vault-file ([IO.Path]::GetFullPath($VaultFile)) --target ([IO.Path]::GetFullPath($TargetInstallation)) --destination ([IO.Path]::GetFullPath($Destination)) --media-root ([IO.Path]::GetFullPath($MediaRoot)) @extra}finally{Pop-Location}
    if($LASTEXITCODE -ne 0){throw 'Retorno recusado. Preserve qualquer copia parcial, sem repetir sobre ela.'}
    $report=$output | ConvertFrom-Json
    if($report.stage -ne 'ROLLBACK_PREPARED_NOT_ACTIVATED' -or $report.rollbackReady -ne $false -or $report.automaticTake -ne $false){throw 'Resultado inesperado; nao iniciar retorno.'}
  }finally{$env:RPLAYOUT_INSTALL_ROOT=$priorRoot}
  Write-Host "Copia de retorno preparada em quarentena: $Destination"
  Write-Host "Historico atual preservado: $($report.history.newRecords) novos, $($report.history.changedRecords) alterados, zero IDs anteriores descartados."
  Write-Host 'Nenhum canal foi parado ou iniciado, nenhum perfil foi trocado. Nao use o backup antigo no lugar do estado atual.'
  Write-Host 'Use start-rplayout-rollback.ps1 para conferencia/ativacao explicita, com predecessor parado e liberado.'
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;Write-Host 'Originais e perfis preservados; nenhuma ativacao automatica.';exit 1}
finally{[Console]::OutputEncoding=$rollbackPreviousEncoding}
