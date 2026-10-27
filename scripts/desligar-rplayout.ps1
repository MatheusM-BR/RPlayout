# Parada pedida pelo operador: marca para o vigia NAO religar e encerra o
# servidor. Para voltar ao ar: ligar-rplayout.ps1 (remove a marca e liga).
param([string]$Root='D:\RPlayout Atual')
$marker=$Root.TrimEnd('\')+'.manutencao'
Set-Content -LiteralPath $marker -Value 'OPERADOR' -Encoding ASCII
$prefix=$Root.TrimEnd('\')+'\'
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -and $_.Name -imatch '^RPlayout-' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"RPlayout parado pelo operador; o vigia nao vai religar."
