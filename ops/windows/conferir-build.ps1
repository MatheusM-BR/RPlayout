# Sai com 0 só se o resumo mais novo do build tiver todas as etapas PASS.
param([Parameter(Mandatory)][string]$Edition)
$s = Get-ChildItem 'D:\RPlayout-builds\r88-summary-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$s) { 'sem resumo'; exit 2 }
$j = Get-Content $s.FullName -Raw | ConvertFrom-Json
if ($j.edition -ne $Edition) { "resumo de outra edicao: $($j.edition)"; exit 3 }
$bad = @($j.steps.PSObject.Properties | Where-Object { $_.Value.result -ne 'PASS' } | ForEach-Object { "$($_.Name)=$($_.Value.result)" })
$n = @($j.steps.PSObject.Properties).Count
if ($n -lt 13 -or $bad.Count) { "etapas: $n; falhas: $($bad -join ', ')"; exit 1 }
"13 etapas PASS ($($s.Name))"; exit 0
