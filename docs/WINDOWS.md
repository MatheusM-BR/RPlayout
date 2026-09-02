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
| pkg-config | qualquer | costuma vir com o GStreamer; senão `winget search pkg-config` |
| GStreamer | 1.24+, **runtime e development**, instalação *Complete*, MSVC | gstreamer.freedesktop.org/download |
| MediaMTX | binário do Windows | github.com/bluenviron/mediamtx/releases |
| Plugin NDI | opcional, só se você for usar NDI | teltek/gst-plugin-ndi |

O Rust no Windows compila com o linker da Microsoft: se o `cargo build` falhar
dizendo que não achou `link.exe`, faltam as ferramentas de C++
(`winget install Microsoft.VisualStudio.2022.BuildTools`, marcando *Desktop
development with C++*). O instalador do rustup costuma oferecer isso sozinho.

**MSVC, não MinGW.** A página de download oferece as duas famílias. O Rust no
Windows usa o toolchain `x86_64-pc-windows-msvc` por padrão e o engine linka
contra as bibliotecas do GStreamer: biblioteca MinGW não linka com toolchain
MSVC, e o erro só aparece no fim da compilação, como símbolo não resolvido --
longe da causa. Confira com `rustc -vV`: a linha `host:` tem de terminar em
`-msvc`. O instalador MinGW também define outra variável de ambiente
(`GSTREAMER_1_0_ROOT_MINGW_X86_64`), que o build não procura.

Instale os **dois** pacotes MSI do GStreamer (runtime *e* development) e escolha
*Complete*. Faltando o development, o `cargo build` não acha as bibliotecas;
faltando *Complete*, faltam plugins que só dão erro na hora do ar.

Depois, em **PowerShell como administrador** -- no Prompt de Comando esta
sintaxe não existe, e o erro que aparece é "a sintaxe do nome do arquivo está
incorreta", que não ajuda ninguém. Troque o caminho se o instalador tiver posto
o GStreamer noutro lugar (em Program Files, por exemplo): o conferidor imprime
os comandos já com a pasta que achou na sua máquina.

```powershell
$gst = 'C:\gstreamer\1.0\msvc_x86_64'
[Environment]::SetEnvironmentVariable('GSTREAMER_1_0_ROOT_MSVC_X86_64', "$gst\", 'Machine')
[Environment]::SetEnvironmentVariable('PKG_CONFIG_PATH', "$gst\lib\pkgconfig", 'Machine')
$path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
[Environment]::SetEnvironmentVariable('Path', "$path;$gst\bin", 'Machine')
```

Não use `setx` para o `Path`: ele corta em 1024 caracteres e destrói o que
estava lá.

O `pkg-config` costuma vir dentro do próprio GStreamer, em `bin`. Se vier, o
comando de `Path` acima já resolve e não há o que instalar. Se não vier,
`winget search pkg-config` mostra o pacote disponível na sua máquina --
`choco install pkgconfiglite` e `scoop install pkg-config` também servem.

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

### Um clique para pôr no ar

O `cargo build --release` produz, junto com o engine, um lançador:

```
C:\RPlayout\apps\engine\target\release\rplayout.exe
```

Ele descobre a instalação a partir de onde está, sobe o servidor com os
caminhos certos, espera a porta responder e abre a interface no navegador. A
janela que fica aberta é o log do servidor -- é onde aparece por que uma saída
caiu ou um arquivo não abriu --, e fechá-la tira o RPlayout do ar.

Copie para a raiz e faça um atalho na área de trabalho:

```powershell
Copy-Item apps\engine\target\release\rplayout.exe C:\RPlayout\
```

O que não existir na instalação ele avisa e segue sem: sem `mediamtx.exe` não
há RTMP interno nem monitores, sem a sonda não há leitura de acervo. E se a
interface não tiver sido construída, ele diz para rodar `pnpm build` em vez de
subir pela metade.

Continua valendo definir `RPLAYOUT_MEDIA` antes, se a sua pasta de vídeos não
for `C:\RPlayout\midia` -- o lançador respeita o que já estiver definido.

### Subir sozinho quando a máquina ligar

Sem instalar nada, pelo Agendador de Tarefas: uma tarefa que execute
`C:\RPlayout\rplayout.exe` **ao iniciar o computador**, com "iniciar em"
apontando para `C:\RPlayout`, "executar mesmo sem usuário conectado" e
"reiniciar em caso de falha".

Se a sua pasta de vídeos não for `C:\RPlayout\midia`, defina `RPLAYOUT_MEDIA`
como variável de sistema (o lançador respeita o que já existir).

O canal anda com ou sem navegador aberto: fechar a tela não para a programação
-- o que para é fechar a janela do lançador.

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
