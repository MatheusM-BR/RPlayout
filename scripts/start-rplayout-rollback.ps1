param([string]$Workspace='',[ValidateSet('STAGE','ACTIVATE')][string]$Mode='STAGE',[switch]$AdoptProfile)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
$rollbackPreviousEncoding=[Console]::OutputEncoding
try{
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
  if(!$Workspace){$Workspace=Read-Host 'Pasta preparada para retorno compativel'}
  if(!$Workspace){throw 'Pasta de retorno obrigatoria.'}
  if($AdoptProfile -and $Mode -ne 'ACTIVATE'){throw 'Adocao permanente exige ACTIVATE.'}
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $prefix=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\','/')+'\'
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  if($manifest.version -ne 1 -or !$manifest.files){throw 'Pacote atual incompleto.'}
  foreach($entry in $manifest.files){$file=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.file));if(!$declared.Add([string]$entry.file) -or !$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256){throw 'Integridade da edicao atual nao confirmada.'}}
  foreach($required in @('runtime/node/node.exe','apps/server/dist/prepare-compatible-rollback.cjs')){if(!$declared.Contains($required)){throw 'Ferramenta de retorno ausente.'}}
  $priorRoot=$env:RPLAYOUT_INSTALL_ROOT
  try{
    $env:RPLAYOUT_INSTALL_ROOT=$PSScriptRoot
    Push-Location -LiteralPath $PSScriptRoot
    try{$output=& (Join-Path $PSScriptRoot 'runtime/node/node.exe') (Join-Path $PSScriptRoot 'apps/server/dist/prepare-compatible-rollback.cjs') --workspace ([IO.Path]::GetFullPath($Workspace))}finally{Pop-Location}
    if($LASTEXITCODE -ne 0){throw 'Procedencia/compatibilidade de retorno nao confirmada.'}
    $report=$output | ConvertFrom-Json
  }finally{$env:RPLAYOUT_INSTALL_ROOT=$priorRoot}
  if($report.reviewed -ne $true -or $report.automaticTake -ne $false -or $report.rollbackReady -ne $false){throw 'Relatorio inesperado; nao iniciar retorno.'}
  Write-Host "RETORNO para $($report.target) usando o snapshot completo MAIS RECENTE."
  Write-Host 'A proxima etapa repete a revisao operacional fresca na edicao de destino. Nao para o predecessor e nao autoriza downgrade de schema.'
  # The target's real assistant owns confirmation, fresh review and launcher.
  # Its review receipt is not treated as a transferable TAKE capability.
  & (Join-Path $report.target 'start-rplayout-upgrade.ps1') -Workspace ([IO.Path]::GetFullPath($Workspace)) -Mode $Mode -AdoptProfile:$AdoptProfile
  if($LASTEXITCODE -ne 0){throw 'Retorno terminou sem confirmacao. Confira diarios, sem repetir automaticamente.'}
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;Write-Host 'Nenhuma edicao anterior removida; preserve perfis e diarios de resultado incerto.';exit 1}
finally{[Console]::OutputEncoding=$rollbackPreviousEncoding}
