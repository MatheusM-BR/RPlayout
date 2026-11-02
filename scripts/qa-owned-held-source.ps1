param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
if(![IO.Path]::GetFullPath($InstallRoot).StartsWith('D:\RPlayout-builds\qa\',[StringComparison]::OrdinalIgnoreCase)){throw 'Somente runtime QA no D:.'}
. (Join-Path $PSScriptRoot 'lib/qa-windows-job.ps1')
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$loaderUri=([uri](Join-Path $workspace 'apps/server/node_modules/tsx/dist/loader.mjs')).AbsoluteUri
& (Join-Path $InstallRoot 'runtime/node/node.exe') --import $loaderUri (Join-Path $PSScriptRoot 'verify-held-runtime.mts') --capture-held-backup --capture-next-item "--installed-runtime=$InstallRoot" '--qa-root=D:\RPlayout-builds\qa'
exit $LASTEXITCODE
