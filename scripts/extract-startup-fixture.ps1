param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$scratch=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scratch')).TrimEnd('\','/')+'\'
$target=[IO.Path]::GetFullPath($Destination)
if(!$target.StartsWith($scratch,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $target)){throw 'Use pasta NOVA dentro de scratch.'}
$outer=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
$memory=$null;$zip=$null
try{
 $payload=$outer.GetEntry('RPlayout-payload.zip');if(!$payload){throw 'Payload ausente'}
 [GC]::Collect();$metric=[GC]::GetGCMemoryInfo()
 if($payload.Length -gt [int]::MaxValue -or $metric.TotalAvailableMemoryBytes-$metric.MemoryLoadBytes -lt 3*$payload.Length){throw 'Margem de memoria insuficiente'}
 $memory=[IO.MemoryStream]::new([int]$payload.Length);$input=$payload.Open()
 try{$input.CopyTo($memory)}finally{$input.Dispose()}
 $memory.Position=0;$zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$false)
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($entry in $zip.Entries){$name=$entry.FullName.Replace('\','/');if($name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') | Where-Object {$_ -eq '..'}) -or !$seen.Add($name)){throw 'Catalogo inseguro/duplicado'}}
 New-Item -ItemType Directory -Path $target | Out-Null
 $rootPrefix=$target.TrimEnd('\','/')+'\';$extracted=0;$skipped=0
 foreach($entry in $zip.Entries){
  $name=$entry.FullName.Replace('\','/')
  if($name.StartsWith('runtime/gstreamer/',[StringComparison]::OrdinalIgnoreCase)){$skipped++;continue}
  $file=[IO.Path]::GetFullPath((Join-Path $target $name));if(!$file.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Destino fora da fixture'}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$file,$false);$extracted++
 }
 $receipt=@{scope='Original ZIP entries except GStreamer: startup diagnostic only, not installation or media validation';extracted=$extracted;skippedGstreamer=$skipped;archiveSha256=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash}
 $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'startup-extraction-receipt.json') -Encoding UTF8
 $receipt | ConvertTo-Json
}finally{if($zip){$zip.Dispose()}elseif($memory){$memory.Dispose()};$outer.Dispose()}
