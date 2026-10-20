param(
  [string]$Output = 'D:\RPlayout-builds',
  [string]$BasePackage = 'release/runtime-base-r30',
  [string]$Edition = 'RPlayout-1.1-parcial-20261020-r88',
  # Re-run only the installed-package checks (12, 13) against an existing QA install.
  [string]$VerifyInstalled = ''
)
# r88: ONE command on the build machine (Windows, PowerShell 5.1+):
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\RPlayout\scripts\build-r88.ps1
# Builds, tests, packages, installs into a NEW QA folder and verifies.
# Never deletes releases, databases, media or earlier installations.
# Every step result goes to r88-summary-<stamp>.json next to the ZIP.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspace
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Output = [IO.Path]::GetFullPath($Output)
if (!(Test-Path -LiteralPath $Output)) { New-Item -ItemType Directory -Path $Output | Out-Null }
$scratch = Join-Path $workspace "scratch\r88-$stamp"
New-Item -ItemType Directory -Path $scratch | Out-Null
$log = Join-Path $Output "r88-build-$stamp.log"
Start-Transcript -LiteralPath $log | Out-Null
$summary = [ordered]@{ edition = $Edition; startedAt = (Get-Date).ToString('o'); workspace = $workspace; steps = [ordered]@{}; notValidated = @(
  'DeckLink fisica (adiada pelo usuario)','Emissor NDI/OMT externo','Windows limpo','Soak 24/48h','Estacoes remotas em rede real',
  'Revisao de licenca NDI (REVIEW_REQUIRED)','Grupo 8 HA entre maquinas (v3)','Saida de broadcast real (ensaio usa saida null)') }
function Save-Summary { $summary.finishedAt = (Get-Date).ToString('o'); [IO.File]::WriteAllText((Join-Path $Output "r88-summary-$stamp.json"), ($summary | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false)) }
function Step([string]$Name, [scriptblock]$Body, [switch]$ContinueOnFailure) {
  Write-Host ""; Write-Host "=== $Name" -ForegroundColor Cyan
  $started = Get-Date
  try {
    $detail = & $Body
    $summary.steps[$Name] = [ordered]@{ result = 'PASS'; seconds = [int]((Get-Date) - $started).TotalSeconds; detail = $detail }
    Write-Host "PASS: $Name" -ForegroundColor Green
  } catch {
    $summary.steps[$Name] = [ordered]@{ result = 'FAIL'; seconds = [int]((Get-Date) - $started).TotalSeconds; error = $_.Exception.Message }
    Write-Host "FAIL: $Name -> $($_.Exception.Message)" -ForegroundColor Red
    if (!$ContinueOnFailure) { Save-Summary; Stop-Transcript | Out-Null; Write-Host "Interrompido. Resumo: $Output\r88-summary-$stamp.json"; exit 1 }
  }
}
function Run([string]$File, [string[]]$Arguments, [string]$What) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$What falhou (exit $LASTEXITCODE)" }
}

