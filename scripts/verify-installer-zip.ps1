param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$EvidenceDirectory,[switch]$InMemory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaRoot=[IO.Path]::GetFullPath($EvidenceDirectory)
$scratchRoot=[IO.Path]::GetFullPath((Join-Path $taskRoot 'scratch')).TrimEnd('\','/')+'\'
if(!$qaRoot.StartsWith($scratchRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $qaRoot)){throw 'Use uma pasta NOVA dentro de scratch.'}
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$payloadPath=Join-Path $qaRoot 'payload.zip'
$outer=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
$payloadMemory=$null
try{
  $payload=$outer.GetEntry('RPlayout-payload.zip')
  if(!$payload){throw 'Payload ausente'}
  if($InMemory){
    [GC]::Collect();$memory=[GC]::GetGCMemoryInfo()
    if($payload.Length -gt [int]::MaxValue -or $memory.TotalAvailableMemoryBytes-$memory.MemoryLoadBytes -lt 3*$payload.Length){throw 'Margem de memoria insuficiente; nada sera extraido.'}
    $payloadMemory=[IO.MemoryStream]::new([int]$payload.Length)
    $source=$payload.Open()
    try{$source.CopyTo($payloadMemory);$payloadMemory.Position=0}catch{$payloadMemory.Dispose();throw}finally{$source.Dispose()}
  }else{[IO.Compression.ZipFileExtensions]::ExtractToFile($payload,$payloadPath,$false)}
}finally{$outer.Dispose()}
$zip=if($InMemory){[IO.Compression.ZipArchive]::new($payloadMemory,[IO.Compression.ZipArchiveMode]::Read,$false)}else{[IO.Compression.ZipFile]::OpenRead($payloadPath)}
try{
  $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $zip.Entries){
    $name=$entry.FullName.Replace('\','/')
    if($name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') | Where-Object {$_ -eq '..'}) -or !$names.Add($name)){throw "Catalogo inseguro/duplicado: $name"}
  }
  $manifestEntry=$zip.GetEntry('package-manifest.json')
  if(!$manifestEntry){throw 'Manifesto ausente'}
  $reader=[IO.StreamReader]::new($manifestEntry.Open())
  try{$manifest=$reader.ReadToEnd() | ConvertFrom-Json}finally{$reader.Dispose()}
  $verified=0
  foreach($file in $manifest.files){
    $entry=$zip.GetEntry($file.file.Replace('\','/'))
    if(!$entry -or $entry.Length -ne $file.bytes){throw "Arquivo ausente/tamanho divergente: $($file.file)"}
    $stream=$entry.Open();$hasher=[Security.Cryptography.SHA256]::Create()
    try{$digest=[BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','')}finally{$stream.Dispose();$hasher.Dispose()}
    if($digest -ne $file.sha256){throw "Hash divergente: $($file.file)"}
    $verified++
  }
  $result=[ordered]@{result='PASS';archive=[IO.Path]::GetFullPath($Archive);archiveSha256=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash;entries=$zip.Entries.Count;verifiedManifestFiles=$verified;engine=($manifest.files | Where-Object {$_.file -eq 'rplayout-engine.exe'});installationValidated=$false;startupValidated=$false;scope='ZIP catalog and all manifest hashes, without full extraction or runtime launch'}
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $qaRoot 'result.json') -Encoding UTF8
  $result | ConvertTo-Json -Depth 5
}finally{$zip.Dispose()}
