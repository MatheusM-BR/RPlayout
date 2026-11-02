# Definition only. Invoked by the packager; no archive/process on module load.
function Write-ZipVerifiedFile($zip,$entry,[string]$source){
  # Hash the SAME bytes copied, with a read-only shared handle that excludes
  # writers/deletion. A prior hash before opening is not copy-integrity proof.
  $sourceStream=$null;$hash=$null;$target=$null
  try{
    $sourceStream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $hash=[Security.Cryptography.SHA256]::Create()
    $target=$zip.CreateEntry($entry.file,[IO.Compression.CompressionLevel]::Fastest).Open()
    $buffer=[byte[]]::new(1024*1024);[long]$copied=0
    while(($count=$sourceStream.Read($buffer,0,$buffer.Length)) -gt 0){
      [void]$hash.TransformBlock($buffer,0,$count,$buffer,0)
      $target.Write($buffer,0,$count);$copied+=$count
    }
    [void]$hash.TransformFinalBlock([byte[]]@(),0,0)
    $actual=[BitConverter]::ToString($hash.Hash).Replace('-','')
    if($copied -ne $entry.bytes -or $actual -ne $entry.sha256){throw ('Conteudo mudou durante copia para ZIP: '+$entry.file)}
  }finally{try{if($target){$target.Dispose()}}finally{try{if($hash){$hash.Dispose()}}finally{if($sourceStream){$sourceStream.Dispose()}}}}
}
