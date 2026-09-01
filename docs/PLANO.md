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
| Áudio | Nivelamento por loudness (EBU R128) com os mesmos escopos do trim; limiter de true peak só como proteção |
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

Áudio: volume por item (nivelamento) → audiomixer → level → limiter true peak
       → level (redução de ganho) → 48 kHz stereo
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

## 6. Nivelamento de áudio

VT alto demais e VT baixo demais no mesmo bloco é problema de **medição**, não de
ouvido. A régua é loudness, não pico.

### Medir no ingest, antes de mexer em qualquer coisa

Quando o arquivo entra na biblioteca, roda uma análise EBU R128 (`ebur128` /
primeira passada do `loudnorm`) e o resultado fica gravado no asset:

- `integratedLufs` — loudness integrada do programa
- `lra` — faixa dinâmica (loudness range)
- `truePeakDbtp` — pico verdadeiro, com oversampling

### O ganho é calculado, não chutado

```
gainDb = alvoLufs − integratedLufs
```

Com um teto: se `truePeakDbtp + gainDb` passar do ceiling, o ganho é reduzido e a
interface mostra **por quê** — o arquivo já veio quente demais e subir mais só
entrega o problema para o limiter.

Alvo por canal, com presets: **−23 LUFS** para TV (é a régua da TV digital no
Brasil) e **−14 LUFS** para plataformas de streaming, que normalizam nessa faixa.

### O trim muda a medição

Este é o ponto que amarra o áudio ao in/out. A loudness do arquivo inteiro **não é**
a do trecho que vai ao ar — um VT com 20s de silêncio na cabeça mede diferente do
mesmo VT cortado. Por isso guardamos duas medições:

| Escopo da medição | Quando é feita |
|---|---|
| `FILE` | No ingest, sobre o arquivo inteiro. |
| `TRIM` | Em background, sempre que o in/out do item muda. |

O modo `AUTO` usa a medição do **trecho**. Enquanto ela não terminou, o item mostra
a do arquivo com um indicador de "medindo".

### Escopos idênticos aos do trim

Mesma pergunta, mesmo diálogo, mesmo selo de origem:

| Escopo | Grava em | Efeito |
|---|---|---|
| Só este item | `rundown_item.audio` | Override local. |
| Todos deste arquivo | itens com o mesmo `mediaId` | Neste rundown ou em todos. |
| Padrão do asset | `media_asset.default_audio` | Todo item novo já nasce nivelado. |

Precedência: **item > padrão do asset > 0 dB**.

```ts
type AudioLevel = {
  mode: 'AUTO' | 'MANUAL' | 'OFF'
  gainDb: number
  measured: {
    integratedLufs: number
    lra: number
    truePeakDbtp: number
    scope: 'FILE' | 'TRIM'
    measuredAt: string
  }
  channelMap?: number[]      // quais pares SDI entram no mix
}
```

`rundown_item.audio` nulo significa herdar do asset — o mesmo padrão do trim.

### Cadeia de áudio no engine

```
fonte → audioconvert → audioresample
      → volume (gainDb do item)          ← nivelamento, ganho estático
      → audiomixer  (soma das camadas: PGM + grafismo + fontes ao vivo)
      → volume (master do canal)
      → level                            ← medição PRÉ-limiter, alimenta o VU
      → limiter true peak                ← rede de proteção, ceiling −1 dBTP
      → level                            ← medição PÓS, dá a redução de ganho
      → encoder / decklinkaudiosink
```

### Medidores: PPM e LUFS, não "VU" de verdade

O VU clássico é RMS lento de 300 ms e não serve para pegar pico digital. O medidor
do PGM e do preview mostra três leituras ao mesmo tempo:

- **Pico verdadeiro** por canal, com hold e indicador de clip.
- **Loudness momentânea (400 ms)** e **short-term (3 s)**.
- **Integrada do item corrente**, para você ver se aquele VT específico está na régua.

Escala dupla: dBFS com marcas em −18, −12, −9, −6, −3, 0; e LUFS com o alvo do canal
marcado. Correlação de fase no estéreo, que é o que pega o clássico mono invertido.
Em SDI com 8 ou 16 canais, um medidor por par, com o mapa de quais entram no mix.

**Preview tem o mesmo medidor**, alimentado pelo pipeline de preview — dá para
conferir o nível do VT antes de ele chegar no ar.

Transporte: as mensagens do elemento `level` são agregadas pelo engine e enviadas por
WebSocket a ~20 Hz. Medidor não precisa de um pacote por frame.

