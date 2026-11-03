# Pede o backup de atualizacao a versao em uso e, pronto, atualiza na pasta fixa
# com o script oficial do repositorio (scripts\atualizar-rplayout-no-lugar.ps1).
# Recriado em 30/10 apos a perda da pasta D:\IA\Claude\RPlayout.
param([Parameter(Mandatory)][string]$Tag,[Parameter(Mandatory)][string]$OldData,[string]$DataRoot='',
  [string]$JanelaInicio='02:00',[string]$JanelaFim='05:00')
$log="D:\IA\Claude\RPlayout\backup-$Tag$(if($DataRoot){'-b'}).txt"
try{
  $req=[guid]::NewGuid().ToString()
  $r=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4000/api/backups/upgrade' -ContentType 'application/json' -Body (@{requestId=$req}|ConvertTo-Json)
  "pedido $req fase $($r.phase)" | Set-Content $log
  $deadline=(Get-Date).AddMinutes(10)
  do{ Start-Sleep 3; $s=Invoke-RestMethod "http://127.0.0.1:4000/api/backups/upgrade/$req" }while($s.phase -eq 'CHECKING' -and (Get-Date) -lt $deadline)
  "fase final $($s.phase) $($s.file)" | Add-Content $log
  if($s.phase -ne 'READY'){ throw "backup nao ficou pronto: $($s.phase) $($s.reason)" }
}catch{
  $detalhe=$_.ErrorDetails.Message
  "ERRO: $($_.Exception.Message) $detalhe" | Add-Content $log; exit 1
}
& 'D:\RPlayout\scripts\atualizar-rplayout-no-lugar.ps1' -Tag $Tag -OldRoot 'D:\RPlayout Atual' -OldData $OldData -MaxBackupAgeMinutes 30 -DataRoot $DataRoot -JanelaInicio $JanelaInicio -JanelaFim $JanelaFim
