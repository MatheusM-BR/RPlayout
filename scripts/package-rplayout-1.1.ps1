param(
  [string]$Destination = "release/RPlayout-1.1",
  [string]$MsvcRuntimeDirectory = '',
  [switch]$PrunePreviousPackages,
  [switch]$SkipFunctionalVerification
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspaceRoot
$Destination = [System.IO.Path]::GetFullPath($Destination)
if ($Destination -eq $workspaceRoot -or $Destination -eq [System.IO.Path]::GetPathRoot($Destination)) { throw 'Destino inválido: use uma pasta nova de release.' }
if (Test-Path -LiteralPath $Destination) { throw "Destino já existe; não será apagado. Escolha uma nova pasta: $Destination" }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node não disponível na máquina de build.' }
if (!(Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw 'pnpm não disponível na máquina de build.' }
if (!$env:GSTREAMER_1_0_ROOT_MSVC_X86_64 -or !(Test-Path -LiteralPath (Join-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 'bin/gst-inspect-1.0.exe'))) { throw 'Runtime GStreamer completo é obrigatório para o pacote portátil.' }
# Use the redistributable distribution, never DLLs copied from System32.
if (!$MsvcRuntimeDirectory) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $installations = @(& $vswhere -products '*' -property installationPath)
    $MsvcRuntimeDirectory = $installations | ForEach-Object {
      $redist = Join-Path $_ 'VC/Redist/MSVC'
      if (Test-Path -LiteralPath $redist) {
        Get-ChildItem -LiteralPath $redist -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+(\.\d+)?$' } | Sort-Object { [version]$_.Name } -Descending | ForEach-Object {
          $x64 = Join-Path $_.FullName 'x64'
          if (Test-Path -LiteralPath $x64) { Get-ChildItem -LiteralPath $x64 -Directory -Filter 'Microsoft.VC*.CRT' }
        }
      }
    } | Select-Object -First 1 -ExpandProperty FullName
  }
}
if (!$MsvcRuntimeDirectory -or !(Test-Path -LiteralPath $MsvcRuntimeDirectory -PathType Container)) { throw 'Distribuição oficial MSVC x64 ausente. Informe -MsvcRuntimeDirectory com a pasta redistribuível Microsoft.VC*.CRT do Visual Studio.' }
$MsvcRuntimeDirectory = (Resolve-Path -LiteralPath $MsvcRuntimeDirectory).Path
$crtFiles = @(Get-ChildItem -LiteralPath $MsvcRuntimeDirectory -File -Filter '*.dll')
foreach ($name in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
  if (!($crtFiles | Where-Object { $_.Name -eq $name })) { throw "Distribuição MSVC incompleta: $name" }
}
foreach ($dll in $crtFiles) {
  $signature = Get-AuthenticodeSignature -LiteralPath $dll.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Runtime MSVC sem assinatura Microsoft válida: $($dll.Name)" }
  $pe = [System.IO.File]::ReadAllBytes($dll.FullName)
  $peOffset = [BitConverter]::ToInt32($pe, 0x3c)
  if ($peOffset -lt 0 -or $peOffset + 6 -gt $pe.Length -or [BitConverter]::ToUInt32($pe, $peOffset) -ne 0x4550 -or [BitConverter]::ToUInt16($pe, $peOffset + 4) -ne 0x8664) { throw "Runtime MSVC não é PE x64: $($dll.Name)" }
}
# Source changes must never be packaged with an older release engine.
pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw 'Build web/servidor falhou; pacote não gerado.' }
Push-Location -LiteralPath (Join-Path $workspaceRoot 'apps/engine')
try { cargo build --release --bins; if ($LASTEXITCODE -ne 0) { throw 'Build release do engine falhou.' } } finally { Pop-Location }
if ($PrunePreviousPackages) {
  # Artefatos temporários criados pelas tentativas anteriores deste pacote.
  # A lista é deliberadamente fechada: não alcança mídia, código ou releases
  # que tenham outro nome.
  $previous = @(
    (Join-Path (Get-Location) 'release/RPlayout-1.1-validated'),
    (Join-Path (Get-Location) 'release/RPlayout-1.1-standalone'),
    (Join-Path (Get-Location) 'release/server-runtime-deploy'),
    (Join-Path (Get-Location) 'release/server-runtime-staging')
  )
  foreach ($item in $previous) {
    $absolute = [System.IO.Path]::GetFullPath($item)
    $releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot 'release')) + [System.IO.Path]::DirectorySeparatorChar
    if (!$absolute.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Limpeza recusada fora de release.' }
    if ((Test-Path -LiteralPath $absolute) -and ((Get-Item -LiteralPath $absolute).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw "Limpeza recusada em junção: $absolute" }
    if ($absolute -ne $Destination -and (Test-Path -LiteralPath $absolute)) {
      try {
        Remove-Item -LiteralPath $absolute -Recurse -Force
      } catch {
        # Uma junção já removida pode deixar um diretório vazio para trás.
        # Isso não é motivo para abortar a geração do pacote novo.
        Write-Warning "Não foi possível limpar completamente ${absolute}: $($_.Exception.Message)"
      }
    }
  }
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
if (!(Test-Path "apps/engine/target/release/rplayout.exe")) { throw 'Engine release não compilado.' }
Copy-Item apps/engine/target/release/rplayout.exe "$Destination/rplayout-test.exe" -Force
foreach ($client in @('RPlayout-Server.exe','RPlayout-Master.exe','RPlayout-Schedule.exe','RPlayout-Users.exe','RPlayout-Monitor.exe','RPlayout-Aired.exe','RPlayout-QC.exe')) {
  Copy-Item apps/engine/target/release/rplayout.exe "$Destination/$client" -Force
}
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/rplayout-engine.exe" -Force
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/rplayout-engine-test.exe" -Force
New-Item -ItemType Directory -Force -Path "$Destination/apps/engine/target/release" | Out-Null
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/apps/engine/target/release/rplayout-engine.exe" -Force
# O motor OMT é carregado sob demanda pelo engine. Ficam junto do executável
# para o carregador do Windows achá-los sem PATH ou IP configurado pelo operador.
Copy-Item apps/engine/third_party/omt/win-x64/libomt.dll "$Destination/apps/engine/target/release/libomt.dll" -Force
Copy-Item apps/engine/third_party/omt/win-x64/libvmx.dll "$Destination/apps/engine/target/release/libvmx.dll" -Force
Copy-Item apps/engine/third_party/omt/win-x64/libomt.dll "$Destination/libomt.dll" -Force
Copy-Item apps/engine/third_party/omt/win-x64/libvmx.dll "$Destination/libvmx.dll" -Force
New-Item -ItemType Directory -Force -Path "$Destination/licenses/omt" | Out-Null
Copy-Item apps/engine/third_party/omt/LICENSE.txt "$Destination/licenses/omt/LICENSE.txt" -Force
if (!(Test-Path 'apps/engine/target/release/rplayout-host-guard.exe')) { throw 'Trava nativa de distribuição não foi compilada; pacote recusado.' }
if (!(Test-Path 'apps/engine/target/release/rplayout-file-security.exe')) { throw 'Proteção nativa de configuração não foi compilada; pacote recusado.' }
if (!(Test-Path 'apps/engine/target/release/rplayout-audio-bus-probe.exe' -PathType Leaf)) { throw 'Sonda de barramento completo não foi compilada; pacote recusado.' }
foreach ($aux in @('rplayout-probe.exe','rplayout-devices.exe','rplayout-relay.exe','rplayout-avsync.exe','rplayout-proxy.exe','rplayout-audio-analysis.exe','rplayout-audio-bus-probe.exe','rplayout-graphic-probe.exe','rplayout-host-guard.exe','rplayout-file-security.exe')) {
  if (Test-Path "apps/engine/target/release/$aux") { Copy-Item "apps/engine/target/release/$aux" "$Destination/apps/engine/target/release/$aux" -Force }
}
if (!(Test-Path 'apps/server/dist/server.cjs')) { throw 'Servidor empacotado não encontrado. Rode pnpm --filter @rplayout/server build.' }
if (!(Test-Path 'apps/server/dist/schedule-planner.cjs')) { throw 'Auxiliar de montagem empacotado não encontrado. Rode pnpm --filter @rplayout/server build.' }
if (!(Test-Path 'apps/server/dist/ha-witness.cjs')) { throw 'Testemunha HA compilada não encontrada. Rode pnpm --filter @rplayout/server build.' }
if (!(Test-Path 'apps/server/dist/restore-backup.cjs')) { throw 'Ferramenta de restauração compilada não encontrada.' }
if (!(Test-Path 'apps/server/dist/review-restored.cjs')) { throw 'Preparação de restauração compilada não encontrada.' }
if (!(Test-Path 'apps/server/dist/recover-restored-reservation.cjs')) { throw 'Recuperação de reserva compilada não encontrada.' }
foreach($storageHelper in @('storage-service.cjs','storage-bridge.cjs')){
  if(!(Test-Path -LiteralPath "apps/server/dist/$storageHelper" -PathType Leaf)){throw 'Build incompleta: auxiliares do banco separado ausentes.'}
}
Copy-Item package.json "$Destination/" -Force
New-Item -ItemType Directory -Force -Path "$Destination/runtime/node" | Out-Null
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) { Copy-Item $node "$Destination/runtime/node/node.exe" -Force }
New-Item -ItemType Directory -Force -Path "$Destination/apps/web/dist", "$Destination/apps/web" | Out-Null
Copy-Item apps/web/package.json "$Destination/apps/web/" -Force
Copy-Item -Recurse -Force apps/web/dist/* "$Destination/apps/web/dist/"
# Leva somente as dependências de produção, inclusive o módulo nativo do
# SQLite. `hoisted` materializa arquivos reais em node_modules em vez de
# junções do pnpm; isso torna a pasta copiável por ZIP, rede ou pendrive.
# Nenhum `pnpm install`, tsx ou compilação é necessário no operador.
pnpm.cmd --config.package-import-method=copy --filter @rplayout/server deploy --legacy --node-linker=hoisted --prod "$Destination/apps/server"
if ($LASTEXITCODE -ne 0) { throw 'Materialização dos módulos de produção falhou.' }
# Hoisted directories can still contain hardlinks to workspace/store files.
# Detach every deployed file before hashing so later source edits cannot mutate
# a released package. Only files in this newly created destination are replaced.
$deployedRoot = [System.IO.Path]::GetFullPath((Join-Path $Destination 'apps/server'))
if (Get-ChildItem -LiteralPath $deployedRoot -Recurse -Force | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }) { throw 'Deploy contém junções/symlinks; pacote não materializado.' }
foreach ($deployedFile in @(Get-ChildItem -LiteralPath $deployedRoot -Recurse -File -Force)) {
  if (!$deployedFile.FullName.StartsWith($deployedRoot + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Arquivo de deploy fora do novo destino.' }
  $detachedCopy = $deployedFile.FullName + '.rplayout-copy-' + [guid]::NewGuid().ToString('N')
  Copy-Item -LiteralPath $deployedFile.FullName -Destination $detachedCopy
  # Both Move-Item -Force and File.Replace's nullable backup argument have
  # incompatible overwrite behavior on Windows PowerShell 5.1. Unlink only
  # this validated file in the NEW, unpublished package, then rename its
  # detached copy. The workspace/store hardlink and earlier releases survive.
  [System.IO.File]::Delete($deployedFile.FullName)
  [System.IO.File]::Move($detachedCopy, $deployedFile.FullName)
}
New-Item -ItemType Directory -Force -Path "$Destination/apps/server/dist" | Out-Null
Copy-Item apps/server/dist/server.cjs "$Destination/apps/server/dist/server.cjs" -Force
Copy-Item apps/server/dist/schedule-planner.cjs "$Destination/apps/server/dist/schedule-planner.cjs" -Force
Copy-Item apps/server/dist/ha-witness.cjs "$Destination/apps/server/dist/ha-witness.cjs" -Force
Copy-Item apps/server/dist/restore-backup.cjs "$Destination/apps/server/dist/restore-backup.cjs" -Force
Copy-Item apps/server/dist/review-restored.cjs "$Destination/apps/server/dist/review-restored.cjs" -Force
if (!(Test-Path 'apps/server/dist/migrate-restored.cjs')) { throw 'Migracao isolada compilada ausente.' }
Copy-Item apps/server/dist/migrate-restored.cjs "$Destination/apps/server/dist/migrate-restored.cjs" -Force
if (!(Test-Path 'apps/server/dist/reconcile-upgrade-profile.cjs')) { throw 'Reconciliacao de perfil compilada ausente.' }
Copy-Item apps/server/dist/reconcile-upgrade-profile.cjs "$Destination/apps/server/dist/reconcile-upgrade-profile.cjs" -Force
if (!(Test-Path 'apps/server/dist/review-rollback.cjs')) { throw 'Conferencia de historico para retorno compilada ausente.' }
Copy-Item apps/server/dist/review-rollback.cjs "$Destination/apps/server/dist/review-rollback.cjs" -Force
Copy-Item apps/server/dist/recover-restored-reservation.cjs "$Destination/apps/server/dist/recover-restored-reservation.cjs" -Force
foreach($storageHelper in @('storage-service.cjs','storage-bridge.cjs')){
  Copy-Item -LiteralPath "apps/server/dist/$storageHelper" -Destination "$Destination/apps/server/dist/$storageHelper" -Force
}
Copy-Item -Recurse -Force mediamtx "$Destination/"
# O plugin gstndi carrega o runtime oficial por LoadLibrary. O servidor inicia
# em apps/server; sem a DLL nesse diretório o provider NDI existe, mas não
# inicia e a descoberta fica vazia no pacote.
$ndiRuntime = @(
  (Join-Path (Get-Location) 'Processing.NDI.Lib.x64.dll'),
  (Join-Path (Get-Location) 'apps/server/Processing.NDI.Lib.x64.dll')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($ndiRuntime) {
  Copy-Item $ndiRuntime "$Destination/Processing.NDI.Lib.x64.dll" -Force
  Copy-Item $ndiRuntime "$Destination/apps/server/Processing.NDI.Lib.x64.dll" -Force
  Write-Host 'NDI Runtime incluído para descoberta e ingest NDI'
} else {
  throw 'NDI Runtime ausente: não gerar pacote anunciado como NDI autossuficiente.'
}
if ($env:GSTREAMER_1_0_ROOT_MSVC_X86_64 -and (Test-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64)) {
  New-Item -ItemType Directory -Force -Path "$Destination/runtime" | Out-Null
  New-Item -ItemType Directory -Path "$Destination/runtime/gstreamer/lib" -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 'bin') -Destination "$Destination/runtime/gstreamer/bin" -Recurse
  Copy-Item -LiteralPath (Join-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 'lib/gstreamer-1.0') -Destination "$Destination/runtime/gstreamer/lib/gstreamer-1.0" -Recurse
  $pluginScanner = Join-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 'libexec/gstreamer-1.0/gst-plugin-scanner.exe'
  if (!(Test-Path -LiteralPath $pluginScanner)) { throw 'Scanner nativo do GStreamer ausente; não gerar runtime incompleto.' }
  New-Item -ItemType Directory -Path "$Destination/runtime/gstreamer/libexec/gstreamer-1.0" -Force | Out-Null
  Copy-Item -LiteralPath $pluginScanner -Destination "$Destination/runtime/gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe"
  Write-Host "GStreamer portátil incluído em runtime/gstreamer"
} else {
  throw 'GStreamer portátil ausente; pacote incompleto.'
}
Copy-Item docs/RPLAYOUT-1.1-FUNCIONALIDADES.md "$Destination/" -Force
Copy-Item docs/IMPLEMENTACOES-BROADCAST-2026-09-30.md "$Destination/" -Force
Copy-Item scripts/verify-rplayout-package.ps1 "$Destination/" -Force
Copy-Item scripts/verify-media-endpoints.ps1 "$Destination/" -Force
Copy-Item scripts/start-rplayout-server.ps1, scripts/open-rplayout-workspace.ps1 "$Destination/" -Force
Copy-Item scripts/restore-rplayout-backup.ps1 "$Destination/" -Force
Copy-Item scripts/prepare-rplayout-upgrade.ps1 "$Destination/" -Force
Copy-Item scripts/review-rplayout-upgrade.ps1 "$Destination/" -Force
Copy-Item scripts/start-rplayout-upgrade.ps1 "$Destination/" -Force
Copy-Item scripts/reconcile-rplayout-upgrade-profile.ps1 "$Destination/" -Force
Copy-Item scripts/review-rplayout-rollback.ps1 "$Destination/" -Force
Copy-Item scripts/start-rplayout-witness.ps1, scripts/verify-portable-witness.mjs "$Destination/" -Force
# Windows PowerShell 5.1 needs a UTF-8 BOM for Portuguese diagnostics/paths.
foreach ($script in @(Get-ChildItem -LiteralPath $Destination -File -Filter '*.ps1')) {
  $scriptBytes = [System.IO.File]::ReadAllBytes($script.FullName)
  if ($scriptBytes.Length -lt 3 -or $scriptBytes[0] -ne 0xEF -or $scriptBytes[1] -ne 0xBB -or $scriptBytes[2] -ne 0xBF) {
    [System.IO.File]::WriteAllBytes($script.FullName, [byte[]](@(0xEF,0xBB,0xBF) + $scriptBytes))
  }
}
# App-local CRT: each executable starts independently of a global VC++ install.
# Plugins and SQLite also resolve against their hosting executable's directory.
foreach ($relative in @('', 'apps/engine/target/release', 'runtime/node', 'runtime/gstreamer/bin', 'runtime/gstreamer/libexec/gstreamer-1.0')) {
  $runtimeTarget = if ($relative) { Join-Path $Destination $relative } else { $Destination }
  foreach ($dll in $crtFiles) { Copy-Item -LiteralPath $dll.FullName -Destination (Join-Path $runtimeTarget $dll.Name) }
}
Write-Host "MSVC x64 app-local incluído: $($crtFiles[0].VersionInfo.FileVersion)"
$manifestFiles = @(Get-ChildItem -LiteralPath $Destination -Recurse -File | ForEach-Object {
  [ordered]@{ file = $_.FullName.Substring($Destination.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
$manifest = [ordered]@{ version = 1; builtAt = [DateTime]::UtcNow.ToString('o'); functionalVerification = $(if ($SkipFunctionalVerification) { 'NOT_RUN_PARTIAL_BUILD' } else { 'REQUIRED' }); node = (& node -v); msvc = [ordered]@{ version = $crtFiles[0].VersionInfo.FileVersion; distribution = (Split-Path $MsvcRuntimeDirectory -Leaf); deployment = 'app-local'; documentation = 'https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files' }; files = $manifestFiles }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination 'package-manifest.json') -Encoding UTF8
if ($SkipFunctionalVerification) {
  Write-Warning "BUILD PARCIAL NAO HOMOLOGADA: verificacao funcional nao executada por solicitacao do operador. $Destination"
} else {
  & (Join-Path $PSScriptRoot 'verify-rplayout-package.ps1') -Package $Destination
  if ($LASTEXITCODE -ne 0) { throw 'Verificação funcional do pacote falhou.' }
  Write-Host "Pacote compilado e verificado em $Destination"
}
