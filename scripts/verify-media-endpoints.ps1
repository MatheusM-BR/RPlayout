param([string]$Base = 'http://127.0.0.1:4000', [string]$Channel = 'test-1')
$ErrorActionPreference = 'Stop'
$checks = @("$Base/api/health", "$Base/api/session", "$Base/$Channel/pgm/", "$Base/$Channel/preview/")
foreach ($url in $checks) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
    Write-Host ("OK {0} {1}" -f $response.StatusCode, $url)
  } catch {
    Write-Warning ("FALHOU {0}: {1}" -f $url, $_.Exception.Message)
  }
}
Write-Host 'A presença de vídeo/áudio deve ser confirmada no navegador e no hardware; este script valida apenas disponibilidade HTTP.'
