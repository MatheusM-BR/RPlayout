param([string]$Backup='', [string]$Destination='', [string]$VaultFile='', [string]$MediaRoot='')
$ErrorActionPreference='Stop'
# Pin built-in modules to the executing host; inherited PSModulePath can point to another PowerShell version.
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
# Offline preparation only. No service stop/start, DB overwrite, profile switch,
# old edition cleanup, vault creation or automatic promotion.
try {
  $installRoot=[IO.Path]::GetFullPath($PSScriptRoot)
  $manifestFile=Join-Path $installRoot 'package-manifest.json'
  if (!(Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw 'Execute a ferramenta dentro da NOVA instalacao completa.' }
  $manifest=Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne 1 -or !$manifest.files) { throw 'Manifesto de pacote invalido.' }
  $prefix=$installRoot.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  # Check immutable package contents before executing a restoration binary.
  foreach ($entry in $manifest.files) {
    if (!$declared.Add([string]$entry.file)) { throw 'Manifesto com caminhos repetidos.' }
    $file=[IO.Path]::GetFullPath((Join-Path $installRoot $entry.file))
    if (!$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Arquivo do pacote ausente ou fora da instalacao.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Integridade do pacote mudou. Nao sera executada a restauracao.' }
  }
  $node=Join-Path $installRoot 'runtime/node/node.exe'
  $tool=Join-Path $installRoot 'apps/server/dist/restore-backup.cjs'
  foreach ($required in @('runtime/node/node.exe','apps/server/dist/restore-backup.cjs')) { if (!$declared.Contains($required)) { throw 'Ferramenta de restauracao nao consta no manifesto.' } }
  if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Ferramentas portateis ausentes; nao sera usado runtime global.' }
  if (!$Backup) { $Backup=Read-Host 'Arquivo de BACKUP SQLite validado da edicao anterior (nao o banco em uso)' }
  if (!$Destination) { $Destination=Read-Host 'Pasta NOVA para preparar os dados da atualizacao (nao pode existir)' }
  if (!$VaultFile) { $VaultFile=Read-Host 'vault.json ORIGINAL que protege esse backup' }
  if (!$MediaRoot) { $MediaRoot=Read-Host 'Pasta de midia ORIGINAL que deve continuar disponivel para esta edicao' }
  if (!$Backup -or !$Destination -or !$VaultFile -or !$MediaRoot) { throw 'Backup, pasta nova, cofre original e pasta de midia sao obrigatorios.' }
  if ($env:RPLAYOUT_VAULT_KEY) { throw 'Esta preparacao exige cofre original em arquivo; remova a chave externa conflitante apos revisar a configuracao.' }
  $Backup=[IO.Path]::GetFullPath($Backup)
  $Destination=[IO.Path]::GetFullPath($Destination)
  $VaultFile=[IO.Path]::GetFullPath($VaultFile)
  $MediaRoot=[IO.Path]::GetFullPath($MediaRoot)
  if (!(Test-Path -LiteralPath $MediaRoot -PathType Container)) { throw 'Pasta de midia indisponivel; nao sera substituida por pasta vazia da nova edicao.' }
  if (Test-Path -LiteralPath $Destination) { throw 'Destino existente; nenhum dado sera substituido.' }
  $previousInstallRoot=$env:RPLAYOUT_INSTALL_ROOT
  try {
    $env:RPLAYOUT_INSTALL_ROOT=$installRoot
    $output=& $node $tool --backup $Backup --destination $Destination --vault-file $VaultFile
    if ($LASTEXITCODE -ne 0) { throw 'Restauracao recusada. Preserve eventual pasta parcial para diagnostico; nao repita sobre ela.' }
    $report=$output | ConvertFrom-Json
    if ($report.version -ne 1 -or $report.phase -ne 'QUARANTINED' -or $report.promotionReady -ne $false -or $report.automaticTake -ne $false -or $report.vaultMode -ne 'ORIGINAL_FILE') { throw 'Relatorio inesperado; nao altere o perfil ativo.' }
  } finally { $env:RPLAYOUT_INSTALL_ROOT=$previousInstallRoot }
  $database=Join-Path $Destination 'service.db'
  $localVault=Join-Path $Destination 'vault.json'
  foreach ($file in @($database,$localVault,(Join-Path $Destination 'restore-quarantine.json'))) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Restauracao incompleta; perfil ativo permanece inalterado.' } }
  $candidate=[ordered]@{version=1;dataRoot=$Destination;databaseFile=$database;mediaRoot=$MediaRoot;vaultFile=$localVault}
  $preparation=[ordered]@{version=1;requestId=$report.requestId;preparedAt=[DateTime]::UtcNow.ToString('o');phase='QUARANTINED';candidateProfile='installation-profile.candidate.json';installRoot=$installRoot;packageManifestSha256=(Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash;backupSha256=$report.backupSha256;vaultFingerprint=$report.vaultFingerprint;activeProfileChanged=$false;previousInstallationModified=$false;automaticTake=$false;promotionReady=$false;mediaCopied=$false;schemaCompatibility='REVIEW_REQUIRED';rollbackCompatibility='REVIEW_REQUIRED'}
  foreach ($artifact in @(@{name='installation-profile.candidate.json';value=$candidate},@{name='upgrade-preparation.json';value=$preparation})) {
    $file=Join-Path $Destination $artifact.name
    $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($artifact.value | ConvertTo-Json -Depth 8));$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
  }
  Write-Host "Atualizacao preparada em quarentena: $Destination"
  Write-Host 'Nada entrou no ar. Perfil ativo e edicao anterior nao foram alterados.'
  Write-Host 'Confira midia, QC, saidas, cursores e compatibilidade antes da ativacao operacional. Nao copie o perfil candidato para ativar sem essa revisao.'
  Write-Host 'Rollback exige dados compativeis e conciliacao do as-run posterior; nunca abra banco migrado com binario antigo.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nenhuma edicao anterior foi removida; arquivos parciais de preparacao foram preservados.'
  exit 1
}
