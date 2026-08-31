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
| Servidor interno | MediaMTX embutido (ingest de convidados + republicação da saída) |
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
[VT A] filesrc → decodebin ┐
[VT B] filesrc → decodebin ┤
[NDI]  ndisrc              ├→ videoconvert → videoscale → videorate
[SRT]  srtsrc → tsdemux    ┤   → caps do canal (1920x1080, 50fps, I420)
[RTMP] rtmp2src            ┤   → queue
[SLATE] videotestsrc       ┘
                              ↓
                          compositor (ou glvideomixer)
                              ├ pad 0: fundo / fonte no ar
                              ├ pad 1: camada de grafismo (CEF offscreen, BGRA)
                              └ pad 2: bug/logo permanente
                              ↓
                          tee ─┬→ nvh264enc → flvmux  → rtmp2sink  (N destinos)
                               ├→ nvh264enc → mpegtsmux → srtsink
                               ├→ (baixo bitrate) → webrtcbin      (multiview UI)
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

## 7. Entradas, saídas e servidor interno

**Entradas:** NDI com discovery automático na rede, SRT listener e caller,
RTMP via MediaMTX interno, arquivos locais, slate/cor sólida.

**Saídas:** N destinos RTMP simultâneos com reconexão automática e backoff
exponencial; SRT caller/listener com latência configurável; gravação local.

**MediaMTX embutido** como processo filho, com config gerada pelo server:
- Chave de stream por convidado, criada na UI, revogável.
- Painel "quem está conectado", com bitrate, resolução e tempo de conexão.
- Um clique para pôr o convidado no preview, outro para o PGM.
- Republicação do PGM em RTMP/SRT/HLS/WebRTC para quem precisar puxar.

**Perfis de saída** por canal: resolução, fps, bitrate, encoder (NVENC ou x264),
GOP, perfil de áudio. Vários perfis ativos ao mesmo tempo.

## 8. Automação e aprendizado

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

## 9. Design da interface

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

## 10. Roadmap

| Fase | Escopo | Entrega |
|---|---|---|
| F0 | Fundação: monorepo, TS, lint, testes, Drizzle + SQLite, protocolo zod, CI | Base |
| F1 | **Rundown e scheduler**: modelo, âncoras, trim com escopos, UI completa com mídia simulada | Primeira entrega |
| F2 | Engine: binário Rust/GStreamer, VT com A/B, PGM, saída RTMP, preview WebRTC | No ar |
| F3 | Entradas ao vivo: NDI discovery, SRT in/out, MediaMTX, gestão de convidados | Ao vivo |
| F4 | Grafismo: camada CEF, templates + manifest, editor, rundown de GC | Grafismo |
| F5 | Multicanal e perfis de saída, monitoramento e alertas | Escala |
| F6 | Automação: regras, geração de grade, log de decisões, Claude opcional | Automação |
| F7 | Robustez: watchdog, failover slate, as-run log, relatórios, backup | Produção |

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Licença do NDI SDK (redistribuição exige aceite dos termos da Vizrt) | Não empacotar o SDK; instalador baixa/exige o NDI Runtime oficial. |
| Build do CEF no Windows é pesado | Usar binários pré-compilados do CEF; camada de grafismo isolada em processo separado. |
| GStreamer no Windows | Usar os builds MSVC oficiais, versão fixada; validar plugins em CI. |
| Jitter de fontes de rede quebra frame accuracy | Buffer de jitter configurável por fonte + fallback para slate após N frames perdidos. |
| GeForce limita sessões NVENC simultâneas | Detectar limite e cair para x264 nos perfis excedentes, avisando na UI. |
| Rundown corrompido em queda de energia | WAL no SQLite + snapshot do rundown a cada mudança + as-run log append-only. |
