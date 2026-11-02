param(
  [ValidateSet('Copy','ResumeCopy','Commit')][string]$Phase = 'Copy',
  [string]$ReceiptPath,
  [string]$StagePath
)
$ErrorActionPreference = 'Stop'

# User-authorized, exact roots only. Never use MIR/MOVE or follow reparse
# points during inventory/deletion. Destination D:/IA may contain other work.
function Assert-ExactPath([string]$Path, [string]$Expected) {
  if ([IO.Path]::GetFullPath($Path).TrimEnd('\') -ine $Expected.TrimEnd('\')) {
    throw "Unexpected migration target: $Path"
  }
}
function Read-Inventory([string]$Root, [switch]$HashFiles) {
  $rootItem = Get-Item -LiteralPath $Root -Force
  if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Inventory root must be a physical directory: $Root"
  }
  $base = $rootItem.FullName.TrimEnd('\')
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($base)
  $rows = [Collections.Generic.List[object]]::new()
  $files = 0; [long]$bytes = 0
  while ($pending.Count) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      $relative = $item.FullName.Substring($base.Length + 1)
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $rows.Add([pscustomobject]@{Path=$relative;Kind='LINK';LinkType=$item.LinkType;Target=@($item.Target)})
      } elseif ($item.PSIsContainer) {
        $rows.Add([pscustomobject]@{Path=$relative;Kind='DIR'})
        $pending.Push($item.FullName)
      } else {
        $row = [ordered]@{Path=$relative;Kind='FILE';Length=$item.Length;WriteTicks=$item.LastWriteTimeUtc.Ticks}
        if ($HashFiles) { $row.Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        $rows.Add([pscustomobject]$row)
        $files++; $bytes += $item.Length
        if ($files % 5000 -eq 0) { Write-Host "Inventory $Root : $files files ($([math]::Round($bytes/1GB,2)) GiB)" }
      }
    }
  }
  [pscustomobject]@{Root=$base;Files=$files;Bytes=$bytes;Rows=@($rows | Sort-Object Path)}
}
function Compare-Inventory($Expected, $Actual) {
  if ($Expected.Rows.Count -ne $Actual.Rows.Count -or $Expected.Files -ne $Actual.Files -or $Expected.Bytes -ne $Actual.Bytes) {
    throw "Inventory count/size differs at $($Actual.Root)"
  }
  for ($index=0; $index -lt $Expected.Rows.Count; $index++) {
    $first=$Expected.Rows[$index]; $second=$Actual.Rows[$index]
    if ($first.Path -cne $second.Path -or $first.Kind -ne $second.Kind) { throw "Entry differs: $($first.Path)" }
    switch ($first.Kind) {
      FILE {
        if ($first.Length -ne $second.Length -or $first.WriteTicks -ne $second.WriteTicks -or
            ($first.PSObject.Properties['Hash'] -and $second.PSObject.Properties['Hash'] -and $first.Hash -ne $second.Hash)) {
          throw "File differs: $($first.Path)"
        }
      }
      LINK {
        if ($first.LinkType -ne $second.LinkType -or
            (ConvertTo-Json -InputObject @($first.Target) -Compress) -cne (ConvertTo-Json -InputObject @($second.Target) -Compress)) {
          throw "Link differs: $($first.Path)"
        }
      }
    }
  }
}
function Set-AccessOnly([string]$Path,$Acl) {
  $sddl=$Acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  if((Get-Item -LiteralPath $Path -Force).PSIsContainer) {
    $access=[Security.AccessControl.DirectorySecurity]::new()
    $access.SetSecurityDescriptorSddlForm($sddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path),$access)
  } else {
    $access=[Security.AccessControl.FileSecurity]::new()
    $access.SetSecurityDescriptorSddlForm($sddl,[Security.AccessControl.AccessControlSections]::Access)
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($Path),$access)
  }
}
function Protect-Staging([string]$Path) {
  $acl=Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  }
  Set-AccessOnly $Path $acl
}
function Effective-Rules($Acl) {
  @($Acl.Access | ForEach-Object {
    [pscustomobject]@{Sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;
      Rights=[long]$_.FileSystemRights;Type=[int]$_.AccessControlType;
      Inherit=[int]$_.InheritanceFlags;Propagate=[int]$_.PropagationFlags}
  } | Sort-Object Sid,Type,Rights,Inherit,Propagate) | ConvertTo-Json -Compress
}
function Copy-EffectiveSecurity([string]$Source,[string]$Target) {
  $sourceAcl=Get-Acl -LiteralPath $Source
  # Relocating across volumes changes the parent. Promote effective inherited
  # rules, preserving access instead of adopting a broader target ACL.
  $sourceAcl.SetAccessRuleProtection($true,$true)
  # Only DACL access rules are transported. Owner/audit/mandatory-label
  # sections are not requested from another object (SeSecurityPrivilege).
  Set-AccessOnly $Target $sourceAcl
  if ((Effective-Rules $sourceAcl) -cne (Effective-Rules (Get-Acl -LiteralPath $Target))) {
    throw "Effective permissions differ at $Target; original retained."
  }
}
function Restore-Security([string]$Source,[string]$Target,$Inventory,[string]$AclFile) {
  & icacls.exe $Source /save $AclFile /T /C /Q /L | Out-Host
  if (-not (Test-Path -LiteralPath $AclFile)) { throw 'Security inventory was not produced.' }
  $physical=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($row in $Inventory.Rows) { if($row.Kind -ne 'LINK') { $null=$physical.Add($row.Path) } }
  $prefix=[IO.Path]::GetFileName($Source.TrimEnd('\'))+'\'
  $reader=[IO.File]::ReadLines($AclFile,[Text.Encoding]::Unicode).GetEnumerator()
  $restored=0
  try {
    while($reader.MoveNext()) {
      $path=$reader.Current
      if(-not $reader.MoveNext()) { throw 'Truncated security inventory.' }
      $sddl=$reader.Current
      if (-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { continue }
      $relative=$path.Substring($prefix.Length)
      # Only physical entries inventoried without following links. Never set
      # permissions through a pnpm junction still pointing to original C:.
      if ($physical.Contains($relative) -and ($sddl -match '^D:[^(]*P|\([AD];(?![^;]*ID)')) {
        Copy-EffectiveSecurity (Join-Path $Source $relative) (Join-Path $Target $relative)
        $restored++
      }
    }
  } finally { $reader.Dispose() }
  # Do this last while the outer staging root still blocks other accounts.
  # Individual destination roots remain stable if merged into an existing D:/IA.
  if($Source -ieq 'C:\IA') {
    foreach($name in @('Frota','RPlayout')) {
      Copy-EffectiveSecurity (Join-Path $Source $name) (Join-Path $Target $name)
    }
  } else { Copy-EffectiveSecurity $Source $Target }
  Write-Host "Security restored/verified: $Source, custom physical entries=$restored"
}
function Copy-PhysicalRoot([string]$Source, [string]$Target, [string]$Log, [bool]$Resume=$false) {
  if ((Test-Path -LiteralPath $Target) -and -not $Resume) { throw "Copy target already exists: $Target" }
  if($Resume -and $Target -notmatch '^D:\\RPlayout-migration-[0-9a-f]{32}\\(?:IA|RPlayout)$') { throw 'Resume target outside exact staging root.' }
  Write-Host "Copying $Source to $Target"
  & robocopy.exe $Source $Target /E /COPY:DAT /DCOPY:DAT /SJ /SL /R:1 /W:1 /MT:8 /NP /NFL /NDL "/LOG:$Log" | Out-Host
  $copyCode=$LASTEXITCODE
  if ($copyCode -ge 8 -or (Select-String -LiteralPath $Log -Pattern '\b(?:ERROR|ERRO)\s+[0-9]+\s' -Quiet)) { throw "Robocopy failed ($copyCode). Original retained. See $Log" }
  Write-Host "Copy complete, code=$copyCode. Hashing source and destination."
  $sourceInventory=Read-Inventory $Source -HashFiles
  Restore-Security $Source $Target $sourceInventory ($Log+'.acl.txt')
  $targetInventory=Read-Inventory $Target -HashFiles
  Compare-Inventory $sourceInventory $targetInventory
  $sourceInventory
}
function Remove-VerifiedOriginal([string]$Backup, [string]$ExpectedBackup) {
  Assert-ExactPath $Backup $ExpectedBackup
  if($Backup -notmatch '^C:\\(?:IA|RPlayout)-migration-[0-9a-f]{32}-original$') { throw 'Deletion target not an exact migration backup.' }
  $rootItem=Get-Item -LiteralPath $Backup -Force
  if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Original backup must not be a link.' }
  $base=$rootItem.FullName.TrimEnd('\')
  # Remove links themselves using the .NET non-recursive primitive. Never
  # recurse through node_modules junctions whose targets now point to D:.
  function Clear-OriginalTree([string]$Directory) {
    $absolute=[IO.Path]::GetFullPath($Directory)
    if ($absolute -ine $base -and -not $absolute.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)) {
      throw "Deletion escaped original backup: $absolute"
    }
    foreach ($item in Get-ChildItem -LiteralPath $absolute -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $false) }
        else { [IO.File]::Delete($item.FullName) }
      } elseif ($item.PSIsContainer) {
        Clear-OriginalTree $item.FullName
      } else {
        Remove-Item -LiteralPath $item.FullName -Force
      }
    }
    [IO.Directory]::Delete($absolute, $false)
  }
  Clear-OriginalTree $base
}

