@echo off
chcp 65001 >nul
cd /d D:\RPlayout
set E=D:\IA\Claude\RPlayout\r88-36b-etapas.txt
set ED=RPlayout-1.1-parcial-20261020-r88-36b
echo %date% %time% inicio > %E%
git -c user.name=Claude -c user.email=noreply@anthropic.com -c core.autocrlf=true -c gc.auto=0 am --keep-cr D:\IA\Claude\RPlayout\r88-36b.patch >> %E% 2>&1
if errorlevel 1 (echo %date% %time% PATCH FALHOU >> %E% & git am --abort & exit)
for /f %%t in ('git log -1 --format^=%%T') do set TREE=%%t
echo arvore %TREE% >> %E%
if not "%TREE%"=="870464d6367c8c415ffdad276ebdca1d2a485619" (echo %date% %time% ARVORE DIFERENTE - parando >> %E% & exit)
echo %date% %time% patch ok >> %E%
powershell -NoProfile -ExecutionPolicy Bypass -File D:\RPlayout\scripts\build-r88.ps1 -Edition %ED% > D:\IA\Claude\RPlayout\build-r88-36b.log 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File D:\IA\Claude\RPlayout\conferir-build.ps1 -Edition %ED% >> %E% 2>&1
if errorlevel 1 (echo %date% %time% BUILD INCOMPLETO - nada foi instalado >> %E% & exit)
echo %date% %time% build ok >> %E%
powershell -NoProfile -ExecutionPolicy Bypass -File D:\IA\Claude\RPlayout\5-FIREWALL-ANTES.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:\IA\Claude\RPlayout\backup-e-atualizar4.ps1 -Tag r88-36b -OldData "D:\RPlayout dados r88-35" -JanelaInicio 00:00 -JanelaFim 23:59 >> %E% 2>&1
echo %date% %time% atualizacao terminou >> %E%
powershell -NoProfile -ExecutionPolicy Bypass -File D:\IA\Claude\RPlayout\5-FIREWALL-DEPOIS.ps1
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File D:\IA\Claude\RPlayout\soak2.ps1 -Hours 24 -EverySeconds 60 -Root "D:\RPlayout Atual" -Tag r88-36b
exit
