param([string]$Destination = "release/RPlayout-1.1")
$ErrorActionPreference = 'Stop'
if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
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
foreach ($aux in @('rplayout-probe.exe','rplayout-devices.exe','rplayout-relay.exe','rplayout-avsync.exe')) {
  if (Test-Path "apps/engine/target/release/$aux") { Copy-Item "apps/engine/target/release/$aux" "$Destination/apps/engine/target/release/$aux" -Force }
}
Copy-Item package.json,pnpm-lock.yaml,pnpm-workspace.yaml,tsconfig.base.json "$Destination/" -Force
New-Item -ItemType Directory -Force -Path "$Destination/runtime/node", "$Destination/runtime/pnpm" | Out-Null
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) { Copy-Item $node "$Destination/runtime/node/node.exe" -Force }
$pnpm = Join-Path (Split-Path (Get-Command pnpm.cmd -ErrorAction Stop).Source) 'node_modules/pnpm/pnpm.exe'
if (Test-Path $pnpm) { Copy-Item $pnpm "$Destination/runtime/pnpm/pnpm.exe" -Force }
New-Item -ItemType Directory -Force -Path "$Destination/apps/web/dist", "$Destination/apps/web" | Out-Null
Copy-Item apps/web/package.json "$Destination/apps/web/" -Force
Copy-Item -Recurse -Force apps/web/dist/* "$Destination/apps/web/dist/"
New-Item -ItemType Directory -Force -Path "$Destination/apps/server/src" | Out-Null
Copy-Item apps/server/package.json,apps/server/tsconfig.json "$Destination/apps/server/" -Force
Copy-Item -Recurse -Force apps/server/src/* "$Destination/apps/server/src/"
New-Item -ItemType Directory -Force -Path "$Destination/packages/protocol/src", "$Destination/packages/scheduler/src" | Out-Null
Copy-Item packages/protocol/package.json,packages/protocol/tsconfig.json "$Destination/packages/protocol/" -Force
Copy-Item -Recurse -Force packages/protocol/src/* "$Destination/packages/protocol/src/"
Copy-Item packages/scheduler/package.json,packages/scheduler/tsconfig.json "$Destination/packages/scheduler/" -Force
Copy-Item -Recurse -Force packages/scheduler/src/* "$Destination/packages/scheduler/src/"
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
  Write-Warning 'NDI Runtime (Processing.NDI.Lib.x64.dll) não encontrado: descoberta e ingest NDI não estarão disponíveis neste pacote.'
}
Push-Location $Destination
try {
  $env:CI = "true"
  & (Get-Command pnpm.cmd -ErrorAction Stop).Source install
} finally {
  Pop-Location
}
if ($env:GSTREAMER_1_0_ROOT_MSVC_X86_64 -and (Test-Path $env:GSTREAMER_1_0_ROOT_MSVC_X86_64)) {
  New-Item -ItemType Directory -Force -Path "$Destination/runtime" | Out-Null
  Copy-Item -Recurse -Force $env:GSTREAMER_1_0_ROOT_MSVC_X86_64 "$Destination/runtime/gstreamer"
  Write-Host "GStreamer portátil incluído em runtime/gstreamer"
} else {
  Write-Warning 'GStreamer não foi incluído. Defina GSTREAMER_1_0_ROOT_MSVC_X86_64 antes de empacotar.'
}
Copy-Item docs/RPLAYOUT-1.1-FUNCIONALIDADES.md "$Destination/" -Force
Copy-Item scripts/verify-rplayout-package.ps1 "$Destination/" -Force
Copy-Item scripts/verify-media-endpoints.ps1 "$Destination/" -Force
Copy-Item scripts/start-rplayout-server.ps1, scripts/open-rplayout-workspace.ps1 "$Destination/" -Force
Write-Host "Pacote de teste preparado em $Destination"
