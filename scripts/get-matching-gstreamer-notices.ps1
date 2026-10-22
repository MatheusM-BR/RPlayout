param([Parameter(Mandatory=$true)][string]$BasePackage,[Parameter(Mandatory=$true)][string]$DistributionDirectory)
$ErrorActionPreference='Stop'
$noticeBaseRoot=(Resolve-Path -LiteralPath $BasePackage).Path
$noticeDistributionRoot=(Resolve-Path -LiteralPath $DistributionDirectory).Path
$noticeManifest=Get-Content -LiteralPath (Join-Path $noticeBaseRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$noticeRuntimeEntries=@($noticeManifest.files | Where-Object {$_.file.StartsWith('runtime/gstreamer/')})
if(!$noticeRuntimeEntries.Count){throw 'Base sem runtime GStreamer manifestado.'}
# Do not attach current-machine notices to an unrelated historical build.
foreach($noticeEntry in $noticeRuntimeEntries){
  $noticeRelative=$noticeEntry.file.Substring('runtime/gstreamer/'.Length)
  # Microsoft CRT was added app-local by RPlayout, not supplied by GStreamer.
  # Its notices/provenance are a separate audit; never infer them from LGPL.
  if($noticeRelative -match '^(?:bin/|libexec/gstreamer-1.0/)(concrt140|msvcp140(?:_1|_2|_atomic_wait|_codecvt_ids)?|vccorlib140|vcruntime140(?:_1|_threads)?)\.dll$'){
    $noticeCrtSignature=Get-AuthenticodeSignature -LiteralPath (Join-Path $noticeBaseRoot $noticeEntry.file)
    if($noticeCrtSignature.Status -ne 'Valid' -or $noticeCrtSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'CRT adicional sem assinatura Microsoft valida.'}
    continue
  }
  $noticeCandidate=[IO.Path]::GetFullPath((Join-Path $noticeDistributionRoot $noticeRelative))
  if(!$noticeCandidate.StartsWith($noticeDistributionRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Caminho fora da distribuicao.'}
  if(!(Test-Path -LiteralPath $noticeCandidate -PathType Leaf)){throw "Distribuicao incompleta: $noticeRelative"}
  if((Get-FileHash -LiteralPath $noticeCandidate -Algorithm SHA256).Hash -ne $noticeEntry.sha256){throw "Distribuicao diferente da base: $noticeRelative"}
}
$noticeSource=Join-Path $noticeDistributionRoot 'share/licenses'
if(!(Test-Path -LiteralPath $noticeSource -PathType Container)){throw 'Distribuicao correspondente sem share/licenses.'}
$noticeFiles=@(Get-ChildItem -LiteralPath $noticeSource -Recurse -File)
if(!$noticeFiles.Count){throw 'Pasta de licencas vazia.'}
foreach($noticeFile in $noticeFiles){
  if($noticeFile.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Aviso redirecionado; materialize antes de empacotar.'}
  [pscustomobject]@{Name=('licenses/gstreamer/'+$noticeFile.FullName.Substring($noticeSource.Length+1).Replace('\','/'));Source=$noticeFile.FullName}
}
