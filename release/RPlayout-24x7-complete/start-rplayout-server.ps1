param([switch]$OpenOperator)
$exe = Join-Path $PSScriptRoot '..\rplayout-test.exe'
if (-not (Test-Path $exe)) { throw "rplayout-test.exe não encontrado em $exe" }
if ($OpenOperator) { & $exe } else { & $exe --server-only }