if ($Phase -in @('Copy','ResumeCopy')) {
  foreach ($source in @('C:\IA','C:\RPlayout')) { Assert-ExactPath $source $source; $null=Get-Item -LiteralPath $source -Force }
  foreach ($target in @('D:\IA\Frota','D:\IA\RPlayout','D:\RPlayout')) {
    if (Test-Path -LiteralPath $target) { throw "Destination conflict; nothing overwritten: $target" }
  }
  $children=@(Get-ChildItem -LiteralPath 'C:\IA' -Force | Select-Object -ExpandProperty Name)
  if (($children | Sort-Object) -join '|' -ne 'Frota|RPlayout') { throw 'C:/IA changed since preflight; review new children.' }
  if($Phase -eq 'ResumeCopy') {
    if($StagePath -notmatch '^D:\\RPlayout-migration-([0-9a-f]{32})$') { throw 'Invalid resume staging root.' }
    $id=$Matches[1];$stage=$StagePath
    $evidence=Join-Path ([IO.Path]::GetTempPath()) "RPlayout-migration-$id"
    $null=Get-Item -LiteralPath $stage,$evidence
    if(Test-Path -LiteralPath (Join-Path $evidence 'receipt.json')) { throw 'Use Commit for an already verified copy.' }
  } else {
    $id=[guid]::NewGuid().ToString('N')
    $stage="D:\RPlayout-migration-$id"
    $evidence=Join-Path ([IO.Path]::GetTempPath()) "RPlayout-migration-$id"
    New-Item -ItemType Directory -Path $stage,$evidence | Out-Null
  }
  Protect-Staging $stage
  $previewIA=Read-Inventory 'C:\IA'
  $previewInstall=Read-Inventory 'C:\RPlayout'
  $needed=$previewIA.Bytes+$previewInstall.Bytes
  $drive=Get-PSDrive -Name D
  if ($drive.Free -lt $needed+2GB) { throw "Not enough free disk space; need at least $needed bytes + margin." }
  Write-Host "Preflight: IA=$($previewIA.Files) files/$($previewIA.Bytes) bytes; install=$($previewInstall.Files) files/$($previewInstall.Bytes) bytes"
  $ia=Copy-PhysicalRoot 'C:\IA' (Join-Path $stage 'IA') (Join-Path $evidence 'copy-ia.log') ($Phase -eq 'ResumeCopy')
  $install=Copy-PhysicalRoot 'C:\RPlayout' (Join-Path $stage 'RPlayout') (Join-Path $evidence 'copy-install.log') ($Phase -eq 'ResumeCopy')
  $receipt=[pscustomobject]@{Version=1;Id=$id;Stage=$stage;Evidence=$evidence;IA=$ia;Install=$install;CopiedVerified=$true;Committed=$false;OriginalsRemoved=$false;CopiedAt=[DateTime]::UtcNow.ToString('o')}
  $receiptFile=Join-Path $evidence 'receipt.json'
  [IO.File]::WriteAllText($receiptFile,($receipt | ConvertTo-Json -Depth 8))
  Write-Host "COPY_VERIFIED receipt=$receiptFile"
  exit 0
}