### Limiter na saída: sim, mas como rede de proteção

**Vale a pena.** Não pelos VTs — esses já estão nivelados por ganho calculado — mas
por tudo que você não controla:

- Convidado que entra pelo RTMP com o áudio estourado.
- SDI do estúdio, cuja mesa não é sua.
- Grafismo com áudio disparado por cima do VT.
- A soma no mixer, que pode estourar mesmo com cada camada correta sozinha.

E porque clipping no AAC é **irreversível**: depois que sai, saiu.

**Como:** limiter de true peak no fim da cadeia, ceiling em −1 dBTP, look-ahead de
uns 5 ms. O look-ahead custa latência, então o vídeo leva um delay igual para não
perder o lip sync — isso fica declarado no perfil, não escondido.

**O que não fazer:** usar AGC ou compressor agressivo como nivelador. Achata VT bem
mixado e é exatamente o motivo de muito canal soar sem dinâmica. Nivelamento é ganho
estático calculado; o limiter só segura o pico.

**Regra de ouro: o limiter tem que ficar parado.** Se ele está trabalhando o tempo
todo, o problema é gain staging, não limiting. Por isso a **redução de ganho (GR)** é
métrica de primeira classe na interface, com alerta quando passar de um limite por
mais de alguns segundos.

**Bypass por saída.** Se o SDI alimenta um master control que já faz processamento de
loudness, limitar duas vezes piora o resultado. Padrão: ligado nas saídas codificadas,
com chave por perfil de saída para desligar no SDI.

### As-run de áudio

O log grava a loudness integrada do que **efetivamente** foi ao ar, por item. É o que
serve para comprovar conformidade e para achar depois o VT que soou baixo, em vez de
depender de alguém ter reclamado na hora.

### Realimenta o aprendizado

Ajuste manual de ganho depois do `AUTO` entra no mesmo log de decisões do operador.
Se você sempre baixa 2 dB nos VTs de uma categoria, isso vira uma sugestão em vez de
um trabalho repetido.

## 7. Grafismo

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

## 8. Hardware SDI (Decklink)

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

## 9. Rede, servidor RTMP local e distribuição

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

## 10. Automação e aprendizado

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

## 11. Design da interface

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

## 12. Roadmap

| Fase | Escopo | Entrega |
|---|---|---|
| F0 | Fundação: monorepo, TS, lint, testes, Drizzle + SQLite, protocolo zod, CI | Base |
| F1 | **Rundown e scheduler**: modelo, âncoras, trim e **nivelamento de áudio** com escopos, UI completa com mídia simulada | Primeira entrega |
| F2 | Engine: binário Rust/GStreamer, VT com A/B, PGM, **MediaMTX local** com o PGM em `rtmp://127.0.0.1:1935/ch1`, relays supervisionados para destinos externos, preview WebRTC, **cadeia de áudio com medidores e limiter** | No ar |
| F2.5 | **Ingest de arquivo de verdade** (varredura, SHA-256, sonda, sem lista de extensões) e **perfil de saída por destino**, com varredura entrelaçada e 1080i5994 — seção 13 | Formatos |
| F3a | **Fonte ao vivo como item da grade**: SRT, RTMP e convidado do servidor local. Fonte que cai não anda com a grade; quem marca a hora de sair é a grade. **Descoberta de fontes** (`rplayout-devices`) e seletor no diálogo de inserir item, com o motivo de cada família vazia | Ao vivo |
| F3 | Ao vivo: **Decklink entrada e saída** com alocação de sub-dispositivos, clock da placa e detecção de sinal; NDI discovery; SRT in/out; chaves e painel de convidados | Ao vivo |
| F4 | Grafismo: camada CEF, templates + manifest, editor, rundown de GC | Grafismo |
| F5 | Multicanal e perfis de saída, monitoramento e alertas | Escala |
| F6 | Automação: regras, geração de grade, log de decisões, Claude opcional | Automação |
| F7 | Robustez: watchdog, failover slate, as-run log, relatórios, backup | Produção |

## 13. Pendências anotadas: entrada de arquivo e perfil de saída

Duas coisas pedidas que ainda não estão feitas. Ficam aqui com o levantamento
já pronto para quando formos mexer.

### 13.1 Aceitar qualquer arquivo de entrada — **feito**

