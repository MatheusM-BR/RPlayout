param([string]$Backup,[string]$Destination,[string]$VaultFile)
$ErrorActionPreference = 'Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
$node = Join-Path $PSScriptRoot 'runtime/node/node.exe'
$tool = Join-Path $PSScriptRoot 'apps/server/dist/restore-backup.cjs'
foreach ($file in @($node,$tool)) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Ferramenta embutida de restauração ausente. Use um pacote atualizado.' } }
if (!$Backup) { $Backup = Read-Host 'Caminho do arquivo de backup .db' }
if (!$Destination) { $Destination = Read-Host 'Pasta NOVA para conferência (não pode existir)' }
if (!$VaultFile -and !$env:RPLAYOUT_VAULT_KEY) { $VaultFile = Read-Host 'Caminho do vault.json ORIGINAL da instalação' }
$restoreArguments = @('--backup',$Backup,'--destination',$Destination)
if ($VaultFile) { $restoreArguments += @('--vault-file',$VaultFile) }
$previousInstallRoot = $env:RPLAYOUT_INSTALL_ROOT
try {
  $env:RPLAYOUT_INSTALL_ROOT = $PSScriptRoot
  $result = & $node $tool @restoreArguments
  if ($LASTEXITCODE -ne 0) { throw 'Restauração recusada. A instalação atual não foi substituída; preserve a eventual pasta parcial para diagnóstico.' }
  $report = $result | ConvertFrom-Json
  if ($report.phase -ne 'QUARANTINED' -or $report.promotionReady -ne $false) { throw 'Relatório inesperado; não inicie o canal.' }
  Write-Host "Cópia recuperada para conferência em: $Destination"
  Write-Host 'O canal não foi liberado nem iniciou reprodução. Mídia não foi copiada: os caminhos originais foram preservados.'
  Write-Host 'Guarde o cofre original. Outra conta Windows/máquina exige chave compartilhada previamente preservada.'
} finally { $env:RPLAYOUT_INSTALL_ROOT = $previousInstallRoot }
