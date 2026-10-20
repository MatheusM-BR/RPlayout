param([string]$Destination = '',[string]$Payload = '',[string]$ShortcutDirectory = '')
$ErrorActionPreference = 'Stop'
# Use this PowerShell's built-ins, not an incompatible module inherited from a
# different host/version through PSModulePath. No machine setting is changed.
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -Force -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1')) -Force -ErrorAction Stop
function Get-RPlayoutInstallRequiredBytes([long]$ExpandedBytes,[int]$EntryCount){
  if($ExpandedBytes -lt 0 -or $ExpandedBytes -gt 100GB -or $EntryCount -lt 1 -or $EntryCount -gt 100000){throw 'Estimativa de extracao invalida.'}
  # Conservative allocation overhead plus room for receipt/profile/shortcuts.
  return $ExpandedBytes + ([long]$EntryCount * 64KB) + 256MB
}
function Assert-RPlayoutInstallCapacity([long]$RequiredBytes,[long]$AvailableBytes){
  if($RequiredBytes -lt 0 -or $AvailableBytes -lt 0){throw 'Espaco livre nao foi confirmado.'}
  if($AvailableBytes -lt $RequiredBytes){throw ('Espaco insuficiente antes da extracao: necessario {0:N2} GiB, disponivel {1:N2} GiB. Nenhuma pasta de instalacao foi criada.' -f ($RequiredBytes/1GB),($AvailableBytes/1GB))}
}
try {
  $bundleRoot = if($Payload){[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Payload))}else{$PSScriptRoot}
  $payload = if($Payload){[IO.Path]::GetFullPath($Payload)}else{Join-Path $bundleRoot 'RPlayout-payload.zip'}
  if (!(Test-Path -LiteralPath $payload -PathType Leaf)) { throw 'Extraia todo o ZIP do instalador antes de executar INSTALAR.cmd.' }
  $editionFile = Join-Path $bundleRoot 'installation-edition.json'
  if (!(Test-Path -LiteralPath $editionFile -PathType Leaf)) { throw 'Identificacao da edicao ausente. Extraia o instalador completo; nenhuma versao sera presumida.' }
  $edition = (Get-Content -LiteralPath $editionFile -Raw | ConvertFrom-Json).edition
  if ($edition -notmatch '^RPlayout-[A-Za-z0-9.-]+$') { throw 'Identificacao invalida do instalador.' }
  Write-Host "$edition - BUILD PARCIAL, NAO HOMOLOGADA" -ForegroundColor Yellow
  Write-Host 'Nao substitui dados ou instalacoes anteriores. Nao instala drivers DeckLink.'
  if (!$Destination) {
    $suggested = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RPlayout') $edition
    $chosen = Read-Host "Pasta de instalacao (Enter para $suggested)"
    $Destination = if ($chosen.Trim()) { $chosen.Trim().Trim('"') } else { $suggested }
  }
  $Destination = [System.IO.Path]::GetFullPath($Destination)
  if ($Destination -eq [System.IO.Path]::GetPathRoot($Destination)) { throw 'Nao use a raiz de um disco como destino.' }
  if (Test-Path -LiteralPath $Destination) { throw "A pasta ja existe; nada foi substituido. Escolha uma pasta NOVA: $Destination" }
  if($ShortcutDirectory){
    if(![IO.Path]::IsPathRooted($ShortcutDirectory)){throw 'Pasta de atalhos deve ser absoluta.'}
    $ShortcutDirectory=[IO.Path]::GetFullPath($ShortcutDirectory)
    if($ShortcutDirectory -eq [IO.Path]::GetPathRoot($ShortcutDirectory) -or (Test-Path -LiteralPath $ShortcutDirectory)){throw 'Escolha pasta NOVA de atalhos, nao a raiz do disco.'}
  }
  # No administrative privileges, global Node/GStreamer or pnpm installation.
  # Keep partial files on failure for diagnosis; never remove operator data.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $expectedRoot = $Destination.TrimEnd('\','/') + [System.IO.Path]::DirectorySeparatorChar
  # Validate the complete archive BEFORE extraction, not only the paths which
  # happen to be listed in a manifest after arbitrary files were written.
  $ancestor = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($Destination))
  while ($ancestor) {
    if ($ancestor.Exists -and ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Destino atravessa link/juncao. Escolha uma pasta fisica nova.' }
    $ancestor = $ancestor.Parent
  }
  $archive = [IO.Compression.ZipFile]::OpenRead($payload)
  try {
    if ($archive.Entries.Count -gt 100000) { throw 'Pacote excede o limite de arquivos.' }
    $catalog = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$expandedBytes = 0
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\','/')
      if (!$name -or $name.StartsWith('/') -or $name.Contains(':') -or $name.Contains([char]0) -or $name.Split('/') -contains '..' -or $name.Split('/') -contains '.') { throw 'Pacote possui caminho invalido.' }
      foreach ($segment in $name.TrimEnd('/').Split('/')) {
        if (!$segment -or $segment -match '[<>"|?*]' -or $segment.EndsWith('.') -or $segment.EndsWith(' ') -or $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Pacote possui nome de arquivo invalido no Windows.' }
      }
      $target = [IO.Path]::GetFullPath((Join-Path $Destination $name))
      if (!$target.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Pacote tenta escrever fora da instalacao.' }
      if (($entry.ExternalAttributes -band 0x400) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Pacote possui link nao materializado.' }
      if ($catalog.ContainsKey($name.TrimEnd('/'))) { throw 'Pacote possui caminhos duplicados.' }
      $catalog.Add($name.TrimEnd('/'),$entry)
      $expandedBytes += $entry.Length
      if ($expandedBytes -gt 100GB) { throw 'Pacote excede limite de extracao.' }
    }
    if (!$catalog.ContainsKey('package-manifest.json')) { throw 'Pacote sem manifesto.' }
    $manifestEntry = $catalog['package-manifest.json']
    if ($manifestEntry.Length -gt 16MB) { throw 'Manifesto excede limite.' }
    $reader = [IO.StreamReader]::new($manifestEntry.Open(),[Text.Encoding]::UTF8)
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.version -ne 1 -or !$manifest.files -or !$manifest.node) { throw 'Manifesto incompleto.' }
    $listed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $manifest.files) {
      $name = [string]$entry.file
      if (!$listed.Add($name) -or !$catalog.ContainsKey($name) -or $name.EndsWith('/') -or $entry.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or [long]$entry.bytes -ne $catalog[$name].Length) { throw 'Manifesto inconsistente com arquivos do pacote.' }
      if ($name -in @('installation-profile.json','installation-receipt.json')) { throw 'Pacote nao pode fornecer perfil/recibo de outra instalacao.' }
    }
    foreach ($entry in $archive.Entries) {
      if (!$entry.FullName.EndsWith('/') -and $entry.FullName -ne 'package-manifest.json' -and !$listed.Contains($entry.FullName)) { throw 'Pacote possui arquivo nao declarado no manifesto.' }
    }
    $spaceChecked=$false
    $requiredBytes=Get-RPlayoutInstallRequiredBytes $expandedBytes $archive.Entries.Count
    $volumeRoot=[IO.Path]::GetPathRoot($Destination)
    if($volumeRoot.StartsWith('\\')){
      Write-Warning 'Destino UNC: espaco/quota do compartilhamento nao conferidos automaticamente. Verifique antes de instalar.'
    }else{
      $volume=[IO.DriveInfo]::new($volumeRoot)
      if(!$volume.IsReady){throw 'Volume de destino nao esta pronto; nada extraido.'}
      Assert-RPlayoutInstallCapacity $requiredBytes $volume.AvailableFreeSpace
      $spaceChecked=$true
    }
    # Extract from the same still-open archive, not a pathname reopened after
    # validation which could now point to a different payload.
    [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $Destination)
  } finally { $archive.Dispose() }
  foreach ($entry in $manifest.files) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $Destination $entry.file))
    if (!$target.StartsWith($expectedRoot,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Manifesto com caminho fora da instalacao.' }
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "Arquivo incompleto: $($entry.file)" }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Integridade incorreta: $($entry.file)" }
  }
  # New installations have their own data directory. Never point a new binary
  # at an old operational DB merely because another edition exists.
  $dataRoot = Join-Path $Destination 'data'
  if (Test-Path -LiteralPath $dataRoot) { throw 'Pacote inclui pasta de dados; revisao manual necessaria.' }
  New-Item -ItemType Directory -Path $dataRoot | Out-Null
  $profile = [ordered]@{version=1;dataRoot=$dataRoot;mediaRoot=(Join-Path $Destination 'midia');vaultFile=(Join-Path (Join-Path $dataRoot 'security') 'vault.json')}
  [IO.File]::WriteAllText((Join-Path $Destination 'installation-profile.json'),($profile | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  $receipt = [ordered]@{version=1;edition=$edition;installedAt=[DateTime]::UtcNow.ToString('o');destination=$Destination;payloadSha256=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash;manifestSha256=(Get-FileHash -LiteralPath (Join-Path $Destination 'package-manifest.json') -Algorithm SHA256).Hash;integrity='VERIFIED';functionalVerification='NOT_RUN';previousInstallationModified=$false;serverStarted=$false;spaceCheckedBeforeExtraction=$spaceChecked;estimatedRequiredBytes=$requiredBytes}
  [IO.File]::WriteAllText((Join-Path $Destination 'installation-receipt.json'),($receipt | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  $shell = New-Object -ComObject WScript.Shell
  $menu = if($ShortcutDirectory){$ShortcutDirectory}else{Join-Path ([Environment]::GetFolderPath('Programs')) $edition}
  if (Test-Path -LiteralPath $menu) { throw "Atalhos ja existem: $menu. Instalacao preservada em $Destination; nenhum atalho antigo substituido." }
  New-Item -ItemType Directory -Path $menu | Out-Null
  foreach ($name in @('Server','Master','Schedule','QC','Monitor','Aired','Users')) {
    $shortcut = $shell.CreateShortcut((Join-Path $menu "RPlayout $name.lnk"))
    $shortcut.TargetPath = Join-Path $Destination "RPlayout-$name.exe"
    $shortcut.WorkingDirectory = $Destination
    $shortcut.Description = "$edition parcial - nao homologado"
    $shortcut.Save()
  }
  Write-Host "Instalado em $Destination" -ForegroundColor Green
  Write-Host 'Abra RPlayout Server e depois Master ou QC no menu Iniciar.'
  Write-Host 'Nao foi iniciado nenhum servidor automaticamente. Dependencias incluidas; drivers fisicos continuam necessarios.'
  Write-Host 'Dados desta edicao ficam em data. Atualizacao/restauracao de outra edicao exige backup e revisao; nao basta copiar o banco em uso.'
  Write-Host 'Para remover: pare os programas, preserve dados/midia/cofre, e remova apenas esta pasta e seus atalhos.'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nenhuma instalacao anterior foi removida. Se houve extracao parcial, os arquivos foram preservados.'
  exit 1
}
