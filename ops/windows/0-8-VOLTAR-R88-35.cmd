@echo off
chcp 65001 >nul
set E=D:\IA\Claude\RPlayout\voltar-r88-35.txt
echo %date% %time% inicio > %E%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='D:\RPlayout Atual\'; Set-Content -LiteralPath 'D:\RPlayout Atual.manutencao' -Value 'OPERADOR' -Encoding ASCII; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($p,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { 'parando '+$_.Name+' '+$_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep 4; $n='RPlayout Atual (falhou r88-36 '+(Get-Date -Format HHmmss)+')'; Rename-Item -LiteralPath 'D:\RPlayout Atual' -NewName $n; 'renomeada para '+$n; Rename-Item -LiteralPath 'D:\RPlayout Atual (anterior r88-35)' -NewName 'RPlayout Atual'; 'r88-35 restaurada'; Remove-Item -LiteralPath 'D:\RPlayout Atual.manutencao' -Force" >> %E% 2>&1
echo %date% %time% pastas trocadas >> %E%
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\RPlayout\scripts\ligar-rplayout.ps1" -Root "D:\RPlayout Atual" >> %E% 2>&1
echo %date% %time% ligar chamado >> %E%
exit
