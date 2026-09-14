param([string]$Package = "release/RPlayout-1.1-next")
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $Package).Path
$required = @(
  'rplayout-test.exe',
  'rplayout-engine-test.exe',
  'apps/web/dist/index.html',
  'apps/server/src/index.ts',
  'apps/server/src/routes.ts',
  'apps/engine/target/release/rplayout-engine.exe',
  'apps/engine/target/release/rplayout-probe.exe',
  'apps/engine/target/release/rplayout-devices.exe',
  'apps/engine/target/release/rplayout-relay.exe',
  'mediamtx/mediamtx.exe',
  'RPLAYOUT-1.1-FUNCIONALIDADES.md'
)
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $root $_)) })
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
if ((Test-Path (Join-Path $root 'runtime/node/node.exe')) -and (Test-Path (Join-Path $root 'runtime/pnpm/pnpm.exe')) -and (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Node/pnpm portátil: OK' -ForegroundColor Green
} else {
  Write-Warning 'Node/pnpm portátil ausente: o launcher dependerá do ambiente global.'
}
$files = $required | ForEach-Object {
  $path = Join-Path $root $_
  $hash = (Get-FileHash $path -Algorithm SHA256).Hash
  [pscustomobject]@{ File = $_; Bytes = (Get-Item $path).Length; SHA256 = $hash }
}
Write-Host "Pacote válido: $root"
$files | Format-Table -AutoSize
