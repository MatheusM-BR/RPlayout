# Rodar no Windows

Escrito para uma instalação em `C:\RPlayout`. Ajuste o caminho se você usar
outro.

> Aviso honesto: o sistema foi construído e verificado em Linux. Os elementos
> de GStreamer que ele usa existem na distribuição oficial para Windows, mas
> "existem" não é "eu vi funcionando" — o primeiro passo abaixo serve
> exatamente para transformar uma coisa na outra antes de você perder tempo.

## Conferir o que falta

Antes de instalar na tentativa e erro, pergunte à máquina:

```powershell
cd C:\RPlayout
powershell -ExecutionPolicy Bypass -File scripts\conferir-windows.ps1
```

Ele lista ferramenta por ferramenta -- presente ou faltando, para que serve e o
comando que instala. Instalou alguma coisa? Feche e reabra o PowerShell (o
`PATH` só vale para janelas novas) e rode de novo.

## O que instalar

| O quê | Versão | Onde |
|---|---|---|
| Node | 22 ou mais novo | nodejs.org |
| pnpm | 10 | `corepack enable` já resolve |
| Rust | estável, toolchain **MSVC** | `winget install Rustlang.Rustup` |
| GStreamer | 1.24+, **runtime e development**, instalação *Complete* | gstreamer.freedesktop.org/download |
| MediaMTX | binário do Windows | github.com/bluenviron/mediamtx/releases |
| Plugin NDI | opcional, só se você for usar NDI | teltek/gst-plugin-ndi |

O Rust no Windows compila com o linker da Microsoft: se o `cargo build` falhar
dizendo que não achou `link.exe`, faltam as ferramentas de C++
(`winget install Microsoft.VisualStudio.2022.BuildTools`, marcando *Desktop
development with C++*). O instalador do rustup costuma oferecer isso sozinho.

Instale os **dois** pacotes MSI do GStreamer (runtime *e* development) e escolha
*Complete*. Faltando o development, o `cargo build` não acha as bibliotecas;
faltando *Complete*, faltam plugins que só dão erro na hora do ar.

Depois, em PowerShell **como administrador** (vale para o sistema inteiro):

```powershell
[Environment]::SetEnvironmentVariable('GSTREAMER_1_0_ROOT_MSVC_X86_64', 'C:\gstreamer\1.0\msvc_x86_64\', 'Machine')
[Environment]::SetEnvironmentVariable('PKG_CONFIG_PATH', 'C:\gstreamer\1.0\msvc_x86_64\lib\pkgconfig', 'Machine')
$path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
[Environment]::SetEnvironmentVariable('Path', "$path;C:\gstreamer\1.0\msvc_x86_64\bin", 'Machine')
```

Feche e reabra o PowerShell. O `cargo build` do engine precisa do
`pkg-config` no caminho; se ele reclamar de não achar `gstreamer-1.0`, é isto
que está faltando (`winget install pkgconfiglite` costuma resolver).

## Construir

```powershell
cd C:\RPlayout
pnpm install
cd apps\engine
cargo build --release
cd C:\RPlayout
```

## Conferir a máquina antes de qualquer outra coisa

```powershell
.\apps\engine\target\release\rplayout-devices.exe
```

A resposta é uma linha de JSON com três coisas:

- `plugins.missing` — o que o canal **precisa** e não está instalado. Tem de
  vir vazio. Cada entrada diz o elemento, de qual pacote ele vem e o que deixa
  de funcionar sem ele.
- `plugins.optional` — o que o canal dispensa, com menos recursos: grafismo,
  SRT, saída entrelaçada, Decklink, NDI.
- `decklink` e `ndi` — o que existe de fonte ao vivo na máquina, e o motivo
  quando não existe nada. "Sem placa" e "sem driver" são situações diferentes,
  e a resposta diz qual das duas é.

Resolver o que aparecer aqui é mais barato do que descobrir no ar: elemento que
falta só se manifesta quando o caminho dele é exercitado — a gravação que morre
no primeiro take, a saída SRT que nunca conecta — e aí a causa está longe do
sintoma.

## Semear e subir

```powershell
cd C:\RPlayout

# um canal e uma grade vazia; o acervo vem da sua pasta, lido pela varredura
$env:RPLAYOUT_MEDIA_DIR = 'C:\RPlayout\midia'
pnpm --filter @rplayout/server seed

# servidor, com engine, sonda, descoberta e servidor de mídia local
$env:RPLAYOUT_ENGINE   = 'C:\RPlayout\apps\engine\target\release\rplayout-engine.exe'
$env:RPLAYOUT_PROBE    = 'C:\RPlayout\apps\engine\target\release\rplayout-probe.exe'
$env:RPLAYOUT_DEVICES  = 'C:\RPlayout\apps\engine\target\release\rplayout-devices.exe'
$env:RPLAYOUT_RELAY    = 'C:\RPlayout\apps\engine\target\release\rplayout-relay.exe'
$env:RPLAYOUT_MEDIAMTX = 'C:\RPlayout\mediamtx\mediamtx.exe'
$env:RPLAYOUT_MEDIA    = 'C:\RPlayout\midia'
pnpm --filter @rplayout/server dev
```

