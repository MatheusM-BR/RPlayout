@echo off
chcp 65001 >nul
"D:\RPlayout Atual\runtime\node\node.exe" D:\IA\Claude\RPlayout\capturar-telas.mjs > D:\IA\Claude\RPlayout\capturar.out.txt 2>&1
powershell -NoProfile -Command "Compress-Archive -Path D:\IA\Claude\RPlayout\telas\quadros\* -DestinationPath D:\IA\Claude\RPlayout\telas\quadros.zip -Force"
echo fim >> D:\IA\Claude\RPlayout\capturar.out.txt
exit