if (-not $ReceiptPath) { throw 'Commit requires the verified copy receipt.' }
$receipt=Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
if ($receipt.Version -ne 1 -or -not $receipt.CopiedVerified -or $receipt.Committed -or $receipt.Id -notmatch '^[0-9a-f]{32}$') {
  throw 'Invalid/already committed receipt.'
}
$expectedStage="D:\RPlayout-migration-$($receipt.Id)"
Assert-ExactPath $receipt.Stage $expectedStage
Assert-ExactPath $receipt.IA.Root 'C:\IA'
Assert-ExactPath $receipt.Install.Root 'C:\RPlayout'
foreach ($target in @('D:\IA\Frota','D:\IA\RPlayout','D:\RPlayout')) {
  if (Test-Path -LiteralPath $target) { throw "Commit destination now exists: $target" }
}
# Verify again against retained hashes before changing any source path.
Compare-Inventory $receipt.IA (Read-Inventory 'C:\IA' -HashFiles)
Compare-Inventory $receipt.IA (Read-Inventory (Join-Path $expectedStage 'IA') -HashFiles)
Compare-Inventory $receipt.Install (Read-Inventory 'C:\RPlayout' -HashFiles)
Compare-Inventory $receipt.Install (Read-Inventory (Join-Path $expectedStage 'RPlayout') -HashFiles)
$iaBackup="C:\IA-migration-$($receipt.Id)-original"
$installBackup="C:\RPlayout-migration-$($receipt.Id)-original"
foreach ($backup in @($iaBackup,$installBackup)) { if(Test-Path -LiteralPath $backup){throw 'Original backup path already exists.'} }
New-Item -ItemType Directory -Path 'D:\IA' -Force | Out-Null
Move-Item -LiteralPath (Join-Path $expectedStage 'IA\Frota') -Destination 'D:\IA\Frota'
Move-Item -LiteralPath (Join-Path $expectedStage 'IA\RPlayout') -Destination 'D:\IA\RPlayout'
Move-Item -LiteralPath (Join-Path $expectedStage 'RPlayout') -Destination 'D:\RPlayout'
# Same-volume rename first, original still recoverable if the workspace lock
# prevents it. Recreate compatibility immediately; never stop Codex to force it.
Rename-Item -LiteralPath 'C:\IA' -NewName ([IO.Path]::GetFileName($iaBackup))
try { New-Item -ItemType Junction -Path 'C:\IA' -Target 'D:\IA' | Out-Null }
catch { Rename-Item -LiteralPath $iaBackup -NewName 'IA'; throw }
Rename-Item -LiteralPath 'C:\RPlayout' -NewName ([IO.Path]::GetFileName($installBackup))
try { New-Item -ItemType Junction -Path 'C:\RPlayout' -Target 'D:\RPlayout' | Out-Null }
catch { Rename-Item -LiteralPath $installBackup -NewName 'RPlayout'; throw }
foreach ($pair in @(@('C:\IA','D:\IA'),@('C:\RPlayout','D:\RPlayout'))) {
  $link=Get-Item -LiteralPath $pair[0] -Force
  if ($link.LinkType -ne 'Junction' -or @($link.Target).Count -ne 1 -or $link.Target -ine $pair[1]) { throw 'Compatibility junction verification failed; originals retained.' }
}
$receipt.Committed=$true
$receipt | Add-Member -NotePropertyName IABackup -NotePropertyValue $iaBackup
$receipt | Add-Member -NotePropertyName InstallBackup -NotePropertyValue $installBackup
[IO.File]::WriteAllText($ReceiptPath,($receipt | ConvertTo-Json -Depth 8))
Remove-VerifiedOriginal $iaBackup $iaBackup
Remove-VerifiedOriginal $installBackup $installBackup
$receipt.OriginalsRemoved=$true
[IO.File]::WriteAllText($ReceiptPath,($receipt | ConvertTo-Json -Depth 8))
# Stage has only the now-empty IA directory; only remove non-recursively.
[IO.Directory]::Delete((Join-Path $expectedStage 'IA'),$false)
[IO.Directory]::Delete($expectedStage,$false)
Write-Host "MIGRATION_COMPLETE receipt=$ReceiptPath; bytes moved=$($receipt.IA.Bytes+$receipt.Install.Bytes)"
