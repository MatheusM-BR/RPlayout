param([ValidateSet('operator','playlist','admin','monitor')][string]$Workspace = 'operator', [string]$BaseUrl = 'http://localhost:4000')
$url = if ($Workspace -eq 'operator') { $BaseUrl } else { "$BaseUrl/?workspace=$Workspace" }
Start-Process $url
