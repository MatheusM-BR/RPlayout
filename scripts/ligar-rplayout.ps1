# Volta ao ar depois de desligar-rplayout.ps1: remove a marca do operador e
# liga o servidor se ele nao estiver rodando.
param([string]$Root='D:\RPlayout Atual')
$marker=$Root.TrimEnd('\')+'.manutencao'
if(Test-Path -LiteralPath $marker){ Remove-Item -LiteralPath $marker -Force }
$prefix=$Root.TrimEnd('\')+'\'
$running=@(Get-CimInstance Win32_Process -Filter "Name='RPlayout-Server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })
if($running.Count){ "RPlayout ja esta rodando."; exit 0 }
Start-Process -FilePath (Join-Path $Root 'RPlayout-Server.exe') -WorkingDirectory $Root -WindowStyle Minimized
"RPlayout ligado."