if ($VerifyInstalled) {
  $summary.installed = [IO.Path]::GetFullPath($VerifyInstalled)
  if (!(Test-Path -LiteralPath (Join-Path $summary.installed 'installation-receipt.json'))) { throw "Instalacao QA sem recibo: $VerifyInstalled" }
  $summary.mode = 'VERIFY_INSTALLED_ONLY'
} else {
Step '01 pre-requisitos' {
  foreach ($tool in @('node','pnpm.cmd','cargo','git')) { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool nao encontrado no PATH" } }
  if (!$env:GSTREAMER_1_0_ROOT_MSVC_X86_64 -or !(Test-Path (Join-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 'bin\gst-launch-1.0.exe'))) { throw 'GSTREAMER_1_0_ROOT_MSVC_X86_64 ausente ou incompleto' }
  $base = Get-Content -LiteralPath (Join-Path $workspace "$BasePackage\package-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $node = (& node -v)
  if ($node -ne $base.node) { throw "Node $node difere do runtime da base ($($base.node)). Instale Node $($base.node) para empacotar." }
  $head = (& git rev-parse HEAD); $dirty = @(& git status --porcelain | Where-Object { $_ -notmatch 'state\.json|undefined' })
  if ($dirty.Count) { throw "Arvore com alteracoes nao commitadas: $($dirty -join '; ')" }
  # Never overwrite or delete an earlier attempt: pick the next free edition name.
  $baseEdition = $Edition; $attempt = 1
  while (Test-Path -LiteralPath (Join-Path $Output "$Edition-instalador.zip")) { $attempt++; $script:Edition = "$baseEdition-$attempt"; $Edition = $script:Edition }
  $summary.edition = $Edition
  [ordered]@{ head = $head; node = $node; gstreamer = $env:GSTREAMER_1_0_ROOT_MSVC_X86_64; base = $BasePackage; edition = $Edition }
}
Step '02 dependencias (lockfile congelado)' { Run 'pnpm.cmd' @('install','--frozen-lockfile') 'pnpm install'; 'ok' }
Step '03 typecheck servidor e interface' { Run 'pnpm.cmd' @('typecheck') 'typecheck'; 'ok' }
Step '04 testes JS do nucleo da troca' {
  $files = @('engine-transport','native-live-replacement','native-live-replacement-ledger','native-live-replacement-commit','native-live-replacement-session',
    'native-live-replacement-routes','live-program-binding','checkpoints','checkpoint-recovery','ha-recovery-cursor','rollback-contract','asrun','asrun-evidence','interruption-routes') |
    ForEach-Object { "apps/server/src/domain/$_.test.ts" }
  $files += 'apps/web/src/components/live-replacement-markup.test.ts'
  $report = Join-Path $scratch 'tests-focused.json'
  & pnpm.cmd exec vitest run @files --reporter=default --reporter=json "--outputFile.json=$report"
  $parsed = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $parsed.numFailedTests -gt 0) { throw "vitest: $($parsed.numPassedTests) PASS / $($parsed.numFailedTests) FAIL" }
  "$($parsed.numPassedTests) PASS / 0 FAIL em $($parsed.numTotalTestSuites) suites"
}
Step '05 build web e servidor' { Run 'pnpm.cmd' @('build') 'pnpm build'; 'ok' }
Step '06 build release do engine' {
  Push-Location (Join-Path $workspace 'apps\engine'); try { Run 'cargo' @('build','--release','--bins') 'cargo build' } finally { Pop-Location }
  (Get-FileHash (Join-Path $workspace 'apps\engine\target\release\rplayout-engine.exe') -Algorithm SHA256).Hash
}
Step '07 testes Rust do engine (GStreamer do Windows)' -ContinueOnFailure {
  # PS 5.1 turns native stderr into terminating errors under Stop; cargo logs there.
  $ErrorActionPreference = 'Continue'
  Push-Location (Join-Path $workspace 'apps\engine')
  try {
    $out = & cargo test --bin rplayout-engine -- --test-threads=1 2>&1 | Tee-Object -FilePath (Join-Path $scratch 'cargo-test.log')
    $result = ($out | Where-Object { "$_" -match '^test result:' }) -join ' '
    $failed = @($out | Where-Object { "$_" -match '^test .* FAILED$' } | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { throw "$result; falhas: $($failed -join ', ')" }
    $result
  } finally { Pop-Location }
}
Step '08 ensaio nativo da troca de fonte (engine real, SRT local)' -ContinueOnFailure {
  $ErrorActionPreference = 'Continue'
  $env:RPLAYOUT_ENGINE = Join-Path $workspace 'apps\engine\target\release\rplayout-engine.exe'
  $out = & pnpm.cmd --filter @rplayout/server exec tsx ../../scripts/verify-live-replacement-native.mts 2>&1 | Tee-Object -FilePath (Join-Path $scratch 'native-replacement.log')
  Remove-Item Env:RPLAYOUT_ENGINE
  $line = @($out | Where-Object { "$_" -match '"result":"PASS"' }) | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or !$line) { throw 'Ensaio nativo nao passou; ver native-replacement.log' }
  "$line"
}
Step '09 instalador r88' {
  & (Join-Path $PSScriptRoot 'build-streamed-partial-installer.ps1') -BasePackage $BasePackage -OutputDirectory $Output -Destination "$Edition-instalador.zip" -Readme 'docs/BUILD-PARCIAL-R88.md' -UseCurrentBuilds
  $zip = Join-Path $Output "$Edition-instalador.zip"
  if (!(Test-Path -LiteralPath $zip)) { throw 'ZIP nao gerado' }
  $summary.zip = $zip; $summary.zipSha256 = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  $summary.zipSha256
}
Step '10 conferencia do ZIP' { & (Join-Path $PSScriptRoot 'verify-installer-zip.ps1') -Archive $summary.zip -EvidenceDirectory (Join-Path $scratch 'zip'); 'ok' }
Step '11 instalacao isolada de QA' {
  $qa = Join-Path $Output 'qa'
  if (!(Test-Path -LiteralPath $qa)) { New-Item -ItemType Directory -Path $qa | Out-Null }
  $summary.installed = Join-Path $qa "r88-installed-$stamp"
  & (Join-Path $PSScriptRoot 'verify-installed-partial.ps1') -Archive $summary.zip -ExpectedSha256 $summary.zipSha256 -EvidenceDirectory (Join-Path $qa "r88-evidence-$stamp") `
    -Destination $summary.installed -ShortcutDirectory (Join-Path $qa "r88-shortcuts-$stamp") -ExternalQaRoot $qa | Out-Null
  $summary.installed
}
}
Step '12 verificacao funcional do pacote instalado' { & (Join-Path $PSScriptRoot 'verify-rplayout-package.ps1') -Package $summary.installed -SkipDeferredHa; 'ok' } -ContinueOnFailure
Step '13 engine instalado anuncia a troca nativa' -ContinueOnFailure {
  $engine = Join-Path $summary.installed 'apps\engine\target\release\rplayout-engine.exe'
  $gst = Join-Path $summary.installed 'runtime\gstreamer'
  $saved = $env:PATH; $env:PATH = (Join-Path $gst 'bin') + ';' + $env:PATH
  $env:GST_PLUGIN_PATH = Join-Path $gst 'lib\gstreamer-1.0'; $env:GST_PLUGIN_SYSTEM_PATH = $env:GST_PLUGIN_PATH
  try {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $engine; $start.Arguments = '--channel-id r88-probe --width 320 --height 180 --fps-num 25 --fps-den 1 --output null'
    $start.UseShellExecute = $false; $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.CreateNoWindow = $true
    try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
    $process = [Diagnostics.Process]::Start($start)
    $ready = $null; $deadline = (Get-Date).AddSeconds(30)
    $pending = $null
    while (!$ready -and (Get-Date) -lt $deadline) {
      if (!$pending) { $pending = $process.StandardOutput.ReadLineAsync() }
      if (!$pending.Wait(500)) { continue }
      $line = $pending.Result; $pending = $null
      if ($null -eq $line) { break }
      if ($line -match '"event":"ready"') { $ready = $line | ConvertFrom-Json }
    }
    # Keep draining: meters are written every frame and a full pipe blocks the engine.
    if (!$pending) { $rest = $process.StandardOutput.ReadToEndAsync() }
    $process.StandardInput.WriteLine('{"id":1,"cmd":"shutdown"}'); $process.StandardInput.Flush()
    $exitedInTime = $process.WaitForExit(15000)
    if (!$exitedInTime) { $process.Kill() }
  } finally { $env:PATH = $saved; Remove-Item Env:GST_PLUGIN_PATH, Env:GST_PLUGIN_SYSTEM_PATH -ErrorAction SilentlyContinue }
  if (!$ready -or $ready.liveReplacementProtocol -ne 1 -or $ready.engineGeneration -notmatch '^[0-9a-f-]{36}$') { throw 'Engine instalado nao anunciou liveReplacementProtocol=1 com geracao' }
  if (!$exitedInTime) { throw 'Engine instalado anunciou o protocolo mas nao encerrou em 15 s apos shutdown' }
  "liveReplacementProtocol=1 engineGeneration=$($ready.engineGeneration); encerrou apos shutdown"
}
Save-Summary
Stop-Transcript | Out-Null
$failed = @($summary.steps.Keys | Where-Object { $summary.steps[$_].result -ne 'PASS' })
Write-Host ""
if ($failed.Count) { Write-Host "r88 gerada COM PENDENCIAS: $($failed -join '; ')" -ForegroundColor Yellow } else { Write-Host 'r88 gerada e verificada nas etapas automaticas.' -ForegroundColor Green }
Write-Host "Resumo: $Output\r88-summary-$stamp.json"
Write-Host "Log:    $log"
