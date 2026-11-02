# Confere o que o RPlayout precisa nesta máquina Windows.
#
# Cada item diz o que é, se está presente e como instalar. Descobrir tudo de
# uma vez custa segundos; descobrir um por vez custa uma tarde.
#
#   powershell -ExecutionPolicy Bypass -File scripts\conferir-windows.ps1

$faltando = 0

function Conferir($nome, $comando, $paraQue, $instalar) {
    $achou = Get-Command $comando -ErrorAction SilentlyContinue
    if ($achou) {
        $versao = ''
        try { $versao = (& $comando --version 2>&1 | Select-Object -First 1) } catch { }
        Write-Host ("  OK    {0,-12} {1}" -f $nome, $versao) -ForegroundColor Green
    } else {
        Write-Host ("  FALTA {0,-12} {1}" -f $nome, $paraQue) -ForegroundColor Red
        Write-Host ("        instalar: {0}" -f $instalar) -ForegroundColor DarkGray
        $script:faltando++
    }
}

Write-Host ''
Write-Host 'Ferramentas' -ForegroundColor Cyan
Conferir 'node'  'node'  'roda o servidor e a interface' 'winget install OpenJS.NodeJS.LTS'
Conferir 'pnpm'  'pnpm'  'gerenciador de pacotes'        'corepack enable pnpm'
Conferir 'git'   'git'   'baixar e atualizar o projeto'  'winget install Git.Git'
Conferir 'cargo' 'cargo' 'compila o engine de vídeo'     'winget install Rustlang.Rustup'

Write-Host ''
Write-Host 'GStreamer' -ForegroundColor Cyan
$raiz = $env:GSTREAMER_1_0_ROOT_MSVC_X86_64
if (-not $raiz) { $raiz = 'C:\gstreamer\1.0\msvc_x86_64\' }

if (Test-Path (Join-Path $raiz 'bin\gst-launch-1.0.exe')) {
    Write-Host ("  OK    runtime      {0}" -f $raiz) -ForegroundColor Green
} else {
    Write-Host '  FALTA runtime      sem ele o engine não roda' -ForegroundColor Red
    Write-Host '        baixe gstreamer-1.0-msvc-x86_64-<versao>.msi em gstreamer.freedesktop.org/download' -ForegroundColor DarkGray
    Write-Host '        e escolha a instalacao Complete -- a tipica deixa plugins de fora' -ForegroundColor DarkGray
    $faltando++
}

$pkgconfig = Join-Path $raiz 'lib\pkgconfig'
$binario = Join-Path $raiz 'bin'

if (Test-Path (Join-Path $pkgconfig 'gstreamer-1.0.pc')) {
    Write-Host ("  OK    development  {0}" -f $pkgconfig) -ForegroundColor Green
} else {
    Write-Host '  FALTA development  sem ele o cargo build nao compila' -ForegroundColor Red
    Write-Host '        baixe gstreamer-1.0-devel-msvc-x86_64-<versao>.msi, mesma versao e mesma pasta' -ForegroundColor DarkGray
    $faltando++
}

# O `pkg-config` costuma vir dentro do próprio GStreamer. Quando vem, o que
# falta é PATH, não instalação -- e mandar instalar de novo seria mentira.
if (Get-Command 'pkg-config' -ErrorAction SilentlyContinue) {
    Write-Host '  OK    pkg-config   o cargo acha o GStreamer por ele' -ForegroundColor Green
} elseif (Test-Path (Join-Path $binario 'pkg-config.exe')) {
    Write-Host ("  quase pkg-config   existe em {0}, falta so o PATH abaixo" -f $binario) -ForegroundColor Yellow
} else {
    Write-Host '  FALTA pkg-config   o cargo acha o GStreamer por ele' -ForegroundColor Red
    Write-Host '        procure o pacote: winget search pkg-config' -ForegroundColor DarkGray
    Write-Host '        ou: choco install pkgconfiglite   /   scoop install pkg-config' -ForegroundColor DarkGray
    $faltando++
}

Write-Host ''
Write-Host 'Variaveis de ambiente' -ForegroundColor Cyan
$variaveis = [ordered]@{
    'GSTREAMER_1_0_ROOT_MSVC_X86_64' = $raiz
    'PKG_CONFIG_PATH'                = $pkgconfig
}
$semVariavel = $false
foreach ($variavel in $variaveis.Keys) {
    if ([Environment]::GetEnvironmentVariable($variavel)) {
        Write-Host ("  OK    {0}" -f $variavel) -ForegroundColor Green
    } else {
        Write-Host ("  FALTA {0}" -f $variavel) -ForegroundColor Red
        $semVariavel = $true
        $faltando++
    }
}

if ($semVariavel -or (Test-Path (Join-Path $binario 'pkg-config.exe'))) {
    Write-Host ''
    Write-Host '        Cole num PowerShell aberto como administrador --' -ForegroundColor DarkGray
    Write-Host '        no Prompt de Comando (cmd) esta sintaxe nao funciona:' -ForegroundColor DarkGray
    foreach ($variavel in $variaveis.Keys) {
        if (-not [Environment]::GetEnvironmentVariable($variavel)) {
            Write-Host ("        [Environment]::SetEnvironmentVariable('{0}', '{1}', 'Machine')" -f $variavel, $variaveis[$variavel]) -ForegroundColor DarkGray
        }
    }
    Write-Host "        `$p = [Environment]::GetEnvironmentVariable('Path','Machine')" -ForegroundColor DarkGray
    Write-Host ("        [Environment]::SetEnvironmentVariable('Path', `"`$p;{0}`", 'Machine')" -f $binario) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Opcional' -ForegroundColor Cyan
$mediamtx = Join-Path $PSScriptRoot '..\mediamtx\mediamtx.exe'
if (Test-Path $mediamtx) {
    Write-Host '  OK    mediamtx     servidor de midia local' -ForegroundColor Green
} else {
    Write-Host '  falta mediamtx     sem ele nao ha RTMP interno nem monitores na tela' -ForegroundColor Yellow
    Write-Host '        baixe de github.com/bluenviron/mediamtx/releases para C:\RPlayout\mediamtx\' -ForegroundColor DarkGray
}

Write-Host ''
if ($faltando -eq 0) {
    Write-Host 'Tudo no lugar. Proximo passo:' -ForegroundColor Green
    Write-Host '  pnpm install'
    Write-Host '  cd apps\engine; cargo build --release; cd ..\..'
    Write-Host '  pnpm build'
    Write-Host ''
    Write-Host 'Depois de compilar, confira os plugins do GStreamer:' -ForegroundColor Cyan
    Write-Host '  .\apps\engine\target\release\rplayout-devices.exe'
} else {
    Write-Host ("Faltam {0} itens. Instale, feche e reabra o PowerShell, e rode de novo." -f $faltando) -ForegroundColor Yellow
}
Write-Host ''
