$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'install-rplayout-partial.ps1'
$parseTokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$parseTokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Erro de sintaxe no instalador'}
foreach($name in @('Get-RPlayoutInstallRequiredBytes','Assert-RPlayoutInstallCapacity')){
  $functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
  if($functions.Count -ne 1){throw 'Funcao de capacidade nao identificada unicamente'}
  # Evaluate only our arithmetic functions, never the installer entry point.
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
$required=Get-RPlayoutInstallRequiredBytes 1GB 1000
if($required -ne (1GB+1000*64KB+256MB)){throw 'Orcamento de espaco incorreto'}
Assert-RPlayoutInstallCapacity $required $required
$refused=$false
try{Assert-RPlayoutInstallCapacity $required ($required-1)}catch{$refused=$true}
if(!$refused){throw 'Aceitou espaco insuficiente'}
foreach($invalid in @(@(-1,1),@(1,0),@(1,100001))){
  $refused=$false
  try{Get-RPlayoutInstallRequiredBytes $invalid[0] $invalid[1]|Out-Null}catch{$refused=$true}
  if(!$refused){throw 'Aceitou estimativa invalida'}
}
Write-Output 'PASS: estimativa, limite exato, insuficiencia e entradas invalidas; nenhuma instalacao executada.'
