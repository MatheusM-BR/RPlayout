param([string]$Workspace='', [switch]$MigrateSchema)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
# Offline review. Its JSON is a report, NOT a capability to activate a channel.
try {
  $installRoot=[IO.Path]::GetFullPath($PSScriptRoot)
  if (!$Workspace) { $Workspace=Read-Host 'Pasta da atualizacao preparada em quarentena' }
  if (!$Workspace) { throw 'Pasta de preparacao obrigatoria.' }
  $Workspace=[IO.Path]::GetFullPath($Workspace)
  $directory=[IO.DirectoryInfo]::new($Workspace)
  while ($directory) {
    if (!$directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Preparacao deve estar em pasta fisica, sem links/juncoes.' }
    $directory=$directory.Parent
  }
  $manifestFile=Join-Path $installRoot 'package-manifest.json'
  $preparationFile=Join-Path $Workspace 'upgrade-preparation.json'
  $candidateFile=Join-Path $Workspace 'installation-profile.candidate.json'
  $restoreManifest=Join-Path $Workspace 'restore-quarantine.json'
  $database=Join-Path $Workspace 'service.db'
  $vault=Join-Path $Workspace 'vault.json'
  foreach ($file in @($manifestFile,$preparationFile,$candidateFile,$restoreManifest,$database,$vault)) {
    $info=Get-Item -LiteralPath $file
    if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Preparacao incompleta ou arquivo ligado a outro caminho.' }
  }
  $preparation=Get-Content -LiteralPath $preparationFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $candidate=Get-Content -LiteralPath $candidateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($preparation.version -ne 1 -or $preparation.phase -ne 'QUARANTINED' -or $preparation.promotionReady -ne $false -or [IO.Path]::GetFullPath([string]$preparation.installRoot) -ne $installRoot) { throw 'Preparacao nao pertence a esta edicao ou nao esta em quarentena.' }
  $manifestHash=(Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash
  if ($manifestHash -ne $preparation.packageManifestSha256) { throw 'Pacote mudou desde a preparacao; nao sera aceita uma revisao antiga.' }
  if ($candidate.version -ne 1 -or [IO.Path]::GetFullPath([string]$candidate.dataRoot) -ne $Workspace -or [IO.Path]::GetFullPath([string]$candidate.databaseFile) -ne $database -or [IO.Path]::GetFullPath([string]$candidate.vaultFile) -ne $vault) { throw 'Perfil candidato diverge dos arquivos desta preparacao.' }
  if (!$candidate.mediaRoot -or ![IO.Path]::IsPathRooted([string]$candidate.mediaRoot) -or !(Test-Path -LiteralPath $candidate.mediaRoot -PathType Container)) { throw 'Pasta de midia candidata ausente; revisao recusada.' }
  if ($env:RPLAYOUT_VAULT_KEY) { throw 'Chave externa conflita com o cofre desta preparacao.' }
  $manifest=Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne 1 -or !$manifest.files) { throw 'Manifesto do pacote invalido.' }
  $prefix=$installRoot.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  $declared=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $manifest.files) {
    $file=[IO.Path]::GetFullPath((Join-Path $installRoot $entry.file))
    if (!$declared.Add([string]$entry.file) -or !$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Integridade do pacote nao confirmada.' }
  }
  foreach ($required in @('runtime/node/node.exe','apps/server/dist/review-restored.cjs','apps/engine/target/release/rplayout-host-guard.exe')) { if (!$declared.Contains($required)) { throw 'Ferramenta nativa de revisao nao consta no pacote.' } }
  if ($MigrateSchema -and !$declared.Contains('apps/server/dist/migrate-restored.cjs')) { throw 'Migracao isolada nao consta no pacote.' }
  $candidateHash=(Get-FileHash -LiteralPath $candidateFile -Algorithm SHA256).Hash
  $restoreHash=(Get-FileHash -LiteralPath $restoreManifest -Algorithm SHA256).Hash
  $previousInstallRoot=$env:RPLAYOUT_INSTALL_ROOT
  try {
    $env:RPLAYOUT_INSTALL_ROOT=$installRoot
    Push-Location -LiteralPath $installRoot
    try {
      if ($MigrateSchema) {
        Write-Host 'Migracao explicitamente solicitada apenas para a copia em quarentena; banco anterior nao sera alterado.'
        $migrationOutput=& (Join-Path $installRoot 'runtime/node/node.exe') (Join-Path $installRoot 'apps/server/dist/migrate-restored.cjs') --database $database --manifest $restoreManifest --vault-file $vault
        if ($LASTEXITCODE -ne 0) { throw 'Migracao isolada recusada/incerta. Preserve a copia; nao repita automaticamente.' }
        $migration=$migrationOutput | ConvertFrom-Json
        if ($migration.requestId -ne $preparation.requestId -or $migration.stage -notin @('CURRENT_NOT_ACTIVATED','MIGRATED_NOT_ACTIVATED') -or $migration.promotionReady -ne $false -or $migration.schema.current -ne $true) { throw 'Migracao nao confirmou a edicao esperada; revisao recusada.' }
      }
      # A backup taken from an installation that was itself activated by an upgrade
      # carries that server's live storage reservation. With the predecessor stopped,
      # the official offline recovery releases it on THIS copy only (dead owner, same
      # host and provenance are checked by the tool); otherwise the review refuses.
      if ($declared.Contains('apps/server/dist/recover-restored-reservation.cjs')) {
        $recovered=$false
        try { $previousPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'; $null=& (Join-Path $installRoot 'runtime/node/node.exe') (Join-Path $installRoot 'apps/server/dist/recover-restored-reservation.cjs') --database $database --manifest $restoreManifest --vault-file $vault 2>&1 | Out-Null; $recovered=($LASTEXITCODE -eq 0) } catch { $recovered=$false } finally { $ErrorActionPreference=$previousPreference }
        if ($recovered) { Write-Host 'Reserva herdada da edicao anterior liberada na copia em quarentena (recuperacao oficial).' }
        $global:LASTEXITCODE=0
      }
      $output=& (Join-Path $installRoot 'runtime/node/node.exe') (Join-Path $installRoot 'apps/server/dist/review-restored.cjs') --database $database --manifest $restoreManifest --vault-file $vault
    }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Revisao operacional recusada. Confira predecessor, posse, cursores, grade publicada, midia SHA/QC e cofre.' }
    $report=$output | ConvertFrom-Json
    if ($report.stage -ne 'REVIEWED_NOT_ACTIVATED' -or $report.requestId -ne $preparation.requestId -or $report.activationPerformed -ne $false -or $report.promotionReady -ne $false) { throw 'Relatorio inesperado; nenhum perfil sera trocado.' }
  } finally { $env:RPLAYOUT_INSTALL_ROOT=$previousInstallRoot }
  if ((Get-FileHash -LiteralPath $candidateFile -Algorithm SHA256).Hash -ne $candidateHash -or (Get-FileHash -LiteralPath $restoreManifest -Algorithm SHA256).Hash -ne $restoreHash -or (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash -ne $manifestHash) { throw 'Arquivos da revisao mudaram; confira novamente, sem ativar.' }
  $receipt=[ordered]@{version=1;reviewedAt=[DateTime]::UtcNow.ToString('o');requestId=$report.requestId;stage='REVIEWED_NOT_ACTIVATED';packageManifestSha256=$manifestHash;candidateProfileSha256=$candidateHash;restorationManifestSha256=$restoreHash;facts=$report;activeProfileChanged=$false;activationPerformed=$false;promotionReady=$false;physicalOutputValidated=$false;authorizationReusable=$false}
  $file=Join-Path $Workspace ('upgrade-review-'+[Guid]::NewGuid().ToString()+'.json')
  $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Depth 12));$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
  Write-Host "Revisao registrada: $file"
  Write-Host "$($report.activeChannels) canais, $($report.publishedPlans) publicacoes e $($report.verifiedMedia) midias conferidos; $($report.liveItemsRequiringSignalConfirmation) lives ainda exigem sinal nativo."
  Write-Host 'Nenhum perfil foi trocado e nenhum canal foi ativado. O recibo nao autoriza TAKE e nao substitui a posse/revisao fresca da ativacao.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Preparacao, cofre e edicao anterior preservados. Nenhum perfil ativo foi alterado.'
  exit 1
}
