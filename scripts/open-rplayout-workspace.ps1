param([ValidateSet('master','operator','playlist','users','monitor','aired','audit','qc','docs')][string]$Workspace = 'master', [string]$BaseUrl = 'http://localhost:4000')
$url = if ($Workspace -in @('master','operator')) { $BaseUrl } else { "$BaseUrl/?workspace=$Workspace" }
Start-Process $url
