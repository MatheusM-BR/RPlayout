# RPlayout — Plano de Arquitetura e Roadmap

Sistema de playout de TV/streaming com rundown por horário, grafismo em camada,
entradas NDI/SRT/RTMP e saídas RTMP/SRT com servidor interno para convidados.

## Decisões travadas

| Tema | Decisão |
|---|---|
| Plataforma alvo | Windows (NDI nativo, NVENC, Decklink) |
| Motor de vídeo | GStreamer (compositor + input-selector + webrtcbin) |
| Interface | Web (backend serve a UI; vários operadores simultâneos) |
| Canais | Multicanal desde o início (`channel_id` em todo o modelo) |
| Grafismo | Camada CEF com templates HTML + editor por formulário |
| Hardware SDI | Decklink Duo 2 / Quad 2 — entrada **e** saída, placa como clock mestre |
| Servidor interno | MediaMTX local na máquina (RTMP/SRT/HLS/WebRTC, ingest e distribuição) |
| Automação | Motor de regras determinístico; Claude como camada opcional |
| Primeira entrega | UI + scheduler com mídia simulada |

## 1. Stack e estrutura do monorepo

pnpm workspaces + TypeScript estrito.

```
rplayout/
  apps/
    server/          Node 22 + Fastify + WS. SQLite (better-sqlite3) + Drizzle.
                     Dono do estado, do scheduler e do ciclo de vida dos engines.
    web/             React + Vite + Tailwind + Zustand + TanStack Query.
    engine/          Rust + gstreamer-rs. Um processo por canal.
                     JSON-RPC sobre stdio/named pipe. Sem estado próprio.
  packages/
    protocol/        Schemas zod compartilhados (server <-> web <-> engine).
    scheduler/       Motor de tempo puro, sem I/O. 100% testável.
    graphics/        Runtime de templates HTML + biblioteca padrão.
    media/           Ingest de assets, ffprobe, thumbnails, waveform, hash.
  services/
    mediamtx/        Binário + geração de config a partir do banco.
```

Por que Rust no engine: `gstreamer-rs` são os bindings oficiais e maduros, o
binário roda sem runtime no Windows, e um crash de pipeline derruba um canal,
não o servidor inteiro. O server supervisiona e reinicia.

## 2. Engine de vídeo (por canal)

### Pipeline PGM

```
[VT A]  filesrc → decodebin ┐
[VT B]  filesrc → decodebin ┤
[SDI]   decklinkvideosrc    ├→ videoconvert → videoscale → videorate
[NDI]   ndisrc              ┤   → caps do canal (1920x1080, 50fps, I420)
[SRT]   srtsrc → tsdemux    ┤   → queue
[RTMP]  rtmp2src            ┤
[SLATE] videotestsrc        ┘
                              ↓
                          compositor (ou glvideomixer)
                              ├ pad 0: fundo / fonte no ar
                              ├ pad 1: camada de grafismo (CEF offscreen, BGRA)
                              └ pad 2: bug/logo permanente
                              ↓
                          tee ─┬→ decklinkvideosink              (PGM em SDI, sem encode)
                               ├→ nvh264enc → flvmux → rtmp2sink  (MediaMTX local, loopback)
                               ├→ (sem a camada de GC) → clean feed
                               ├→ (baixo bitrate) → webrtcbin     (multiview UI)
                               └→ matroskamux → filesink          (gravação as-run)

Áudio: audiomixer + volume por camada + level (VU na UI) → 48kHz stereo
```

**Sem gap na troca:** duas cadeias de player (A/B). O item N toca enquanto o
item N+1 já está aberto, decodificado e pausado no primeiro frame do `trimIn`.
O take só muda a opacidade/seleção dos pads do compositor — o encoder nunca para.

### Pipeline de preview (independente)

Segundo pipeline, leve: `decodebin → scale 640x360 → vp8enc → webrtcbin`.
Abre qualquer item ou fonte ao vivo **sem tocar no PGM**, com scrub, marcação
I/O ao vivo e áudio em dispositivo de saída separado (fone do operador).

### Protocolo de controle

Comandos: `load`, `cue`, `take`, `stopAt`, `setTrim`, `preview.open/seek/close`,
`gfx.play/stop/update`, `output.start/stop`, `source.list`.
Eventos: `position` (cada 100ms, em frames), `eos`, `state`, `error`, `levels`,
`sourceStatus`.

