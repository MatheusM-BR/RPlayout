param([string]$CurrentBackup='', [string]$ReturnBackup='', [string]$VaultFile='', [string]$Destination='')
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
try {
  if (!$CurrentBackup) { $CurrentBackup=Read-Host 'Backup fechado do estado atual, com o historico apos a atualizacao' }
  if (!$ReturnBackup) { $ReturnBackup=Read-Host 'Backup fechado da versao para a qual deseja retornar' }
  if (!$VaultFile) { $VaultFile=Read-Host 'Arquivo do cofre original, na mesma conta Windows' }
  if (!$Destination) { $Destination=Read-Host 'Pasta nova para o relatorio protegido da comparacao' }
  foreach ($value in @($CurrentBackup,$ReturnBackup,$VaultFile,$Destination)) { if (!$value) { throw 'Todos os caminhos sao obrigatorios.' } }
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne 1 -or !$manifest.files) { throw 'Pacote incompleto.' }
  $prefix=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $manifest.files) {
    $file=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.file))
    if (!$declared.Add([string]$entry.file) -or !$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256 -or (Get-Item -LiteralPath $file).Length -ne $entry.bytes) { throw 'Integridade do pacote nao confirmada.' }
  }
  foreach ($required in @('runtime/node/node.exe','apps/server/dist/review-rollback.cjs','apps/engine/target/release/rplayout-file-security.exe')) { if (!$declared.Contains($required)) { throw 'Ferramenta de conferencia ausente no manifesto.' } }
  $originalInstallRoot=$env:RPLAYOUT_INSTALL_ROOT
  try {
    $env:RPLAYOUT_INSTALL_ROOT=$PSScriptRoot
    $output=& (Join-Path $PSScriptRoot 'runtime/node/node.exe') (Join-Path $PSScriptRoot 'apps/server/dist/review-rollback.cjs') --current-backup ([IO.Path]::GetFullPath($CurrentBackup)) --return-backup ([IO.Path]::GetFullPath($ReturnBackup)) --vault-file ([IO.Path]::GetFullPath($VaultFile)) --destination ([IO.Path]::GetFullPath($Destination))
    if ($LASTEXITCODE -ne 0) { throw 'Conferencia recusada; preserve os backups e o cofre. Nenhum retorno foi autorizado.' }
    $report=$output | ConvertFrom-Json
    if (!$report.requestId -or $report.rollbackReady -ne $false -or $report.automaticTake -ne $false -or $report.targetBinaryCompatibility -ne 'NOT_VERIFIED') { throw 'Relatorio inesperado. Nao inicie o retorno.' }
    Write-Host "Historico: $($report.history.newRecords) novos, $($report.history.changedRecords) alterados, $($report.history.missingRecords) ausentes no estado atual."
    Write-Host "Relatorio protegido: $Destination\rollback-review.json"
    Write-Host 'Apenas comparacao: nao mescla historicos, nao troca perfil e nao inicia canais. Compatibilidade da versao anterior e conciliacao operacional ainda obrigatorias.'
  } finally { $env:RPLAYOUT_INSTALL_ROOT=$originalInstallRoot }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nenhum perfil ou banco operacional foi substituido. Eventual pasta parcial deve ser preservada para diagnostico.'
  exit 1
}
