param([string]$Package = "release/RPlayout-1.1",[switch]$SkipDeferredHa)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $Package).Path
$required = @(
  'apps/server/dist/recover-restored-reservation.cjs',
  'apps/server/dist/storage-service.cjs',
  'apps/server/dist/storage-bridge.cjs',
  'package-manifest.json',
  'runtime/node/node.exe',
  'runtime/gstreamer/bin/gst-inspect-1.0.exe',
  'runtime/gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe',
  'runtime/gstreamer/lib/gstreamer-1.0/gstdecklink.dll',
  'runtime/gstreamer/lib/gstreamer-1.0/gstndi.dll',
  'apps/server/Processing.NDI.Lib.x64.dll',
  'rplayout-engine.exe',
  'libomt.dll',
  'libvmx.dll',
  'rplayout-test.exe',
  'RPlayout-Server.exe',
  'RPlayout-Master.exe',
  'RPlayout-Schedule.exe',
  'RPlayout-Users.exe',
  'RPlayout-Monitor.exe',
  'RPlayout-Aired.exe',
  'RPlayout-QC.exe',
  'rplayout-engine-test.exe',
  'apps/web/dist/index.html',
  'apps/server/dist/server.cjs',
  'apps/server/dist/schedule-planner.cjs',
  'apps/server/dist/ha-witness.cjs',
  'apps/server/dist/restore-backup.cjs',
  'apps/server/dist/review-restored.cjs',
  'apps/server/dist/migrate-restored.cjs',
  'apps/server/dist/reconcile-upgrade-profile.cjs',
  'apps/server/dist/review-rollback.cjs',
  'apps/server/dist/rollback-contract.cjs',
  'apps/server/dist/prepare-compatible-rollback.cjs',
  'prepare-rplayout-rollback.ps1',
  'start-rplayout-rollback.ps1',
  'restore-rplayout-backup.ps1',
  'prepare-rplayout-upgrade.ps1',
  'review-rplayout-upgrade.ps1',
  'start-rplayout-upgrade.ps1',
  'reconcile-rplayout-upgrade-profile.ps1',
  'review-rplayout-rollback.ps1',
  'start-rplayout-witness.ps1',
  'verify-portable-witness.mjs',
  'apps/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'apps/engine/target/release/rplayout-engine.exe',
  'apps/engine/target/release/libomt.dll',
  'apps/engine/target/release/libvmx.dll',
  'apps/engine/target/release/rplayout-probe.exe',
  'apps/engine/target/release/rplayout-proxy.exe',
  'apps/engine/target/release/rplayout-audio-analysis.exe',
  'apps/engine/target/release/rplayout-audio-bus-probe.exe',
  'apps/engine/target/release/rplayout-graphic-probe.exe',
  'apps/engine/target/release/rplayout-devices.exe',
  'apps/engine/target/release/rplayout-relay.exe',
  'apps/engine/target/release/rplayout-host-guard.exe',
  'apps/engine/target/release/rplayout-file-security.exe',
  'mediamtx/mediamtx.exe',
  'RPLAYOUT-1.1-FUNCIONALIDADES.md'
)
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $root $_)) })
foreach ($directory in @('', 'apps/engine/target/release', 'runtime/node', 'runtime/gstreamer/bin', 'runtime/gstreamer/libexec/gstreamer-1.0')) {
  foreach ($name in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
    $relative = if ($directory) { "$directory/$name" } else { $name }
    if (!(Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { $missing += $relative }
  }
}
if ($missing.Count -gt 0) {
  Write-Error ('Pacote incompleto. Faltam: ' + ($missing -join ', '))
  exit 1
}
$gst = Join-Path $root 'runtime/gstreamer/bin'
if (Test-Path $gst) {
  Write-Host "GStreamer portátil: OK ($gst)" -ForegroundColor Green
} else {
  Write-Warning 'GStreamer portátil ausente: o engine dependerá da instalação global do sistema.'
}
if ((Test-Path (Join-Path $root 'runtime/node/node.exe')) -and (Test-Path (Join-Path $root 'apps/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node'))) {
  Write-Host 'Node e dependências de produção portáteis: OK' -ForegroundColor Green
} else {
  Write-Warning 'Node ou dependências de produção ausentes: o launcher não é autônomo.'
}
$ndiRuntime = Join-Path $root 'apps/server/Processing.NDI.Lib.x64.dll'
if (Test-Path $ndiRuntime) {
  Write-Host "NDI Runtime: OK ($ndiRuntime)" -ForegroundColor Green
} else {
  Write-Warning 'NDI Runtime ausente: não há descoberta ou ingest NDI funcional neste pacote.'
}
$files = $required | ForEach-Object {
  $path = Join-Path $root $_
  $hash = (Get-FileHash $path -Algorithm SHA256).Hash
  [pscustomobject]@{ File = $_; Bytes = (Get-Item $path).Length; SHA256 = $hash }
}
$manifest = Get-Content -LiteralPath (Join-Path $root 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne 1 -or !$manifest.files -or $manifest.files.Count -lt 10) { throw 'Manifesto de integridade inválido.' }
if ($manifest.msvc.deployment -ne 'app-local' -or !$manifest.msvc.version) { throw 'Manifesto sem distribuição MSVC app-local.' }
foreach ($name in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
  $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $root $name)
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Runtime MSVC portátil sem assinatura Microsoft válida: $name" }
}
Write-Host "MSVC app-local: OK ($($manifest.msvc.version))" -ForegroundColor Green
foreach ($entry in $manifest.files) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $root $entry.file))
  if (!$target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Manifesto aponta fora do pacote.' }
  if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "Arquivo ausente: $($entry.file)" }
  if ((Get-Item -LiteralPath $target).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Arquivo alterado ou incompleto: $($entry.file)" }
}
# Test with bundled Node, not the workstation's global Node/tsx/pnpm.
'const path=require("node:path");const Database=require(path.join(process.argv[2],"apps/server/node_modules/better-sqlite3"));const db=new Database(":memory:");db.exec("CREATE TABLE smoke(id);INSERT INTO smoke VALUES (42)");if(db.prepare("SELECT id FROM smoke").get().id!==42)process.exit(1);db.close();console.log("SQLite nativo com Node portátil: OK");' | & (Join-Path $root 'runtime/node/node.exe') - $root
if ($LASTEXITCODE -ne 0) { throw 'SQLite incompatível com o Node portátil; pacote não operacional.' }
# Prove native loading using the package, not globally installed GStreamer.
$savedPortableEnvironment = @{}
foreach ($name in @('PATH','GST_PLUGIN_PATH','GST_PLUGIN_SYSTEM_PATH','GST_PLUGIN_SCANNER','GST_REGISTRY','GSTREAMER_1_0_ROOT_MSVC_X86_64','RPLAYOUT_OMT_RUNTIME')) { $savedPortableEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$portableProbeDir = Join-Path ([System.IO.Path]::GetTempPath()) ('RPlayout-package-native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $portableProbeDir | Out-Null
try {
  $env:PATH = $gst + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
  $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 = Join-Path $root 'runtime/gstreamer'
  $env:GST_PLUGIN_PATH = Join-Path $root 'runtime/gstreamer/lib/gstreamer-1.0'
  $env:GST_PLUGIN_SYSTEM_PATH = $env:GST_PLUGIN_PATH
  $env:GST_PLUGIN_SCANNER = Join-Path $root 'runtime/gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe'
  $env:GST_REGISTRY = Join-Path $portableProbeDir 'registry.bin'
  $env:RPLAYOUT_OMT_RUNTIME = Join-Path $root 'libomt.dll'
  foreach ($plugin in @('decklinkvideosrc','ndisrc','x264enc','avdec_h264','rsvgoverlay','opusenc','fakesink')) {
    $inspection = & (Join-Path $gst 'gst-inspect-1.0.exe') $plugin 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Plugin portátil não carregou: $plugin. $inspection" }
  }
  $engineDirectory = Join-Path $root 'apps/engine/target/release'
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $engineDirectory 'rplayout-engine.exe'
  $start.Arguments = '--channel-id package-native --width 320 --height 180 --fps-num 25 --fps-den 1 --output null'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $engine = New-Object System.Diagnostics.Process
  $engine.StartInfo = $start
  try {
    if (!$engine.Start()) { throw 'Engine portátil não iniciou.' }
    $stdout = $engine.StandardOutput.ReadToEndAsync()
    $stderr = $engine.StandardError.ReadToEndAsync()
    $loadedCrt = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (!$engine.HasExited -and [DateTime]::UtcNow -lt $deadline -and !$loadedCrt) {
      $engine.Refresh()
      $loadedCrt = @($engine.Modules | Where-Object { $_.ModuleName -ieq 'vcruntime140.dll' }) | Select-Object -First 1
      if (!$loadedCrt) { Start-Sleep -Milliseconds 50 }
    }
    if (!$loadedCrt -or $loadedCrt.FileName -ine (Join-Path $engineDirectory 'vcruntime140.dll')) { throw 'Engine não comprovou carregamento do MSVC incluído; não aceitar dependência do runtime global.' }
    $engine.StandardInput.WriteLine('{"id":1,"cmd":"shutdown"}')
    $engine.StandardInput.Flush()
    $shutdownAt = [DateTime]::UtcNow
    if (!$engine.WaitForExit(15000)) {
      $engine.Kill(); [void]$engine.WaitForExit(5000)
      $seen = @(($stdout.GetAwaiter().GetResult() -split '\r?\n') | Where-Object { $_ -notmatch '"event":"(levels|videoProbe|output)"' } | Select-Object -First 8) -join ' | '
      throw "Engine portátil não encerrou dentro do prazo (aguardou $([int]((Get-Date).ToUniversalTime()-$shutdownAt).TotalSeconds) s após shutdown). Saída: $seen; erro: $($stderr.GetAwaiter().GetResult())"
    }
    $engineOutput = $stdout.GetAwaiter().GetResult() -split '\r?\n'
    $engineError = $stderr.GetAwaiter().GetResult()
    if ($engine.ExitCode -ne 0) { throw "Engine portátil não inicializou: $engineError" }
    Write-Host 'Engine carregou vcruntime140.dll do próprio pacote: OK' -ForegroundColor Green
  } finally {
    if (!$engine.HasExited) { $engine.Kill(); $engine.WaitForExit(5000) | Out-Null }
    $engine.Dispose()
  }
  $events = @($engineOutput | ForEach-Object { try { $_.ToString() | ConvertFrom-Json } catch {} })
  if (!($events | Where-Object { $_.event -eq 'ready' }) -or !($events | Where-Object { $_.event -eq 'ack' -and $_.id -eq 1 -and $_.ok })) { throw 'Engine portátil não confirmou ready/shutdown.' }
  Write-Host 'Plugins e engine com PATH exclusivamente portátil: OK (não homologa hardware/sinal físico)' -ForegroundColor Green
  # The verifier and service use only built-in modules and bundled production
  # SQLite/Node. No tsx/tsc/pnpm or global runtime can satisfy this check.
  if($SkipDeferredHa){
    Write-Host 'HA/testemunha: NAO VALIDADO (grupo8 adiado pelo usuario; nenhuma aprovacao de redundancia).' -ForegroundColor Yellow
  }else{
    & (Join-Path $root 'runtime/node/node.exe') (Join-Path $root 'verify-portable-witness.mjs') $root
    if ($LASTEXITCODE -ne 0) { throw 'Testemunha/concessão nativa do pacote não passou; pacote não operacional para HA protegida.' }
  }
} finally {
  foreach ($name in $savedPortableEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedPortableEnvironment[$name], 'Process') }
}
Write-Host "Pacote com integridade e SQLite validados: $root"
$files | Format-Table -AutoSize