### Relógio

Posições e durações sempre em **frames**, nunca em milissegundos — evita drift
acumulado. Timecode `HH:MM:SS:FF` no frame rate do canal. Relógio do canal
sincronizado por NTP. Takes com hora crítica são pré-agendados no engine
(`take item X em T`) para não depender da latência do IPC.

## 3. Modelo do rundown

### Item

```ts
type RundownItem = {
  id: string
  channelId: string
  order: number
  type: 'VT' | 'LIVE' | 'GFX' | 'SLATE' | 'BLOCK' | 'COMMERCIAL'
  mediaId?: string            // asset local
  sourceRef?: string          // NDI / SRT / RTMP
  trimIn: number              // frames, sobre o asset
  trimOut: number
  duration: number            // trimOut - trimIn (ou duração da janela, se LIVE)

  anchor: Anchor
  onOverrun: 'TRIM_PREV' | 'DROP_FILLER' | 'PUSH' | 'SKIP'
  fillerPolicy?: { categoryId: string; minDuration: number }

  scheduledStart: number      // calculado pelo scheduler
  actualStart?: number
  actualEnd?: number

  loop: boolean
  autoNext: boolean           // false = segura no último frame, take manual
  holdAtEnd: boolean
}
```

### Âncoras de tempo

| Âncora | Comportamento |
|---|---|
| `FLOW` | Entra quando o anterior termina. Padrão. |
| `FIXED` | Hora obrigatória (20:00:00:00). O scheduler tem que respeitar. |
| `SOFT` | Hora alvo com tolerância (`20:00 ±90s`). Escolhe o melhor ponto na janela. |
| `WINDOW` | Pode entrar em qualquer momento entre T1 e T2. |

É a âncora `SOFT`/`WINDOW` que atende ao pedido de "variação de horário para
uma melhor seleção": o item tem prioridade e tolerância, e o motor otimiza.

## 4. Motor de remanejamento (`packages/scheduler`)

Função pura, determinística, sem I/O:

```ts
resolve(items, now, channelState) → {
  items: ItemComHorario[]
  conflicts: Conflict[]        // o que não coube, e por quê
  suggestions: Suggestion[]    // o que o operador pode fazer
}
```

Algoritmo:

1. Propaga horários a partir do item no ar (ou do início da grade).
2. Ao encontrar um `FIXED`/`SOFT`, calcula `delta = horaAlvo - horaProjetada`:
   - **delta > 0 (sobra tempo):** insere filler pela `fillerPolicy`, ou estica um
     item elástico (loop de vinheta), ou expande o slate de intervalo.
   - **delta < 0 (falta tempo):** aplica `onOverrun` em cascata para trás,
     respeitando os limites mínimos de cada item (nunca corta abaixo do
     `minDuration` declarado).
3. Para `SOFT`/`WINDOW`, escolhe dentro da janela o ponto que minimiza
   `Σ |desvio| × prioridade` — otimização local com backtracking limitado.
