param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$Workspace,
  [ValidateSet('STAGE','ACTIVATE','RECONCILE')][string]$Mode='STAGE',
  [switch]$AdoptProfile,
  [string]$AdoptionId='',
  [switch]$RecoverMaintenance,
  [switch]$Rollback
)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
# QA only: run the REAL packaged interactive tool, with a fixed test decision,
# inside our own unnamed Windows job. The parent stops only its ChildProcess
# handle; closing this process then closes the job, never taskkill by stale PID.
$qaPrefix='D:\RPlayout-builds\qa\'
foreach($path in @($InstallRoot,$Workspace)){
  if(![IO.Path]::GetFullPath($path).StartsWith($qaPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Somente instalacao/dados QA no D:.'}
}
. (Join-Path $PSScriptRoot 'lib/qa-windows-job.ps1')
function global:Read-Host {
  param([string]$Prompt)
  if($Mode -eq 'RECONCILE'){
    $expected=if($RecoverMaintenance){'LIBERAR RESERVA E RECONCILIAR'}else{'RECONCILIAR'}
    if($Prompt -cne "Digite $expected para conferir e registrar esse resultado"){throw 'Prompt de reconciliacao inesperado.'}
    return $expected
  }
  if($Prompt -notlike 'Digite * para autorizar*'){throw 'Prompt inesperado; QA nao presume outra escolha.'}
  if($Mode -ne 'ACTIVATE'){throw 'STAGE nao deve pedir confirmacao de ativacao.'}
  if($AdoptProfile){return 'ATIVAR E ADOTAR'}
  return 'ATIVAR'
}
if($Mode -eq 'RECONCILE'){
  if(!$AdoptionId -or $AdoptProfile){throw 'Reconciliacao QA exige ID exato, sem nova adocao.'}
  & (Join-Path $InstallRoot 'reconcile-rplayout-upgrade-profile.ps1') -Workspace $Workspace -AdoptionId $AdoptionId -RecoverMaintenance:$RecoverMaintenance
}else{
  $startTool=if($Rollback){'start-rplayout-rollback.ps1'}else{'start-rplayout-upgrade.ps1'}
  & (Join-Path $InstallRoot $startTool) -Workspace $Workspace -Mode $Mode -AdoptProfile:$AdoptProfile
}
exit $LASTEXITCODE
