# Cria (ou remove) a tarefa agendada que mantem o vigia do RPlayout rodando
# a partir do logon deste usuario. Nao precisa de administrador e nao mexe em
# Firewall/UAC. Rodar uma vez, pelo proprio operador:
#   powershell -ExecutionPolicy Bypass -File instalar-vigia-rplayout.ps1
#   powershell -ExecutionPolicy Bypass -File instalar-vigia-rplayout.ps1 -Remover
param(
  [string]$Root='D:\RPlayout Atual',
  [string]$Name='RPlayout - vigia',
  [switch]$Remover
)
$ErrorActionPreference='Stop'
if($Remover){ Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue; "Tarefa '$Name' removida."; exit 0 }
$script=Join-Path $PSScriptRoot 'vigiar-rplayout.ps1'
if(!(Test-Path $script)){ throw "vigiar-rplayout.ps1 nao encontrado ao lado deste script" }
# Copia fora da pasta da versao: a atualizacao troca D:\RPlayout Atual inteira.
$home2=Join-Path $env:LOCALAPPDATA 'RPlayout\vigia'; New-Item -ItemType Directory -Force -Path $home2 | Out-Null
Copy-Item $script (Join-Path $home2 'vigiar-rplayout.ps1') -Force
$args2="-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$home2\vigiar-rplayout.ps1`" -Root `"$Root`""
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args2
$trigger=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Description 'Religa o RPlayout se o servidor parar.' -Force | Out-Null
Start-ScheduledTask -TaskName $Name
"Tarefa '$Name' criada e iniciada. Registro: $home2\vigia.log"