4. O que não fecha vira `Conflict`, marcado em vermelho na UI, com a explicação
   em texto ("Bloco 3 estoura 47s no FIXED das 20:00; nenhum item anterior tem
   margem de corte").

Recalcula em: edição de item, drift do item no ar (a cada tick de 1s), take
manual, mudança de trim, entrada/saída de fonte ao vivo.

Suíte de testes com cenários reais: atraso de 40s, VT que acabou antes, live que
estourou, FIXED impossível, dois FIXED em sequência apertada, filler insuficiente.

## 5. Trim in/out e escopo de aplicação

Assets identificados por `contentHash` (SHA-256) + `mediaId`, então o mesmo
arquivo é reconhecido mesmo renomeado ou em pasta diferente.

Editor: preview com scrub, teclas `I` / `O`, shuttle `J`/`K`/`L`, campos de
timecode, ajuste de ±1 frame, waveform para achar o corte no áudio.
Detecção automática de black/silence nas pontas sugere os pontos.

Ao salvar, o diálogo oferece três escopos:

| Escopo | Grava em | Efeito |
|---|---|---|
| Só este item | `rundown_item.trim_in/out` | Não afeta mais nada. |
| Todos deste arquivo | todos os itens com o mesmo `mediaId` | Neste rundown ou em todos. |
| Padrão do asset | `media_asset.default_trim_in/out` | Todo item novo já nasce cortado. |

Precedência: **item > padrão do asset > arquivo inteiro**. A UI mostra um badge
indicando de onde veio o trim atual e um botão "reverter para o padrão".

## 6. Grafismo

- Camada CEF offscreen por canal, alfa premultiplicado, no frame rate do canal.
- Templates HTML com a API `update(data)` / `play()` / `stop()` / `next()`
  (deliberadamente compatível com o padrão CasparCG).
- Cada template tem um `manifest.json`: campos, tipos, defaults, duração
  sugerida, safe area. O editor gera o formulário a partir dele.
- Biblioteca inicial: lower-third, crédito, relógio/hora certa, bug/logo,
  cronômetro e countdown, selo AO VIVO, crawl/ticker, placar, próximos no ar,
  slate de intervalo.
- Disparo: manual (botão ou `F1`–`F12`), automático amarrado a um item
  (`+00:05 do início, dura 8s`), ou permanente por regra (bug sempre no ar).
- Rundown de grafismo paralelo ao rundown de vídeo, com as mesmas âncoras.

## 7. Hardware SDI (Decklink)

### Modelo de dispositivo

Duo 2 e Quad 2 não são "uma placa, uma entrada": são 4 ou 8 conectores
independentes, cada um configurado como entrada **ou** saída pelo perfil da placa
no Desktop Video. O modelo de dados precisa enxergar o **sub-dispositivo**, nunca
só o índice da placa:

```ts
type DecklinkDevice = {
  id: string
  cardIndex: number          // placa física
  subDeviceIndex: number      // é o device-number do GStreamer
  label: string               // "Quad 2 — SDI 3"
  direction: 'IN' | 'OUT' | 'UNSET'
  connection: 'SDI' | 'HDMI' | 'OPTICAL' | 'COMPONENT' | 'COMPOSITE'
  profile: string             // perfil half/full duplex lido do driver
  capabilities: { maxMode: string; keyAndFill: boolean; timecode: boolean }
}

type ChannelIoBinding = {
  channelId: string
  role: 'INPUT' | 'PROGRAM_OUT' | 'CLEAN_OUT'
  deviceId: string
  mode: string                // 1080i59.94, 1080p50, 720p59.94, auto
  audioChannels: 2 | 8 | 16
}
```

O servidor é dono da **alocação exclusiva**: dois canais nunca pegam o mesmo
sub-dispositivo, e o conflito aparece na interface antes de virar erro de pipeline.
O perfil da placa (half-duplex vs full-duplex) é **lido**, nunca alterado pelo app —
mudar perfil derruba todos os conectores da placa e isso não pode acontecer no ar.

### Orçamento de conectores

Em half-duplex cada conector é entrada **ou** saída, então um canal com SDI de
entrada + PGM em SDI consome **dois** conectores. Isso amarra direto no multicanal:

| Placa | Conectores | Canais com SDI in + out |
|---|---|---|
| DeckLink Duo 2 | 4 | 2 |
| DeckLink Quad 2 | 8 | 4 |

A interface mostra o orçamento de conectores como um mapa da placa, com o que está
livre, o que está alocado e para qual canal.

### Elementos e pipeline

- Entrada: `decklinkvideosrc` + `decklinkaudiosrc` (`device-number`, `connection=sdi`,
  `mode=auto` para detecção automática de formato).
- Saída: `decklinkvideosink` + `decklinkaudiosink` pendurados no mesmo `tee` do PGM,
  sem passar por encoder — SDI sai em vídeo não comprimido.
- Áudio embedded: 2, 8 ou 16 canais, com mapa de quais pares SDI entram no mix.

### A placa vira o relógio do canal

Esta é a mudança mais importante que a Decklink traz. Com saída SDI ativa, o
`decklinkvideosink` fornece o clock do pipeline e o canal inteiro passa a correr no
relógio da placa, não no relógio do sistema. Hierarquia:

1. Canal com saída Decklink → **clock da placa** é o mestre.
2. Canal sem saída Decklink → clock do sistema, sincronizado por NTP.

Em multicanal, se todas as placas estiverem genlockadas na mesma referência
(black burst ou tri-level), os canais ficam em fase entre si. Sem genlock, cada canal
corre no seu próprio cristal e a interface avisa que eles vão derivar entre si.

### Detecção de sinal e timecode

- Perda de sinal na entrada emite `sourceStatus: NO_SIGNAL` em até um frame; o canal
  cai para slate ou para a fonte de fallback configurada, sem derrubar o pipeline.
- Mudança de formato na entrada (1080i59.94 → 1080p50) é detectada e reportada; o
  conversor de formato absorve, mas o operador é avisado.
- Timecode LTC/VITC embutido no SDI é lido e gravado no as-run log — é o que permite
  amarrar o playout ao relógio da casa.

**Key e fill** ficam fora do escopo inicial: exigem dois conectores de saída
genlockados só para o grafismo. As capabilities já são lidas do driver, então quando
fizer sentido é só mais um `role` no binding.

## 8. Rede, servidor RTMP local e distribuição

### Entradas e saídas

| Direção | Protocolos |
|---|---|
| Entrada | SDI/HDMI (Decklink) · NDI com discovery na rede · SRT listener e caller · RTMP · arquivo · slate |
| Saída | SDI (Decklink) · RTMP · SRT · HLS · WebRTC · gravação local |

### O RTMP nasce na própria máquina

O MediaMTX roda como serviço Windows, subido e supervisionado pelo servidor, com a
config gerada a partir do banco. **O engine publica o PGM no servidor local por
loopback** (`rtmp2sink location=rtmp://127.0.0.1:1935/ch1`) e nunca fala com a
internet diretamente.

```
                 rtmp://127.0.0.1:1935/ch1          (loopback, sem rede)
engine ch1 ─────────────────────────────────► MediaMTX local
                                                   │
                        ┌──────────────────────────┼──────────────────────────┐
                        │                          │                          │
                  quem se conecta            relay supervisionado        ingest de
                  na LAN puxa                (ffmpeg -c copy)            convidado
                        │                          │                          │
        rtmp://IP:1935/ch1                  YouTube / Facebook       rtmp://IP:1935/
        srt://IP:8890?streamid=ch1          destino do cliente        guest/<chave>
        http://IP:8888/ch1  (HLS)           backup SRT                     │
        http://IP:8889/ch1  (WebRTC)                                       ▼
                                                                  vira fonte no switcher
```

Portas padrão: RTMP 1935, RTMPS 1936, SRT 8890/udp, HLS 8888, WebRTC/WHEP 8889,
API de controle 9997 (só em loopback).

### Um encode, N destinos

Isto **revisa** o desenho anterior, em que o engine abria um `rtmp2sink` por destino.
Agora o engine codifica uma vez e publica uma vez; o fan-out para destinos externos é
feito por um processo de relay por destino (`ffmpeg -c copy`, sem recodificar),
supervisionado pelo servidor e puxando do MediaMTX local.

Ganho concreto: o YouTube cair, engasgar ou rejeitar a chave **não toca no encoder**,
não afeta os outros destinos e não afeta a saída SDI. O relay reconecta sozinho com
backoff exponencial e o estado de cada destino aparece na interface separadamente.

### Caminhos por canal

| Caminho | Conteúdo |
|---|---|
| `/ch1` | PGM completo, com grafismo |
| `/ch1/clean` | Clean feed, sem grafismo (segundo pad do `tee`) |
| `/guest/<chave>` | Ingest de convidado, vira fonte no switcher |

### Convidados e credenciais

- Chave de stream por convidado, criada na interface e revogável na hora.
- Autenticação interna do MediaMTX; a config é regerada e recarregada pela API em
  `/v3/config/global/patch`, **sem derrubar quem está no ar**.
- Painel de conectados: bitrate, resolução, tempo de conexão, e um clique para pôr
  no preview, outro para o PGM.
- A interface mostra os endereços prontos para copiar, já com o IP da máquina na LAN.

### Segurança

O bind é configurável: só loopback, só a LAN, ou todas as interfaces. O padrão é
**só a LAN**, e a interface avisa em vermelho quando o servidor está exposto a todas
as interfaces. Nenhum caminho aceita publicação sem chave. A regra de firewall do
Windows é criada pelo instalador, uma por porta, e nunca abre a API de controle.

### Perfis de saída

Por canal: resolução, fps, bitrate, encoder (NVENC ou x264), GOP e perfil de áudio.
Vários ativos ao mesmo tempo — mas cada perfil é **um encode**, então a interface
mostra o custo em sessões de NVENC antes de você ligar mais um.

## 9. Automação e aprendizado

**Camada 1 — regras (sempre ativa, offline, sem custo):**
templates de grade (dia útil / fim de semana / especial), blocos e categorias,
rotação de acervo, espaçamento mínimo entre repetições do mesmo asset, cota por
categoria por faixa horária, filler automático.

**Camada 2 — Claude (opcional):** botão "sugerir grade". Recebe catálogo,
regras, eventos fixos e histórico; devolve rundown proposto em JSON estruturado
via tool use com schema. **Sempre como rascunho**, apresentado em diff contra a
grade atual, para aprovação item a item.

**Aprendizado:** toda decisão do operador vai para `operator_decisions` (item
movido, trocado, pulado, hora ajustada, trim alterado). Um agregador extrai
preferências — que categoria costuma entrar às 19h, duração média aceita, o que
nunca se repete no mesmo dia — e alimenta tanto o motor de regras quanto o
prompt do Claude. Tudo local, no SQLite. Sem chave de API, o app funciona 100%.

## 10. Design da interface

Paleta (fundo escuro, detalhe azul escuro):

```
--bg          #080B12   fundo da aplicação
--surface     #0F141F   painéis
--raised      #151C2B   linhas e cards
--border      #212C42   divisórias
--accent-deep #1B3A8F   azul escuro (identidade)
--accent      #4C8DFF   foco, seleção, links
--text        #DCE3F0
--muted       #8492AC
--onair       #FF3B3B   no ar / tally
--next        #F0A020   próximo
--ok          #2ECC8F   pronto / conectado
```

Layout: barra superior (relógio, canal, ON AIR, drift ±), coluna esquerda
(biblioteca de assets + fontes ao vivo), centro (rundown denso), coluna direita
(Preview e PGM lado a lado + disparo de grafismo), rodapé (transporte).

Rundown: hora de entrada, hora de saída, duração, restante, cor por tipo, barra
de progresso no item no ar, indicador de âncora, drag & drop, undo/redo.
Contagem regressiva grande no item no ar, últimos 10s em vermelho.

Atalhos de estúdio: `Espaço` take, `Ctrl+Espaço` cue, `I`/`O` trim,
`J`/`K`/`L` shuttle, `F1`–`F12` grafismos, `Esc` cancela.

## 11. Roadmap

| Fase | Escopo | Entrega |
|---|---|---|
| F0 | Fundação: monorepo, TS, lint, testes, Drizzle + SQLite, protocolo zod, CI | Base |
| F1 | **Rundown e scheduler**: modelo, âncoras, trim com escopos, UI completa com mídia simulada | Primeira entrega |
| F2 | Engine: binário Rust/GStreamer, VT com A/B, PGM, **MediaMTX local** com o PGM em `rtmp://127.0.0.1:1935/ch1`, relays supervisionados para destinos externos, preview WebRTC | No ar |
| F3 | Ao vivo: **Decklink entrada e saída** com alocação de sub-dispositivos, clock da placa e detecção de sinal; NDI discovery; SRT in/out; chaves e painel de convidados | Ao vivo |
| F4 | Grafismo: camada CEF, templates + manifest, editor, rundown de GC | Grafismo |
| F5 | Multicanal e perfis de saída, monitoramento e alertas | Escala |
| F6 | Automação: regras, geração de grade, log de decisões, Claude opcional | Automação |
| F7 | Robustez: watchdog, failover slate, as-run log, relatórios, backup | Produção |

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Licença do NDI SDK (redistribuição exige aceite dos termos da Vizrt) | Não empacotar o SDK; instalador baixa/exige o NDI Runtime oficial. |
| Build do CEF no Windows é pesado | Usar binários pré-compilados do CEF; camada de grafismo isolada em processo separado. |
| GStreamer no Windows | Usar os builds MSVC oficiais, versão fixada; validar plugins em CI. |
| Jitter de fontes de rede quebra frame accuracy | Buffer de jitter configurável por fonte + fallback para slate após N frames perdidos. |
| GeForce limita sessões NVENC simultâneas | Detectar limite e cair para x264 nos perfis excedentes, avisando na UI. |
| Rundown corrompido em queda de energia | WAL no SQLite + snapshot do rundown a cada mudança + as-run log append-only. |
