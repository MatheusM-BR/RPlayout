param([string]$Destination = "release/RPlayout-1.1")
$ErrorActionPreference = 'Stop'
if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
if (!(Test-Path "apps/engine/target/release/rplayout.exe")) { throw 'Engine release não compilado.' }
Copy-Item apps/engine/target/release/rplayout.exe "$Destination/rplayout-test.exe" -Force
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/rplayout-engine.exe" -Force
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/rplayout-engine-test.exe" -Force
New-Item -ItemType Directory -Force -Path "$Destination/apps/engine/target/release" | Out-Null
Copy-Item apps/engine/target/release/rplayout-engine.exe "$Destination/apps/engine/target/release/rplayout-engine.exe" -Force
foreach ($aux in @('rplayout-probe.exe','rplayout-devices.exe','rplayout-relay.exe','rplayout-avsync.exe')) {
  if (Test-Path "apps/engine/target/release/$aux") { Copy-Item "apps/engine/target/release/$aux" "$Destination/apps/engine/target/release/$aux" -Force }
}
Copy-Item package.json,pnpm-lock.yaml "$Destination/" -Force
New-Item -ItemType Directory -Force -Path "$Destination/apps/web/dist" | Out-Null
Copy-Item -Recurse -Force apps/web/dist/* "$Destination/apps/web/dist/"
New-Item -ItemType Directory -Force -Path "$Destination/apps/server/src" | Out-Null
Copy-Item -Recurse -Force apps/server/src/* "$Destination/apps/server/src/"
Copy-Item -Recurse -Force packages/protocol/src,packages/scheduler/src "$Destination/packages/"
Copy-Item -Recurse -Force mediamtx "$Destination/"
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
