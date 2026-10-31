param([Parameter(Mandatory=$true)][string]$LegacyRoot,[Parameter(Mandatory=$true)][string]$QaDirectory)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
if([IO.Path]::GetFullPath($LegacyRoot) -ne 'C:\IA\RPlayout\release\runtime-base-r30'){throw 'Somente artefato historico r30 explicitamente escolhido.'}
if(![IO.Path]::GetFullPath($QaDirectory).StartsWith('D:\RPlayout-builds\qa\',[StringComparison]::OrdinalIgnoreCase)){throw 'Dados somente na raiz QA do D:.'}
. (Join-Path $PSScriptRoot 'lib/qa-windows-job.ps1')
& (Join-Path $LegacyRoot 'runtime/node/node.exe') (Join-Path $LegacyRoot 'apps/server/dist/server.cjs')
exit $LASTEXITCODE