O ingest existe: `rplayout-probe` abre o arquivo com o mesmo GStreamer que vai
tocá-lo, mede a loudness pela BS.1770-4 no mesmo passe e tira a miniatura. A
varredura percorre a pasta, identifica por SHA-256, pula o que não mudou pelo
par tamanho+data e grava geometria, cadência, varredura e trilhas de áudio.
Arquivo que não abre entra no acervo com o motivo do GStreamer à vista.

Depois disso: arquivo sem trilha de áudio carrega (a cadeia de áudio do item só
entra no pipeline quando aparece trilha -- antes, um arquivo mudo simplesmente
não abria), e proporção diferente da do canal virou escolha por item, entre
mostrar inteiro com barra preta e encher a tela cortando a sobra.

Fica de fora, por enquanto: escolher entre várias trilhas de áudio. O resto do
levantamento abaixo continua valendo.

**O que já funcionava antes disso.** O item roda no pipeline dele com `uridecodebin` seguido de
`videoconvert → videoscale → videorate → caps do canal` e
`audioconvert → audioresample → caps do canal`. Ou seja: tamanho, formato de
pixel, cadência, taxa de amostragem e número de canais diferentes já entram e
saem normalizados. O `gst-libav` está presente, então a cobertura de codec é a
da instalação do GStreamer, não uma limitação nossa.

**O buraco de verdade não é o decodificador, é o ingest.** Hoje o acervo vem do
seed: não existe varredura de pasta. Precisa de um ingest que percorra o
diretório, identifique por SHA-256 (para reconhecer o mesmo arquivo renomeado ou
movido), sonde com `gst-discoverer` e grave duração, geometria, cadência,
varredura e trilhas de áudio.

**Sem lista de extensões.** Quem decide se o arquivo abre é o GStreamer, não uma
lista nossa: o teste é abrir com o discoverer. Arquivo que não abre entra no
acervo marcado como não-abriu, com o motivo do GStreamer, em vez de sumir sem
explicação — inclusive quando o motivo é plugin que falta (ProRes, DNxHD, HEVC
10 bits), que é informação acionável.

**Casos que precisam de tratamento explícito e ainda não têm:**

| Caso | Hoje | O que fazer |
|---|---|---|
| Fonte entrelaçada | entra como quadro entrelaçado e é escalado com combing | `deinterlace` no pipeline do item (existe na instalação) |
| Arquivo sem trilha de áudio | **resolvido**: a cadeia de áudio só entra no pipeline quando aparece trilha | falta só marcar o item como mudo na grade |
| Mais de uma trilha de áudio | pega a primeira que aparecer | escolher a trilha, por item e por padrão do acervo |
| Cadência variável (VFR) | o `videorate` já força a cadência do canal | confirmar com material real |
| Proporção diferente (4:3 em canal 16:9) | **resolvido**: pillarbox por padrão, corte por item, no botão da proporção | — |
| Arquivo ainda em cópia | abriria pela metade | não ingerir enquanto o tamanho estiver mudando |
| Imagem parada e áudio-só | não previsto | duração vem da grade, não do arquivo |

### 13.2 Perfil de saída definível, incluindo 1080i59.94 — **parcialmente feito**

Feito: o canal tem varredura e ordem de campo no banco, a composição roda no
dobro da cadência quando entrelaçado, o `interlace` com `field-pattern=1:1` tece
os campos na gravação as-run, o `x264enc` sai com `interlaced=true`, e a entrada
ganhou `deinterlace` em `auto`. Verificado com o canal em 1080i5994: a gravação
sai `interlace-mode=interleaved` a 30000/1001 e a saída de rede sai progressiva
a 30000/1001, ao mesmo tempo e do mesmo canal.

A saída em arquivo também roda em pipeline próprio agora, como as de rede.
Verificado apontando a gravação para um caminho que não existe: ela falha
sozinha e o programa continua no ar. Ela não reconecta -- reabrir um `filesink`
recomeçaria a gravação por cima da anterior, e disco cheio não se resolve em
segundos --, e encerra por EOS para o container fechar com índice.

Os perfis também estão persistidos e editáveis. Cada canal nasce com dois
gerenciados -- programa e preview --, cujo destino é derivado do servidor de
mídia e não é do operador escolher, mas cuja geometria, cadência, varredura e
bitrate são. Saídas extras são livres: RTMP, SRT ou arquivo, com destino próprio.

O que o perfil não disser herda do canal, e isso é decisão, não preguiça: valor
herdado acompanha quando o canal muda de formato, valor escrito fica para trás.

Mudança em perfil vale no próximo início do canal. Mexer no conjunto de saídas de
um pipeline que está no ar é a cirurgia que este projeto já pagou caro para
evitar -- e a interface diz isso em vez de fingir que aplicou.

