param([string]$Archive='release/RPlayout-1.1-parcial-20261009-r30-instalador.zip',[string]$Destination='release/runtime-base-r30')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskArchive=[IO.Path]::GetFullPath((Join-Path $taskRoot $Archive))
$taskDestination=[IO.Path]::GetFullPath((Join-Path $taskRoot $Destination))
if(!$taskDestination.StartsWith((Join-Path $taskRoot 'release')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Destino deve estar dentro de release.'}
if(Test-Path -LiteralPath $taskDestination){throw 'Destino existente; nada sera sobrescrito.'}
if((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne '694967BEDAB1FE0E3F002217A5C72803A3FA248379ACCCA8A19EB3069EEB53AF'){throw 'Base r30 nao corresponde ao arquivo entregue.'}
Add-Type -AssemblyName System.IO.Compression
New-Item -ItemType Directory -Path $taskDestination | Out-Null
$outer=[IO.Compression.ZipFile]::OpenRead($taskArchive)
try{
  $entry=$outer.GetEntry('RPlayout-payload.zip');if(!$entry){throw 'Payload ausente.'}
  $payloadPath=Join-Path $taskDestination 'runtime-payload.zip'
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$payloadPath,$false)
  [IO.Compression.ZipFile]::ExtractToDirectory($payloadPath,$taskDestination)
}finally{$outer.Dispose()}
Get-Item -LiteralPath (Join-Path $taskDestination 'package-manifest.json') | Select-Object FullName,Length