Noutra janela:

```powershell
cd C:\RPlayout
pnpm --filter @rplayout/web dev
```

A interface abre em <http://localhost:5173>.

Se você semeou com a pasta apontada, a grade nasce vazia: clique em **LER
PASTA** para o acervo ser lido do disco -- duração, loudness e miniatura de cada
arquivo -- e monte a grade com **inserir item** ou **montar**. Semear doze nomes
inventados produziria uma grade bonita em que nenhum item toca, e você só
descobriria no primeiro take.

Sem `RPLAYOUT_MEDIA_DIR`, o seed cria um acervo de demonstração com loudness
deliberadamente desigual: serve para ver a interface funcionando antes de ter
material, e nenhum daqueles arquivos existe em disco.

E se o banco estiver vazio -- sem seed nenhum --, a interface abre pedindo o
nome do primeiro canal, em vez de ficar carregando para sempre.

## Em produção, com a interface na mesma porta

O bloco acima é desenvolvimento: dois processos, e o `vite` não é feito para
ficar meses no ar. Para operar de verdade, construa a interface uma vez -- o
servidor passa a servi-la:

```powershell
cd C:\RPlayout
pnpm build

$env:RPLAYOUT_ENGINE   = 'C:\RPlayout\apps\engine\target\release\rplayout-engine.exe'
$env:RPLAYOUT_PROBE    = 'C:\RPlayout\apps\engine\target\release\rplayout-probe.exe'
$env:RPLAYOUT_DEVICES  = 'C:\RPlayout\apps\engine\target\release\rplayout-devices.exe'
$env:RPLAYOUT_RELAY    = 'C:\RPlayout\apps\engine\target\release\rplayout-relay.exe'
$env:RPLAYOUT_MEDIAMTX = 'C:\RPlayout\mediamtx\mediamtx.exe'
$env:RPLAYOUT_MEDIA    = 'C:\RPlayout\midia'
pnpm start
```

A tela abre em <http://localhost:4000> -- ou pelo IP da máquina, de outro
computador da rede. Repetir `pnpm build` só é necessário quando a interface
mudar.

### Subir sozinho quando a máquina ligar

Sem instalar nada, pelo Agendador de Tarefas. Crie `C:\RPlayout\subir.cmd`:

```bat
@echo off
cd /d C:\RPlayout
set RPLAYOUT_ENGINE=C:\RPlayout\apps\engine\target\release\rplayout-engine.exe
set RPLAYOUT_PROBE=C:\RPlayout\apps\engine\target\release\rplayout-probe.exe
set RPLAYOUT_DEVICES=C:\RPlayout\apps\engine\target\release\rplayout-devices.exe
set RPLAYOUT_RELAY=C:\RPlayout\apps\engine\target\release\rplayout-relay.exe
set RPLAYOUT_MEDIAMTX=C:\RPlayout\mediamtx\mediamtx.exe
set RPLAYOUT_MEDIA=C:\RPlayout\midia
pnpm start
```

e uma tarefa que o execute **ao iniciar o computador**, com "executar mesmo sem
usuário conectado" e "reiniciar em caso de falha". O canal anda com ou sem
navegador aberto: fechar a tela não para a programação.

## Firewall

O Windows vai perguntar na primeira publicação. Libere **4000** (a interface e a
API, se outro computador da rede for abrir a tela), **1935** (RTMP, onde os
convidados publicam), **8890/udp** (SRT) e **8889** (WebRTC, que é como os
monitores da interface recebem imagem). Não libere **9997** nem **8554**: são a
API de controle e o RTSP interno, ficam em loopback de propósito.

`RPLAYOUT_MEDIAMTX_BIND` escolhe a interface de rede. O painel de distribuição
avisa em vermelho quando o servidor está exposto em todas.

## Se alguma coisa não subir

- **`cargo build` não acha `gstreamer-1.0`** — falta o MSI de *development*, o
  `PKG_CONFIG_PATH`, ou o `pkg-config`.
- **O canal sobe e o programa fica preto** — rode `rplayout-devices.exe` e olhe
  `plugins.missing`.
- **A saída não conecta** — `RPLAYOUT_MEDIAMTX_LOGLEVEL=info` faz o servidor de
  mídia dizer *por que* recusou; é a única fonte que explica publicação
  recusada.
- **Placa não aparece** — `decklink.available` diz se o driver respondeu. Driver
  presente com lista vazia é placa não instalada ou sem sinal; driver ausente é
  o plugin da Decklink faltando na instalação do GStreamer.
