param([Parameter(Mandatory=$true)][string]$ServerBuildDirectory)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverRoot=[IO.Path]::GetFullPath($ServerBuildDirectory)
if(!$serverRoot.StartsWith((Join-Path $workspace 'scratch\host-history-r88-'),[StringComparison]::OrdinalIgnoreCase)){throw 'Somente compilacao QA isolada no workspace.'}
if(!(Test-Path -LiteralPath (Join-Path $serverRoot 'server.cjs') -PathType Leaf)){throw 'Servidor compilado QA ausente.'}
# Own process and every future descendant only. No historical PID termination.
. (Join-Path $PSScriptRoot 'lib/qa-windows-job.ps1')
$loaderUri=([uri](Join-Path $workspace 'apps/server/node_modules/tsx/dist/loader.mjs')).AbsoluteUri
& (Join-Path $workspace 'scratch/r78-installed-qa-20261016/runtime/node/node.exe') --import $loaderUri (Join-Path $PSScriptRoot 'verify-host-history-pagination.mts') (Join-Path $serverRoot 'server.cjs')
exit $LASTEXITCODE
