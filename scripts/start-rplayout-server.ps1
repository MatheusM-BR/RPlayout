param([switch]$OpenOperator)
$exe = Join-Path $PSScriptRoot 'RPlayout-Server.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "RPlayout-Server.exe não encontrado em $exe" }
if ($OpenOperator) {
  $master = Join-Path $PSScriptRoot 'RPlayout-Master.exe'
  if (-not (Test-Path -LiteralPath $master -PathType Leaf)) { throw "RPlayout-Master.exe não encontrado em $master" }
  & $master
} else { & $exe --server-only }
