param([string]$Backup,[string]$Destination,[string]$VaultFile,[string]$RecoveryPasswordFile)
$ErrorActionPreference = 'Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
$node = Join-Path $PSScriptRoot 'runtime/node/node.exe'
$tool = Join-Path $PSScriptRoot 'apps/server/dist/restore-backup.cjs'
foreach ($file in @($node,$tool)) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Ferramenta embutida de restauração ausente. Use um pacote atualizado.' } }
if (!$Backup) { $Backup = Read-Host 'Caminho do arquivo de backup .db' }
if (!$Destination) { $Destination = Read-Host 'Pasta NOVA para conferência (não pode existir)' }
# A senha de recuperação NUNCA vai por argumento: arquivo (-RecoveryPasswordFile),
# variável RPLAYOUT_RECOVERY_PASSWORD ou digitação oculta, passada ao Node só pelo
# ambiente deste processo e apagada no fim.
$typedPassword = $false
if (!$VaultFile -and !$RecoveryPasswordFile -and !$env:RPLAYOUT_VAULT_KEY -and !$env:RPLAYOUT_RECOVERY_PASSWORD) {
  $choice = Read-Host 'Outra máquina/usuário? Digite S para usar a senha de recuperação, ou Enter para informar o vault.json original'
  if ($choice -match '^[sS]') {
    $secure = Read-Host 'Senha de recuperação do cofre' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:RPLAYOUT_RECOVERY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $typedPassword = $true
  } else { $VaultFile = Read-Host 'Caminho do vault.json ORIGINAL da instalação' }
}
$restoreArguments = @('--backup',$Backup,'--destination',$Destination)
if ($VaultFile) { $restoreArguments += @('--vault-file',$VaultFile) }
if ($RecoveryPasswordFile) { $restoreArguments += @('--recovery-password-file',$RecoveryPasswordFile) }
$previousInstallRoot = $env:RPLAYOUT_INSTALL_ROOT
try {
  $env:RPLAYOUT_INSTALL_ROOT = $PSScriptRoot
  $result = & $node $tool @restoreArguments
  if ($LASTEXITCODE -ne 0) { throw 'Restauração recusada. A instalação atual não foi substituída; preserve a eventual pasta parcial para diagnóstico.' }
  $report = $result | ConvertFrom-Json
  if ($report.phase -ne 'QUARANTINED' -or $report.promotionReady -ne $false) { throw 'Relatório inesperado; não inicie o canal.' }
  Write-Host "Cópia recuperada para conferência em: $Destination"
  Write-Host 'O canal não foi liberado nem iniciou reprodução. Mídia não foi copiada: os caminhos originais foram preservados.'
  if ($report.vaultMode -eq 'RECOVERY_PASSWORD') {
    Write-Host "Chave aberta pela senha de recuperação e re-embrulhada para este usuário em: $(Join-Path $Destination 'vault.json')"
    Write-Host 'Aponte RPLAYOUT_VAULT_FILE para esse arquivo (ou copie-o para a pasta security da instalação) antes de iniciar o servidor.'
  } else {
    Write-Host 'Guarde o cofre original. Outra conta Windows/máquina exige a senha de recuperação ou chave compartilhada previamente preservada.'
  }
} finally {
  $env:RPLAYOUT_INSTALL_ROOT = $previousInstallRoot
  if ($typedPassword) { Remove-Item Env:RPLAYOUT_RECOVERY_PASSWORD -ErrorAction SilentlyContinue }
}
