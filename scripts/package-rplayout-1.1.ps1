param([string]$Destination = "release/RPlayout-1.1")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item rplayout-test.exe "$Destination/rplayout-test.exe" -Force
Copy-Item rplayout-engine-test.exe "$Destination/rplayout-engine-test.exe" -Force
New-Item -ItemType Directory -Force -Path "$Destination/apps/engine/target/release" | Out-Null
Copy-Item rplayout-engine-test.exe "$Destination/apps/engine/target/release/rplayout-engine.exe" -Force
Copy-Item package.json,pnpm-lock.yaml "$Destination/" -Force
New-Item -ItemType Directory -Force -Path "$Destination/apps/web/dist" | Out-Null
Copy-Item -Recurse -Force apps/web/dist/* "$Destination/apps/web/dist/"
New-Item -ItemType Directory -Force -Path "$Destination/apps/server/src" | Out-Null
Copy-Item -Recurse -Force apps/server/src/* "$Destination/apps/server/src/"
Copy-Item -Recurse -Force packages/protocol/src,packages/scheduler/src "$Destination/packages/"
Copy-Item -Recurse -Force mediamtx "$Destination/"
Copy-Item docs/RPLAYOUT-1.1-FUNCIONALIDADES.md "$Destination/" -Force
Copy-Item scripts/verify-rplayout-package.ps1 "$Destination/" -Force
Copy-Item scripts/verify-media-endpoints.ps1 "$Destination/" -Force
Copy-Item scripts/start-rplayout-server.ps1, scripts/open-rplayout-workspace.ps1 "$Destination/" -Force
Write-Host "Pacote de teste preparado em $Destination"