Falta desta seção: só o `encoder` e o `gopFrames` do `OutputProfile`, que
esperam a F3 (NVENC).

O levantamento original, que continua valendo:


**Nomenclatura.** "1080i59" na prática é **1080i59.94**: 29.97 quadros por
segundo, 59.94 campos. Fica a nomenclatura da Decklink, `1080i5994`. O quadro
continua sendo a unidade de verdade — 29.97 quadros com drop-frame, que a tabela
de rates já expressa (`29.97 = 30000/1001`, e `isDropFrame` já responde certo).

**O que já existe.** Geometria e cadência já são por canal no banco
(`rate_num`, `rate_den`, `width`, `height`). Falta o modo de varredura: hoje
tudo é progressivo, implicitamente.

**O que muda:**

1. `channels` ganha `scan` (`PROGRESSIVE` | `INTERLACED`) e `field_order`
   (`TFF` | `BFF` — 1080i é TFF).
2. O perfil de saída deixa de ser argumento de linha de comando e vira registro
   por destino. Cada saída de rede já tem pipeline próprio desde a F2, então
   perfil por destino é uma consequência natural: o preview, que sai em metade
   do tamanho, já é um caso disso.
3. Engine: as caps do canal ganham `interlace-mode=interleaved` e `field-order`;
   o `x264enc` ganha `interlaced=true`; entra o elemento `interlace` entre o
   compositor e o encoder.

**Decisão de arquitetura a tomar antes de codar: compor em campo ou em quadro.**

O elemento `interlace` chama de "60i" o que é 29.97 quadros / 59.94 campos:

- `field-pattern=1:1` — compor a **59.94 progressivo** e entrelaçar, cada quadro
  virando um campo. É o movimento correto de 1080i, é o que playout de verdade
  faz, e custa compor no dobro da cadência (o compositor dobra; o encoder não).
- `field-pattern=2:2` — compor a **29.97** e repetir cada quadro nos dois campos.
  Custa metade e não dá combing, mas o movimento fica em 29.97 e o grafismo
  denuncia.

A escolha é `1:1`. O custo é no compositor, que é onde temos folga.

**Cuidado que isso cria: a grade e o pipeline passam a contar diferente.** Com o
canal em 1080i5994, o rundown conta **29.97 quadros** — é o que vai no banco, no
timecode e em toda a aritmética do scheduler — enquanto o compositor roda a
**59.94**. São duas cadências no mesmo canal, e confundir uma com a outra é erro
de fator dois em duração de item. O `rate` do canal continua sendo o da grade;
a cadência de composição é derivada dele (`× 2` quando entrelaçado) e não deve
existir fora do engine.

**Entrada entrelaçada com saída entrelaçada.** Desentrelaçar na entrada e
re-entrelaçar na saída perde resolução vertical no movimento. Passar direto
exigiria manter o material em campos até o fim, o que o compositor não faz — e
sem compositor não há grafismo nem escala. Decisão: desentrelaça na entrada,
entrelaça na saída.

**A saída de rede continua progressiva mesmo com o canal entrelaçado.** O
RTMP/FLV não tem onde declarar entrelaçamento e a maior parte dos destinos
assume progressivo. Então, com canal em 1080i5994, o publisher de rede ganha um
`deinterlace` antes do encoder. É exatamente por isso que o perfil de saída
precisa ser **por destino**, não por canal: SDI em 1080i5994, RTMP em 1080p2997.

**SDI.** O `decklinkvideosink` tem modo `1080i5994` e, preenchido o
`program_sdi_device_id`, a placa passa a ser o clock mestre. Isso é F3.

## 14. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Licença do NDI SDK (redistribuição exige aceite dos termos da Vizrt) | Não empacotar o SDK; instalador baixa/exige o NDI Runtime oficial. |
| Build do CEF no Windows é pesado | Usar binários pré-compilados do CEF; camada de grafismo isolada em processo separado. |
| GStreamer no Windows | Usar os builds MSVC oficiais, versão fixada; validar plugins em CI. |
| Jitter de fontes de rede quebra frame accuracy | Buffer de jitter configurável por fonte + fallback para slate após N frames perdidos. |
| GeForce limita sessões NVENC simultâneas | Detectar limite e cair para x264 nos perfis excedentes, avisando na UI. |
| Rundown corrompido em queda de energia | WAL no SQLite + snapshot do rundown a cada mudança + as-run log append-only. |
