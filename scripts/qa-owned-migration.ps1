param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Database,[Parameter(Mandatory=$true)][string]$Manifest,[Parameter(Mandatory=$true)][string]$VaultFile)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
foreach($path in @($InstallRoot,$Database,$Manifest,$VaultFile)){
  if(![IO.Path]::GetFullPath($path).StartsWith('D:\RPlayout-builds\qa\',[StringComparison]::OrdinalIgnoreCase)){throw 'Somente instalacao e copias QA no D:.'}
}
. (Join-Path $PSScriptRoot 'lib/qa-windows-job.ps1')
& (Join-Path $InstallRoot 'runtime/node/node.exe') (Join-Path $InstallRoot 'apps/server/dist/migrate-restored.cjs') --database $Database --manifest $Manifest --vault-file $VaultFile
exit $LASTEXITCODE
