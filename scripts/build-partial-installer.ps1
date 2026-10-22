param(
  [string]$Package = 'release/RPlayout-1.1-parcial-20261008-r24',
  [string]$Destination = 'release/RPlayout-1.1-parcial-20261008-r24-instalador',
  [string]$Readme = 'docs/BUILD-PARCIAL-R24.md'
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Package = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $Package))
$Destination = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $Destination))
$releaseRoot = (Join-Path $workspaceRoot 'release') + [System.IO.Path]::DirectorySeparatorChar
if (!$Destination.StartsWith($releaseRoot,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Destino do instalador deve estar em release.' }
if ((Test-Path -LiteralPath $Destination) -or (Test-Path -LiteralPath ($Destination + '.zip'))) { throw 'Destino existente; nenhum instalador anterior sera sobrescrito.' }
if (!(Test-Path -LiteralPath (Join-Path $Package 'package-manifest.json'))) { throw 'Pacote incompleto; gere o pacote primeiro.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
$edition = Split-Path -Leaf $Package
[System.IO.File]::WriteAllText((Join-Path $Destination 'installation-edition.json'),(@{edition=$edition} | ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-rplayout-partial.ps1') -Destination (Join-Path $Destination 'INSTALAR.ps1')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-rplayout-partial.cmd') -Destination (Join-Path $Destination 'INSTALAR.cmd')
Copy-Item -LiteralPath (Join-Path $workspaceRoot $Readme) -Destination (Join-Path $Destination 'LEIA-ME.md')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($Package,(Join-Path $Destination 'RPlayout-payload.zip'),[System.IO.Compression.CompressionLevel]::Fastest,$false)
# Payload already compressed: do not spend another compression pass on it.
[System.IO.Compression.ZipFile]::CreateFromDirectory($Destination,($Destination + '.zip'),[System.IO.Compression.CompressionLevel]::NoCompression,$false)
Write-Host "Instalador ZIP gerado SEM testes funcionais: $Destination.zip"
Write-Host 'Extraia todo o ZIP e execute INSTALAR.cmd. Nao e um Setup.exe assinado.'
