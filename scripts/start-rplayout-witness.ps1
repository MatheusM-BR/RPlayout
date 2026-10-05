param()
$ErrorActionPreference = 'Stop'
# This helper lives at the root of the portable distribution. HA is optional:
# the witness is a separate service on a third host, not started by Master/QC.
$portableRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$portableNode = Join-Path $portableRoot 'runtime/node/node.exe'
$entry = Join-Path $portableRoot 'apps/server/dist/ha-witness.cjs'
if (!(Test-Path -LiteralPath $portableNode -PathType Leaf) -or !(Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw 'Testemunha portátil incompleta. Use este script na raiz do pacote verificado; Node global não será utilizado.'
}
if (!$env:RPLAYOUT_WITNESS_DB -or !$env:RPLAYOUT_WITNESS_CLUSTER -or !$env:RPLAYOUT_WITNESS_NODES -or $env:RPLAYOUT_WITNESS_KEY -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'Configure banco exclusivo, cluster, dois nós e chave de 32 bytes da testemunha. Não use banco operacional nem chave de pareamento/cofre.'
}
# Keep mutable authority state outside the immutable package. No defaults to
# the operator's main database, no generated/replaced key, no hidden takeover.
$authorityDb = [System.IO.Path]::GetFullPath($env:RPLAYOUT_WITNESS_DB)
if ($authorityDb -eq $portableRoot -or $authorityDb.StartsWith($portableRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Banco da testemunha deve ficar em uma pasta de dados fora do pacote.'
}
$savedWitnessDb = $env:RPLAYOUT_WITNESS_DB
try {
  $env:RPLAYOUT_WITNESS_DB = $authorityDb
  # Key travels only in the service environment, never argv or console output.
  # Running in this terminal is intentional; no other app/window is launched.
  & $portableNode $entry
  if ($LASTEXITCODE -ne 0) { throw 'Testemunha não iniciou ou encerrou com erro. Nenhuma saída PGM foi aberta.' }
} finally {
  [Environment]::SetEnvironmentVariable('RPLAYOUT_WITNESS_DB', $savedWitnessDb, 'Process')
}
