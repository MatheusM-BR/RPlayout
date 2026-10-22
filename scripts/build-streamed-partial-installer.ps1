param(
  [string]$BasePackage='release/RPlayout-1.1-parcial-20261009-r29',
  [string]$Destination='release/RPlayout-1.1-parcial-20261009-r30-instalador.zip',
  [string]$Readme='docs/BUILD-PARCIAL-R30.md',
  [switch]$UseCurrentBuilds,
  [string]$OutputDirectory='',
  [string]$ServerBuildDirectory='',
  [string]$WebBuildDirectory='',
  [string]$FileSecurityBinary='',
  [string]$EngineBinary='',
  [string]$HostGuardBinary='',
  [string]$RelayBinary='',
  [string]$LauncherBinary='',
  [string]$GStreamerDistributionDirectory='',
  [string]$NodeNoticesDirectory='',
  [string]$RustNoticesDirectory=''
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib/build-source-roots.ps1')
. (Join-Path $PSScriptRoot 'lib/verified-zip-file.ps1')
$workspaceRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$baseRoot=[System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $BasePackage))
$outputRoot=Join-Path $workspaceRoot 'release'
if($OutputDirectory){
  if(![IO.Path]::IsPathRooted($OutputDirectory) -or [IO.Path]::GetFileName($Destination) -ne $Destination){throw 'Saida externa exige diretorio absoluto e nome simples de ZIP.'}
  $outputRoot=[IO.Path]::GetFullPath($OutputDirectory)
  if($outputRoot.TrimEnd('\','/') -eq [IO.Path]::GetPathRoot($outputRoot).TrimEnd('\','/')){throw 'Nao use a raiz do disco como pasta de saida.'}
  $archivePath=[IO.Path]::GetFullPath((Join-Path $outputRoot $Destination))
}else{$archivePath=[System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $Destination))}
$releaseRoot=$outputRoot.TrimEnd('\','/')+[System.IO.Path]::DirectorySeparatorChar
if(!$archivePath.StartsWith($releaseRoot,[StringComparison]::OrdinalIgnoreCase) -or !$archivePath.EndsWith('.zip')){throw 'Use um ZIP novo dentro da pasta de saida.'}
if(($ServerBuildDirectory -or $WebBuildDirectory) -and !$UseCurrentBuilds){throw 'Build externo exige compilacao observada e UseCurrentBuilds.'}
if(($EngineBinary -or $HostGuardBinary) -and !$UseCurrentBuilds){throw 'Engine/host guard externos exigem compilacao observada e UseCurrentBuilds.'}
if($RelayBinary -and (!$UseCurrentBuilds -or ![IO.Path]::IsPathRooted($RelayBinary) -or !(Test-Path -LiteralPath $RelayBinary -PathType Leaf))){throw 'Relay externo exige compilacao observada, UseCurrentBuilds e arquivo absoluto existente.'}
if($LauncherBinary -and (!$UseCurrentBuilds -or ![IO.Path]::IsPathRooted($LauncherBinary) -or !(Test-Path -LiteralPath $LauncherBinary -PathType Leaf))){throw 'Launcher externo exige compilacao observada, UseCurrentBuilds e arquivo absoluto existente.'}
$buildingPath=$archivePath+'.building'
if((Test-Path -LiteralPath $archivePath) -or (Test-Path -LiteralPath $buildingPath)){throw 'Destino existente; nada sera sobrescrito.'}
$base=Get-Content -LiteralPath (Join-Path $baseRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nodeVersion=& node -v
if($LASTEXITCODE -ne 0 -or $nodeVersion -ne $base.node){throw 'Node da compilacao difere do runtime da base.'}
$currentSqlite=Get-Content -LiteralPath (Join-Path $workspaceRoot 'apps/server/node_modules/better-sqlite3/package.json') -Raw | ConvertFrom-Json
$baseSqlite=Get-Content -LiteralPath (Join-Path $baseRoot 'apps/server/node_modules/better-sqlite3/package.json') -Raw | ConvertFrom-Json
if($currentSqlite.version -ne $baseSqlite.version){throw 'Dependencia nativa mudou; use deploy completo, nao reaproveite esta base.'}
# Only use -UseCurrentBuilds immediately after an observed successful compilation.
if(!$UseCurrentBuilds){
Push-Location -LiteralPath $workspaceRoot
try {
  pnpm.cmd build
  if($LASTEXITCODE -ne 0){throw 'Compilacao servidor/interface falhou.'}
  Push-Location -LiteralPath (Join-Path $workspaceRoot 'apps/engine')
  try {cargo build --release --bins;if($LASTEXITCODE -ne 0){throw 'Compilacao nativa falhou.'}}finally{Pop-Location}
}finally{Pop-Location}
}
$files=@{}
$expected=@{}
foreach($entry in $base.files){
  $name=[string]$entry.file
  if($name.StartsWith('apps/server/dist/') -or $name.StartsWith('apps/web/dist/')){continue}
  $path=[System.IO.Path]::GetFullPath((Join-Path $baseRoot $name))
  if(!$path.StartsWith($baseRoot+[System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Manifesto fora da base.'}
  $files[$name]=$path;$expected[$name]=$entry.sha256
}
foreach($folder in @('apps/server/dist','apps/web/dist')){
  $override=if($folder -eq 'apps/server/dist'){$ServerBuildDirectory}else{$WebBuildDirectory}
  foreach($entry in Get-RPlayoutBuildFiles -WorkspaceRoot $workspaceRoot -Folder $folder -OverrideDirectory $override -UseCurrentBuilds:$UseCurrentBuilds){$files[$entry.file]=$entry.source}
}
$engineBuild=Get-RPlayoutNativeBuildFile -WorkspaceRoot $workspaceRoot -Name 'rplayout-engine.exe' -OverrideFile $EngineBinary -UseCurrentBuilds:$UseCurrentBuilds
foreach($name in @('rplayout-engine.exe','rplayout-engine-test.exe','apps/engine/target/release/rplayout-engine.exe')){$files[$name]=$engineBuild.source;$expected[$name]=$engineBuild.sha256}
$launcherSource=if($LauncherBinary){[IO.Path]::GetFullPath($LauncherBinary)}else{Join-Path $workspaceRoot 'apps/engine/target/release/rplayout.exe'}
foreach($name in @('Server','Master','Schedule','Users','Monitor','Aired','QC')){$key='RPlayout-'+$name+'.exe';$files[$key]=$launcherSource;$expected.Remove($key)}
foreach($name in @('probe','devices','relay','avsync','proxy','audio-analysis','audio-bus-probe','graphic-probe','file-security')){$key='apps/engine/target/release/rplayout-'+$name+'.exe';$files[$key]=Join-Path $workspaceRoot $key;$expected.Remove($key)}
$guardBuild=Get-RPlayoutNativeBuildFile -WorkspaceRoot $workspaceRoot -Name 'rplayout-host-guard.exe' -OverrideFile $HostGuardBinary -UseCurrentBuilds:$UseCurrentBuilds
$files[$guardBuild.file]=$guardBuild.source;$expected[$guardBuild.file]=$guardBuild.sha256
# If an older base has a root alias, it must not retain the previous helper.
if($files.ContainsKey('rplayout-host-guard.exe')){$files['rplayout-host-guard.exe']=$guardBuild.source;$expected['rplayout-host-guard.exe']=$guardBuild.sha256}
if($RelayBinary){
  $relaySource=[IO.Path]::GetFullPath($RelayBinary)
  $files['apps/engine/target/release/rplayout-relay.exe']=$relaySource
  $expected.Remove('apps/engine/target/release/rplayout-relay.exe')
  if($files.ContainsKey('rplayout-relay.exe')){$files['rplayout-relay.exe']=$relaySource;$expected.Remove('rplayout-relay.exe')}
}
if($FileSecurityBinary){
  if(![IO.Path]::IsPathRooted($FileSecurityBinary) -or !(Test-Path -LiteralPath $FileSecurityBinary -PathType Leaf)){throw 'Auxiliar de seguranca externo exige arquivo absoluto existente.'}
  $files['apps/engine/target/release/rplayout-file-security.exe']=[IO.Path]::GetFullPath($FileSecurityBinary)
  $expected.Remove('apps/engine/target/release/rplayout-file-security.exe')
  if($files.ContainsKey('rplayout-file-security.exe')){$files['rplayout-file-security.exe']=[IO.Path]::GetFullPath($FileSecurityBinary);$expected.Remove('rplayout-file-security.exe')}
}
foreach($name in @('IMPLEMENTACOES-BROADCAST-2026-09-30.md','RPLAYOUT-1.1-FUNCIONALIDADES.md')){$files[$name]=Join-Path $workspaceRoot ('docs/'+$name);$expected.Remove($name)}
$manifestFiles=@()
if($RustNoticesDirectory){
  $rustNoticeRoot=(Resolve-Path -LiteralPath $RustNoticesDirectory).Path
  $rustInventoryPath=Join-Path $rustNoticeRoot 'inventory.json'
  $rustInventory=Get-Content -LiteralPath $rustInventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if((Get-FileHash -LiteralPath (Join-Path $workspaceRoot 'apps/engine/Cargo.lock') -Algorithm SHA256).Hash -ne $rustInventory.cargoLockSha256){throw 'Cargo.lock mudou desde o inventario de avisos Rust.'}
  $files['licenses/rust/inventory.json']=$rustInventoryPath
  $expected.Remove('licenses/rust/inventory.json')
  foreach($rustPackage in $rustInventory.packages){foreach($rustNotice in $rustPackage.notices){
    $rustNoticePath=[IO.Path]::GetFullPath((Join-Path $rustNoticeRoot $rustNotice.file))
    if(!$rustNoticePath.StartsWith($rustNoticeRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Aviso Rust fora da pasta de coleta.'}
    if((Get-FileHash -LiteralPath $rustNoticePath -Algorithm SHA256).Hash -ne $rustNotice.sha256){throw 'Aviso Rust alterado desde o inventario.'}
    $rustKey='licenses/rust/'+$rustNotice.file
    $files[$rustKey]=$rustNoticePath;$expected.Remove($rustKey)
  }}
}
if($NodeNoticesDirectory){
  $nodeNoticeRoot=(Resolve-Path -LiteralPath $NodeNoticesDirectory).Path
  $nodeNoticeProvenance=Get-Content -LiteralPath (Join-Path $nodeNoticeRoot 'provenance.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $nodeNoticePath=Join-Path $nodeNoticeRoot 'LICENSE.txt'
  if($nodeNoticeProvenance.version -ne $base.node -or $nodeNoticeProvenance.source -ne ('https://raw.githubusercontent.com/nodejs/node/'+$base.node+'/LICENSE')){throw 'Aviso Node de outra versao/origem.'}
  if((Get-FileHash -LiteralPath (Join-Path $baseRoot 'runtime/node/node.exe') -Algorithm SHA256).Hash -ne $nodeNoticeProvenance.binarySha256 -or (Get-FileHash -LiteralPath $nodeNoticePath -Algorithm SHA256).Hash -ne $nodeNoticeProvenance.licenseSha256){throw 'Aviso Node ou runtime alterados desde a coleta.'}
  $files['licenses/node/LICENSE.txt']=$nodeNoticePath
  $files['licenses/node/provenance.json']=Join-Path $nodeNoticeRoot 'provenance.json'
  $expected.Remove('licenses/node/LICENSE.txt')
  $expected.Remove('licenses/node/provenance.json')
}
if($GStreamerDistributionDirectory){
  $matchingNotices=@(& (Join-Path $PSScriptRoot 'get-matching-gstreamer-notices.ps1') -BasePackage $baseRoot -DistributionDirectory $GStreamerDistributionDirectory)
  foreach($notice in $matchingNotices){$files[$notice.Name]=$notice.Source;$expected.Remove($notice.Name)}
}
$files['prepare-rplayout-upgrade.ps1']=Join-Path $PSScriptRoot 'prepare-rplayout-upgrade.ps1'
$expected.Remove('prepare-rplayout-upgrade.ps1')
$files['restore-rplayout-backup.ps1']=Join-Path $PSScriptRoot 'restore-rplayout-backup.ps1'
$expected.Remove('restore-rplayout-backup.ps1')
$files['review-rplayout-upgrade.ps1']=Join-Path $PSScriptRoot 'review-rplayout-upgrade.ps1'
$expected.Remove('review-rplayout-upgrade.ps1')
$files['start-rplayout-upgrade.ps1']=Join-Path $PSScriptRoot 'start-rplayout-upgrade.ps1'
$expected.Remove('start-rplayout-upgrade.ps1')
$files['reconcile-rplayout-upgrade-profile.ps1']=Join-Path $PSScriptRoot 'reconcile-rplayout-upgrade-profile.ps1'
$expected.Remove('reconcile-rplayout-upgrade-profile.ps1')
$files['review-rplayout-rollback.ps1']=Join-Path $PSScriptRoot 'review-rplayout-rollback.ps1'
$expected.Remove('review-rplayout-rollback.ps1')
$files['prepare-rplayout-rollback.ps1']=Join-Path $PSScriptRoot 'prepare-rplayout-rollback.ps1'
$expected.Remove('prepare-rplayout-rollback.ps1')
$files['start-rplayout-rollback.ps1']=Join-Path $PSScriptRoot 'start-rplayout-rollback.ps1'
$expected.Remove('start-rplayout-rollback.ps1')
$files['start-rplayout-witness.ps1']=Join-Path $PSScriptRoot 'start-rplayout-witness.ps1'
$expected.Remove('start-rplayout-witness.ps1')
foreach($name in @($files.Keys | Sort-Object)){
  $file=Get-Item -LiteralPath $files[$name]
  if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Arquivo nao materializado.'}
  $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  if($expected.ContainsKey($name) -and $hash -ne $expected[$name]){throw "Base modificada: $name"}
  $manifestFiles += [ordered]@{file=$name;bytes=$file.Length;sha256=$hash}
}
$drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($archivePath))
if($drive.AvailableFreeSpace -lt 620000000){throw 'Espaco insuficiente para ZIP completo e margem; nenhuma release apagada.'}
$edition=[IO.Path]::GetFileNameWithoutExtension($archivePath) -replace '-instalador$',''
$manifest=[ordered]@{version=1;builtAt=[DateTime]::UtcNow.ToString('o');functionalVerification='NOT_RUN_PARTIAL_BUILD';node=$base.node;msvc=$base.msvc;packaging='STREAMED_FULL_INSTALLER';runtimeBase=[IO.Path]::GetFileName($baseRoot);sqliteVersion=$baseSqlite.version;files=$manifestFiles}
Add-Type -AssemblyName System.IO.Compression
function Write-ZipText($zip,[string]$name,[string]$value){
  $entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Fastest)
  $stream=$entry.Open()
  try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($value);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
}
$stream=[IO.File]::Open($buildingPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
  $outer=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
  try{
    Write-ZipText $outer 'installation-edition.json' (@{edition=$edition}|ConvertTo-Json)
    Write-ZipText $outer 'INSTALAR.cmd' (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-rplayout-partial.cmd') -Raw)
    Write-ZipText $outer 'INSTALAR.ps1' (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-rplayout-partial.ps1') -Raw)
    Write-ZipText $outer 'LEIA-ME.md' (Get-Content -LiteralPath (Join-Path $workspaceRoot $Readme) -Raw -Encoding UTF8)
    $payload=$outer.CreateEntry('RPlayout-payload.zip',[IO.Compression.CompressionLevel]::NoCompression).Open()
    try{
      $inner=[IO.Compression.ZipArchive]::new($payload,[IO.Compression.ZipArchiveMode]::Create,$true)
      try{
        foreach($entry in $manifestFiles){
          Write-ZipVerifiedFile $inner $entry $files[$entry.file]
        }
        Write-ZipText $inner 'package-manifest.json' ($manifest|ConvertTo-Json -Depth 7)
      }finally{$inner.Dispose()}
    }finally{$payload.Dispose()}
  }finally{$outer.Dispose()}
}finally{$stream.Dispose()}
Move-Item -LiteralPath $buildingPath -Destination $archivePath
Write-Host "Instalador completo gerado SEM testes funcionais: $archivePath"
Get-Item -LiteralPath $archivePath | Select-Object FullName,Length
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
