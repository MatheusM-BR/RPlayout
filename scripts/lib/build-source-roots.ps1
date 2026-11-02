# Read-only source selection. Does not compile, create a ZIP or change builds.
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop

function Get-RPlayoutNativeBuildFile {
  param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)][ValidateSet('rplayout-engine.exe','rplayout-host-guard.exe')][string]$Name,
    [string]$OverrideFile='',
    [switch]$UseCurrentBuilds
  )
  if($OverrideFile -and (!$UseCurrentBuilds -or ![IO.Path]::IsPathRooted($OverrideFile))){throw 'Binario externo exige arquivo absoluto e compilacao observada com UseCurrentBuilds.'}
  $path=if($OverrideFile){[IO.Path]::GetFullPath($OverrideFile)}else{[IO.Path]::GetFullPath((Join-Path $WorkspaceRoot ('apps/engine/target/release/'+$Name)))}
  $info=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Binario deve ser arquivo materializado.'}
  for($ancestor=[IO.Path]::GetDirectoryName($path);$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){
    $parent=Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
    if(!$parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Binario nao pode atravessar junction/symlink nos ancestrais.'}
  }
  # Structural Windows x64 executable check only: not signature verification,
  # proof of compilation, ABI qualification or permission to start a publisher.
  $nativeStream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $reader=$null
  $nativeHash=$null
  try{
    $reader=[IO.BinaryReader]::new($nativeStream)
    if($nativeStream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d){throw 'Binario sem cabecalho DOS/PE.'}
    [void]$nativeStream.Seek(0x3c,[IO.SeekOrigin]::Begin);$offset=$reader.ReadUInt32()
    if($offset -lt 64 -or $offset -gt $nativeStream.Length-26){throw 'Offset PE fora do arquivo.'}
    [void]$nativeStream.Seek($offset,[IO.SeekOrigin]::Begin)
    if($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664){throw 'Binario deve ser PE Windows x64.'}
    $sections=$reader.ReadUInt16();if($sections -eq 0){throw 'PE sem secoes.'}
    [void]$nativeStream.Seek($offset+20,[IO.SeekOrigin]::Begin);$optionalSize=$reader.ReadUInt16();$characteristics=$reader.ReadUInt16()
    if($optionalSize -lt 112 -or $offset+24+$optionalSize+40*$sections -gt $nativeStream.Length -or ($characteristics -band 0x2000) -or !($characteristics -band 2) -or $reader.ReadUInt16() -ne 0x20b){throw 'Binario deve ter cabecalho executavel PE32+ completo, nao DLL.'}
    [void]$nativeStream.Seek(0,[IO.SeekOrigin]::Begin)
    $digest=[Security.Cryptography.SHA256]::Create()
    try{$nativeHash=[BitConverter]::ToString($digest.ComputeHash($nativeStream)).Replace('-','')}finally{$digest.Dispose()}
  }finally{if($reader){$reader.Dispose()};$nativeStream.Dispose()}
  return [pscustomobject]@{file='apps/engine/target/release/'+$Name;source=$path;sha256=$nativeHash}
}

function Get-RPlayoutBuildFiles {
  param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)][ValidateSet('apps/server/dist','apps/web/dist')][string]$Folder,
    [string]$OverrideDirectory='',
    [switch]$UseCurrentBuilds
  )
  if($OverrideDirectory -and (!$UseCurrentBuilds -or ![IO.Path]::IsPathRooted($OverrideDirectory))){throw 'Build externo exige caminho absoluto e compilacao observada com UseCurrentBuilds.'}
  $root=if($OverrideDirectory){[IO.Path]::GetFullPath($OverrideDirectory)}else{[IO.Path]::GetFullPath((Join-Path $WorkspaceRoot $Folder))}
  $root=$root.TrimEnd('\','/')
  if($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\','/')){throw 'Build nao pode ser raiz do disco.'}
  for($ancestor=$root;$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){
    $info=Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
    if(!$info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Build deve ser pasta materializada, sem junction/symlink em seus ancestrais.'}
  }
  $prefix=$root+[IO.Path]::DirectorySeparatorChar
  $entries=[Collections.Generic.List[object]]::new()
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($root)
  while($pending.Count){
    foreach($file in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop){
      if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Build contem junction/symlink; nenhuma origem externa sera seguida.'}
      if(!$file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Arquivo fora da pasta de build.'}
      if($file.PSIsContainer){$pending.Push($file.FullName);continue}
      $entries.Add([pscustomobject]@{file=$Folder+'/'+$file.FullName.Substring($prefix.Length).Replace('\','/');source=$file.FullName})
    }
  }
  $selected=@{};foreach($entry in $entries){$selected[$entry.file]=$entry.source}
  $required=if($Folder -eq 'apps/server/dist'){
    @('server.cjs','schedule-planner.cjs','ha-witness.cjs','restore-backup.cjs','review-restored.cjs','recover-restored-reservation.cjs','storage-service.cjs','storage-bridge.cjs','migrate-restored.cjs','reconcile-upgrade-profile.cjs','review-rollback.cjs','ha-return-review-worker.cjs','rollback-contract.cjs','prepare-compatible-rollback.cjs')
  }else{@('index.html','build.json','third-party/inventory.json')}
  foreach($name in $required){if(!$selected.ContainsKey($Folder+'/'+$name)){throw ('Build incompleto: '+$name)}}
  if($Folder -eq 'apps/web/dist'){
    foreach($name in @('build.json','third-party/inventory.json')){
      $json=Get-Content -LiteralPath $selected[$Folder+'/'+$name] -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      if($null -eq $json){throw ('Metadado web invalido: '+$name)}
    }
    $html=Get-Content -LiteralPath $selected[$Folder+'/index.html'] -Raw -Encoding UTF8 -ErrorAction Stop
    $pattern=@'
(?is)<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["'](?<asset>/?assets/[^"'?#]+)(?:[?#][^"']*)?["']
'@
    $hasScript=$false;$hasStyle=$false
    foreach($match in [regex]::Matches($html,$pattern)){
      $asset=[Uri]::UnescapeDataString($match.Groups['asset'].Value.TrimStart('/'))
      $absolute=[IO.Path]::GetFullPath((Join-Path $root $asset))
      if(!$absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Referencia web fora da pasta de build.'}
      $key=$Folder+'/'+$absolute.Substring($prefix.Length).Replace('\','/')
      if(!$selected.ContainsKey($key)){throw ('Asset referenciado pelo HTML ausente: '+$asset)}
      if($asset.EndsWith('.js',[StringComparison]::OrdinalIgnoreCase)){$hasScript=$true}
      if($asset.EndsWith('.css',[StringComparison]::OrdinalIgnoreCase)){$hasStyle=$true}
    }
    if(!$hasScript -or !$hasStyle){throw 'HTML sem entradas locais JS/CSS compiladas.'}
  }
  return $entries.ToArray()
}
