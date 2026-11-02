@echo off
title Instalador RPlayout parcial r24
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR.ps1"
if errorlevel 1 echo Instalacao nao concluida. Veja a mensagem acima.
pause
