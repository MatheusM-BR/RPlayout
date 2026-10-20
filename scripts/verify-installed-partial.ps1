param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$ShortcutDirectory,
  [string]$ExternalQaRoot=''
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scratch=[IO.Path]::GetFullPath((Join-Path $workspace 'scratch')).TrimEnd('\','/')+'\'
$archivePath=[IO.Path]::GetFullPath($Archive)
$allowedRoot=$scratch
if($ExternalQaRoot){
  $explicitRoot=[IO.Path]::GetFullPath($ExternalQaRoot).TrimEnd('\','/')
  $expectedRoot=Join-Path ([IO.Path]::GetDirectoryName($archivePath)) 'qa'
  if($explicitRoot -ne $expectedRoot){throw 'QA externo deve ser a subpasta qa ao lado do ZIP escolhido.'}
  for($ancestor=$explicitRoot;$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){
    if((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'QA externo nao pode atravessar junction/symlink.'}
  }
  $allowedRoot=$explicitRoot+'\'
}
$qa=[IO.Path]::GetFullPath($EvidenceDirectory)
$installed=[IO.Path]::GetFullPath($Destination)
$shortcuts=[IO.Path]::GetFullPath($ShortcutDirectory)
foreach($target in @($qa,$installed,$shortcuts)){
  if(!$target.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $target)){throw 'Use somente pastas NOVAS dentro da raiz QA permitida. Nada existente sera substituido.'}
}
if(@($qa,$installed,$shortcuts|Select-Object -Unique).Count -ne 3){throw 'Escolha tres destinos distintos.'}
foreach($target in @($qa,$installed,$shortcuts)){foreach($other in @($qa,$installed,$shortcuts)){if($target -ne $other -and $target.StartsWith($other.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Destinos QA devem ser separados, nao aninhados.'}}}
if($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $ExpectedSha256){throw 'Arquivo nao corresponde ao ZIP explicitamente escolhido.'}
$outer=[IO.Compression.ZipFile]::OpenRead($archivePath)
$memory=$null;$inner=$null
try{
  $expected=@('installation-edition.json','INSTALAR.cmd','INSTALAR.ps1','LEIA-ME.md','RPlayout-payload.zip')
  if($outer.Entries.Count -ne $expected.Count){throw 'Catalogo externo inesperado.'}
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$outerBytes=0
  foreach($entry in $outer.Entries){if(!$expected.Contains($entry.FullName) -or !$seen.Add($entry.FullName)){throw 'Entrada externa inesperada/duplicada.'};$outerBytes+=$entry.Length}
  $payload=$outer.GetEntry('RPlayout-payload.zip')
  [GC]::Collect();$metric=[GC]::GetGCMemoryInfo()
  if($payload.Length -gt [int]::MaxValue -or $metric.TotalAvailableMemoryBytes-$metric.MemoryLoadBytes -lt 3*$payload.Length){throw 'Margem de memoria insuficiente; nada criado.'}
  $memory=[IO.MemoryStream]::new([int]$payload.Length)
  $input=$payload.Open();try{$input.CopyTo($memory)}finally{$input.Dispose()}
  $memory.Position=0;$inner=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
  [long]$expanded=0;foreach($entry in $inner.Entries){$expanded+=$entry.Length}
  if($expanded -lt 1 -or $expanded -gt 100GB -or $inner.Entries.Count -gt 100000){throw 'Estimativa invalida; nada criado.'}
  # Same conservative installer estimate, PLUS outer payload and own QA margin.
  [long]$installEstimate=$expanded+([long]$inner.Entries.Count*64KB)+256MB
  [long]$required=$outerBytes+$installEstimate+128MB
  $volume=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($installed))
  if(!$volume.IsReady -or $volume.AvailableFreeSpace -lt $required){throw 'Espaco insuficiente para bundle, instalacao e evidencia; nada criado.'}
  $preflight=[ordered]@{archiveSha256=$ExpectedSha256;outerBytes=$outerBytes;expandedBytes=$expanded;installEstimate=$installEstimate;combinedRequiredBytes=$required;availableBefore=$volume.AvailableFreeSpace}
  $inner.Dispose();$inner=$null;$memory.Dispose();$memory=$null
  Write-Host 'Capacidade para bundle + instalacao + margem QA confirmada. Extraindo somente o instalador escolhido.'
  New-Item -ItemType Directory -Path $qa | Out-Null
  $bundle=Join-Path $qa 'bundle';New-Item -ItemType Directory -Path $bundle | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToDirectory($outer,$bundle)
}finally{if($inner){$inner.Dispose()};if($memory){$memory.Dispose()};$outer.Dispose()}
$installer=Join-Path $bundle 'INSTALAR.ps1'
& $installer -Payload (Join-Path $bundle 'RPlayout-payload.zip') -Destination $installed -ShortcutDirectory $shortcuts
if(!(Test-Path -LiteralPath (Join-Path $installed 'installation-receipt.json'))){throw 'Instalador sem recibo.'}
$receipt=Get-Content -LiteralPath (Join-Path $installed 'installation-receipt.json') -Raw | ConvertFrom-Json
$profile=Get-Content -LiteralPath (Join-Path $installed 'installation-profile.json') -Raw | ConvertFrom-Json
if($receipt.integrity -ne 'VERIFIED' -or !$receipt.spaceCheckedBeforeExtraction -or $receipt.previousInstallationModified -or $receipt.serverStarted){throw 'Recibo nao confirma instalacao isolada/integra.'}
if($profile.dataRoot -ne (Join-Path $installed 'data') -or $profile.mediaRoot -ne (Join-Path $installed 'midia')){throw 'Perfil nao esta isolado na nova instalacao.'}
$shell=New-Object -ComObject WScript.Shell
$links=@()
foreach($name in @('Server','Master','Schedule','QC','Monitor','Aired','Users')){
  $path=Join-Path $shortcuts "RPlayout $name.lnk"
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'Atalho ausente.'}
  $link=$shell.CreateShortcut($path)
  if($link.TargetPath -ne (Join-Path $installed "RPlayout-$name.exe") -or $link.WorkingDirectory -ne $installed){throw 'Atalho aponta para outra instalacao.'}
  $links+=$name
}
$result=[ordered]@{result='PASS';scope='Actual embedded installer, materialized manifest hashes, isolated data profile and seven shortcut targets; no startup/media/clean-Windows qualification';archive=$archivePath;archiveSha256=$ExpectedSha256;destination=$installed;shortcuts=$shortcuts;preflight=$preflight;receiptIntegrity=$receipt.integrity;spaceCheckedBeforeExtraction=$receipt.spaceCheckedBeforeExtraction;estimatedRequiredBytes=$receipt.estimatedRequiredBytes;shortcutTargetsVerified=$links;previousInstallationModified=$false;serverStarted=$false;startupValidated=$false;cleanWindowsValidated=$false;physicalSignalValidated=$false}
[IO.File]::WriteAllText((Join-Path $qa 'result.json'),($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$result|ConvertTo-Json -Depth 6
