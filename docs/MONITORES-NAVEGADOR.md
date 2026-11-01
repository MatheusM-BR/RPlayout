# Monitores do navegador: níveis, codificação por placa e latência

Branch `feat/monitores-r88-36`. Substitui o monitor único e limitado
(PGM 428×240 a 15 fps e 450 kbps, PVW 240p, QC 1080p a 6 Mbps, sempre
em x264) por níveis escolhidos por quem assiste, codificação por placa quando
há sessão sobrando e um caminho de latência revisto e medido.

O transporte não mudou: engine → SRT local → MediaMTX → WebRTC/WHEP.

## 1. Desenho

### Níveis

| nível | geometria | cadência | bitrate (teto) | qualidade |
|---|---|---|---|---|
| **REFERÊNCIA** (`ref`) | a do canal, até 1920×1080 | cheia; de campo no entrelaçado, se couber | 4–8 Mbps (≈0,08 bpp) | CRF 20 |
| **PADRÃO** (`std`) | 1280×720 até 30 fps; 960×540 acima | cheia | 1,5–3 Mbps (≈0,06 bpp) | CRF 23 |
| **LEVE** (`lite`) | 240 linhas, proporção do canal | de quadro, até 30 (50p sai a 25) | 180–450 kbps | CRF 27 |

* Cada nível tem caminho próprio no MediaMTX: `canal/mon-ref`, `canal/mon-std`,
  `canal/mon` (o mesmo para `pvw`). **O LEVE fica no caminho histórico**: HA,
  multiview, clientes antigos e qualquer chamada sem nível continuam
  recebendo o que sempre receberam.
* Um nível só é codificado enquanto alguém o assiste (heartbeat
  `POST /api/channels/:id/watching {bus, tier}` a cada 5 s, desligado após
  20 s de silêncio). Vários espectadores no mesmo nível compartilham uma
  única codificação; quem multiplica é o MediaMTX.
* Os perfis são calculados igualmente em Rust (`apps/engine/src/monitor.rs`,
  `tier_profile`) e documentados no TypeScript (`MonitorTier`,
  `monitorTierPath` em `packages/protocol/src/channel.ts`).

### Entrelaçado → cadência de campo

O canal entrelaçado já **compõe progressivo na cadência de campo**
(`composition_rate`: 1080i59,94 compõe a 59,94p e entrelaça só na saída que
pede). O monitor do PGM lê esse `inter` antes do entrelaçamento, então o REF
a 59,94p não precisa de desentrelaçador: não há perda nem custo de
desentrelaçar, só o de codificar o dobro de quadros. Por isso a regra é
"cadência de campo quando o custo permitir": na placa, sempre; em software,
se couber no orçamento de CPU (abaixo); senão cai para a cadência de quadro e
o relatório diz `cadência de quadro (CPU)`. O PVW é decodificado na cadência
de quadro (o tocador de preview roda na da grade), então lá o REF já é de
quadro.

### Pipeline no engine (`MonitorBus`)

```
intervideosrc ─ caps(cadência) ─ tee ─┬─ [ref]  fila leaky ─ escala ─ taxa ─ I420 ─ (relógio) ─ enc ─ h264parse ─┐
                                       ├─ [std]  …                                                               ├─ mpegtsmux ─ srtsink
                                       └─ [lite] …                                                               │   (um por nível)
interaudiosrc ─ conv ─ resample ─ opusenc(10 ms) ─ opusparse ─ tee ───── fila ─ válvula ────────────────────────┘
```

* Uma leitura do `inter` e **um único Opus** por monitor; um ramo de vídeo
  por nível ligado/desligado **a quente** (sonda IDLE no `tee`, ramo vai a
  PLAYING antes de ligar e a NULL só depois de desligado). Os outros níveis
  não piscam — testado (`monitor_bus_publica_tres_niveis_e_troca_a_quente`).
* Erro dentro de um ramo derruba só aquele ramo; erro na leitura do `inter`
  derruba o monitor (reabre com espera crescente).
* A fila de cada ramo é `leaky=downstream` com 3 quadros: ramo lento perde
  quadro, não segura os outros níveis nem o `inter`.
* O áudio de cada ramo passa por uma `valve` fechada até o primeiro quadro
  codificado (`forward-sticky-events`): a primeira PMT já sai com as duas
  trilhas, sem os 500 ms de folga de muxer que o monitor antigo precisava.
* O PVW agora é decodificado no raster do REF (o do canal até 1080p) em vez
  de 240p; cada nível reduz no próprio ramo. Para fontes 1080 isso também
  tira a escala do decodificador de preview.

### API para outros módulos (multiview)

Documentada no topo de `apps/engine/src/output.rs`. Resumo: `PublisherSpec`
ganhou `monitor: Option<MonitorSource>`; com `Some`, o `Publisher` vira um
`MonitorBus`. `Publisher::set_tier(tier, on, hardware)`, `set_wanted(on)`
(legado = LEVE), `service()`, `report()` (`Report.tiers: Vec<TierReport>`,
`Report.encoder`). Comandos do servidor: `{"cmd":"monitor","bus","on","tier","hardware"}`
e `{"cmd":"monitorClock","on"}`.

### Multiview composto (`mv`, integrado na r88-36)

O mosaico de `docs/MULTIVIEW.md` usa este mesmo `MonitorBus` (`MonitorSource.mosaic = true`,
perfis em `mosaic_profile`). O nível salvo no canal é o teto em que o mosaico é composto, e
os espectadores escolhem até ele. Conta no orçamento de CPU e nas sessões de placa como PGM e PVW.

### Escolha do nível no navegador

`apps/web/src/domain/monitor-tier.ts` (puro, testado) e `Whep.tsx`:

* **Inicial pelo contexto:** QC → REF; celular (`pointer: coarse`/UA),
  `saveData`, rede 2g/3g ou `downlink < 2 Mbps` → LEVE; PGM/PVW e
  multiview composto com janela ≥ 480 px → PADRÃO; menores → LEVE. Nunca
  acima do maior nível publicado (`clampToAvailable`: o teto do mosaico).
* **Manual no próprio monitor:** seletor `AUTO · REF · PAD · LEV` no canto do
  vídeo; a escolha fica guardada por papel (localStorage, só conveniência).
* **Automático com histerese** sobre RTCStats (um por segundo): amostra ruim
  = perda > 3 %, jitter > 40 ms, quadros descartados > 5 %, fps < 80 % do
  máximo dos últimos 10 s, ou `availableIncomingBitrate` (quando o navegador
  dá) abaixo de 1,1× o recebido. Desce após **3 s ruins**, sobe só após
  **15 s bons**, e depois de descer espera **30 s** antes de tentar subir.
  Nunca passa do teto (o nível inicial do contexto).
* A troca de nível reconecta o WHEP (≈0,5–1 s de "SINTONIZANDO"); a histerese
  existe para isso acontecer raramente.

### Proteções (sem limite artificial)

O operador pode deixar o perfil de PREVIEW/MONITOR em branco (automático) ou
definir teto. A validação (`validateOutputProfile`) recusa só o que faria de
um monitor uma saída de programa disfarçada:

* acima do raster do canal ou de 1920×1080; largura e altura juntas, pares,
  na proporção do canal (±2 %: monitor esticado engana enquadramento);
* acima da cadência do canal (a de campo, no entrelaçado);
* entrelaçado;
* bitrate fora de 300–8000 kbps.

**Compatibilidade com a r88-35 (HA e volta de versão).** O banco **não** é
reescrito para "em branco": a r88-35 recusa monitor com perfil nulo em
`validateOutputProfile`, `prepareHaLocalOutputs` e `assertProjectContract`, e
um reserva HA na r88-35 deixaria de preparar o canal, e um projeto exportado
não restauraria. Por isso:

* No banco fica o **perfil leve legado** (o de `lowBandwidthMonitor`: 240
  linhas, 15 fps, progressivo, 450 kbps). Canal novo nasce com ele; monitor
  gravado em branco (versões de desenvolvimento da r88-36, ou o operador
  limpando tudo) volta a ele em `ensureManagedOutputs`/na gravação
  (`monitorStoredPatch`).
* **Em tempo de execução**, qualquer perfil que a r88-35 aceitaria
  (`isLegacyMonitorProfile`: ≤ raster leve do canal, ≤ 15 fps, progressivo,
  ≤ 450 kbps) quer dizer **automático** (`monitorRuntimeProfile`, usado em
  `toEngineProfile` e na preparação HA): o engine recebe o monitor sem teto
  e publica os níveis.
* Só o teto que o operador preencher **de propósito** (acima do perfil leve)
  fica diferente — e é o único caso que a r88-35 não aceita.
* Prova: `monitor-profile-compat.test.ts` copia o validador da r88-35
  (`git show ddd7b8b:apps/server/src/domain/outputs.ts`) e confere o canal
  novo, o projeto exportado (`assertProjectContract`) e a preparação HA.
  Nenhuma tabela mudou; a migração 58 reservada não foi usada.

Que um monitor não tire recurso do programa é garantido em dois lugares:

* **CPU (engine):** orçamento de codificação de monitor em software,
  `RPLAYOUT_MONITOR_SW_MPX` (padrão 30 Mpx/s por núcleo lógico — o x264
  veryfast faz ≈60, metade fica para o resto). Passou do orçamento, o nível
  desce um degrau por vez (REF campo → REF quadro → geometria PADRÃO → …) e o
  relatório diz por quê; o LEVE sempre cabe. Na placa não conta.
* **Placa (servidor):** sessões contadas para todos os canais (abaixo).

### Codificação por placa

* **Detecção na partida:** `rplayout-encoders` (novo binário, entra no
  pacote e no launcher) abre sessões reais de `nvh264enc`, `qsvh264enc` e
  `mfh264enc` até a placa recusar (teto 12). GeForce aparece com o limite do
  driver (3/5/8); Quadro/RTX A chega ao teto = "sem limite". Roda **antes**
  dos canais subirem, para não contar as sessões do próprio programa.
  `mfh264enc` numa NVIDIA usa a mesma NVENC: conta-se só o melhor codificador.
* **Reserva:** `EncoderSessions` (servidor) desconta primeiro uma sessão por
  saída codificada que não é monitor (PGM e destinos RTMP/SRT/arquivo; NDI,
  OMT e SDI não codificam), recontada a cada pedido a partir do que os
  engines relatam. Só o que sobra é emprestado a REF/PADRÃO (o LEVE nunca
  pede: 240p em x264 custa menos que uma sessão). Acabou → x264
  veryfast/zerolatency, sem derrubar nada.
* **Troca a quente:** se a placa falha num ramo, o mesmo nível volta em x264
  na hora (sem espera); o servidor vê o nível concedido em software, devolve
  a sessão e, se a causa foi recusa da placa, aprende a capacidade real
  (outro programa — vMix, OBS — pode estar usando a mesma placa).
* **Prioridade absoluta do programa:** se uma saída de programa recebe recusa
  da placa e há monitores do mesmo processo em sessão de placa, eles são
  trocados para x264 (`revoke_monitor_hardware`) e o programa tenta a placa de
  novo em 250 ms; só sem nada a tomar de volta o processo desiste da placa.
* **Parâmetros:** sem B-frames, GOP de 1 s, sem lookahead, `zerolatency`
  (x264) / `low-latency-hq` + `zerolatency` (NVENC) / `low-latency` (QSV/MF),
  qualidade constante com teto de bitrate (x264 `pass=qual` + VBV de 500 ms;
  placas `vbr` com `max-bitrate`). Conferido: x264 em `pass=qual` respeita o
  teto (1080p de ruído a 1500 kbps saiu a 1640 kbps).
* **Tela técnica:** Engenharia › Dashboard › "Monitores do navegador":
  codificador de placa, total de sessões, reservadas ao programa, em
  monitores, livres; e para cada nível aberto o encoder (placa/x264), o
  perfil efetivo, o motivo de degradação e o estado.
  `GET /api/channels/:id/monitors`.

## 2. Latência

| salto | antes | agora |
|---|---|---|
| latência de pipeline da saída (`set_latency`) | 650 ms, sink síncrono | 100 ms, `srtsink sync=false` |
| folga do `mpegtsmux` | 500 ms | 60 ms (áudio liberado após o 1º quadro) |
| GOP | 2 s | 1 s (entrada mais rápida) |
| Opus | 20 ms | 10 ms |
| SRT do engine (`srtsink latency`) | padrão (120 ms) | 20 ms |
| SRT no MediaMTX (receptor) | 120 ms (padrão gosrt) | **120 ms** — o MediaMTX não expõe esse ajuste; o TSBPD efetivo é o maior dos dois lados |
| navegador | padrão | `jitterBufferTarget = 0` (ou `playoutDelayHint = 0`) fora do LEVE; no LEVE o padrão, que absorve rede ruim |

`jitterBufferTarget = 0` não desliga o buffer adaptativo do Chrome: ele fica
no mínimo que o jitter medido exige, sem folga a mais. Na LAN isso é
estável; o LEVE, que é a conexão ruim, mantém o padrão.

Os buffers do MediaMTX (`writeQueueSize: 1024`) são fila de saída por
leitor e não acrescentam atraso em regime; não foram mexidos.

### Medição real

* **Relógio de teste:** Engenharia › Monitores › "MEDIR ATRASO". O engine
  grava o horário de parede (ms, 42 bits) numa faixa de 46 blocos no alto da
  imagem de cada nível, depois da escala e antes do encoder (nunca no
  programa). O navegador lê a faixa em cada quadro apresentado
  (`requestVideoFrameCallback`, `expectedDisplayTime`) e compara com o relógio
  da página: atraso de vidro a vidro p50/p95 por monitor. Entre máquinas
  diferentes os relógios precisam estar em NTP (o servidor já mede o próprio
  relógio contra NTP).
* **Estatísticas WebRTC** de cada monitor aberto na página: fps decodificados,
  quadros descartados, atraso médio do jitter buffer, tempo de decodificação
  por quadro, bitrate, perda, resolução e nível atual (auto/fixo).

## 3. Medições (este container: 2 vCPU, sem GPU, x264)

Bancada: `cargo test --release monitor_bench::bench_monitor_niveis -- --ignored`
(variáveis `BENCH_*` no arquivo). Fonte 1080p29,97 real ("VT Movimento 20s",
5,3 Mbps, em laço), monitor do PGM, 20 s por medida. O receptor SRT imita o
MediaMTX (latência 120 ms). "Antes" é o `Publisher` antigo, sem níveis, com os
mesmos parâmetros de antes (240p/15 fps/450 kbps CBR, GOP 2 s, mux 500 ms,
latência de saída 650 ms), com o relógio gravado na fonte.

| nível | perfil efetivo | CPU do engine (núcleos, só o monitor) | bitrate medido (TS c/ áudio) | fps recebidos | atraso até o quadro decodificado p50 / p95 | CPU de decodificação (1 thread, libavcodec) |
|---|---|---|---|---|---|---|
| antes (monitor único) | 428×240 15 fps | 0,13 | 653 kbps | 15,0 | **983 / 1000 ms** | 0,006 |
| LEVE | 428×240 29,97 | 0,11 | 585 kbps | 29,9 | **192 / 208 ms** | 0,011 |
| PADRÃO | 1280×720 29,97 | 0,33 | 1,86 Mbps | 29,1 | **212 / 292 ms** | 0,051 |
| REF (orçamento padrão, 2 núcleos) | servido como 1280×720 — `geometria do PADRÃO (CPU)` | 0,33 | 1,83 Mbps | 28,7 | 215 / 358 ms | — |
| REF (orçamento liberado) | 1920×1080 29,97 | 0,53 | 5,06 Mbps | 28,5 | **254 / 475 ms** | 0,117 |

CPU do engine = CPU do processo com o monitor menos a linha de base da fonte
(medida antes no mesmo processo), com o receptor em outro processo (ffmpeg).
Os atrasos vêm de outra corrida com o receptor decodificando no mesmo
processo; inclui codificação, mux, SRT (120 ms de TSBPD) e decodificação, e
**não** inclui MediaMTX, WebRTC e o jitter buffer do navegador.

Com barra de teste a 1080i59,94 (composição 59,94p, 2 núcleos saturados pela
fonte + receptor + encoder): LEVE 193 ms, PADRÃO 960×540 a 59,94 171 ms; REF
com orçamento padrão foi servido como PADRÃO; REF de quadro (1080 a 29,97)
521 ms e REF de campo (1080 a 59,94, orçamento desligado) caiu a 20 fps com
1,3 s de atraso — é exatamente o caso que o orçamento existe para evitar numa
máquina pequena. (Saída bruta: linhas `BENCH {...}` da bancada.)

**CPU do navegador:** o Chromium do Playwright deste container **não tem
H.264** (nem em `<video>` nem em WebRTC: `RTCRtpReceiver.getCapabilities`
não lista H.264), então não decodifica nenhum monitor aqui — nem o antigo.
A coluna de decodificação acima é o decodificador de software do FFmpeg
(o mesmo libavcodec que o Chrome usa sem aceleração) em uma thread sobre o
H.264 que o engine publicou; não inclui composição/renderização do
navegador. A medida real fica para o Windows (abaixo).

**Encoders:** só x264 aqui (`rplayout-encoders` → nenhuma placa). A
contagem de sessões, a reserva, o empréstimo, a devolução e o aprendizado
do limite foram testados com placas simuladas (Rust: `encoders.rs`; TS:
`encoder-sessions.test.ts`). O caminho "placa concedida mas indisponível"
foi exercido de verdade: `nvh264enc` forçado sai em x264 sem derrubar o
nível (`placa_ausente_cai_para_x264_sem_derrubar`).

## 4. O que só se valida no Windows de produção

1. WebRTC de ponta a ponta com o MediaMTX real: os três caminhos por nível
   no `mediamtx.yml`, WHEP de cada um, áudio Opus junto, e o atraso de vidro
   a vidro com o relógio de teste (aqui não há MediaMTX).
2. CPU do Chrome/Edge com cada nível aberto (aqui o Chromium não tem H.264);
   o painel técnico mostra decodificação por quadro e descartes ao vivo.
3. NVENC/QSV/MF: sonda de sessões (GeForce: confere 3/5/8 conforme o driver;
   Quadro/RTX A: "sem limite"), nomes de propriedades dos encoders na versão
   do GStreamer instalada (o código só ajusta o que existe), troca a quente
   quando a placa recusa, e o programa tomando a placa de volta.
4. Efeito do `jitterBufferTarget = 0` na LAN da operação (estabilidade).
5. Orçamento de CPU padrão numa máquina de produção (ajustar
   `RPLAYOUT_MONITOR_SW_MPX` se necessário).

## 5. Riscos e limites conhecidos

* **TSBPD de 120 ms do MediaMTX** no salto SRT: não é configurável no
  MediaMTX; reduzir exigiria publicar por RTSP (`rtspclientsink` não está
  nesta instalação do GStreamer) — fica como próximo passo medido no Windows.
* **Troca de nível reconecta o WHEP** (meio segundo a um segundo sem imagem).
  A histerese evita ping-pong; "make-before-break" (abrir o novo antes de
  fechar o antigo) é melhoria possível.
* **Reserva pessimista:** toda saída codificada conta uma sessão, mesmo em
  software. Em placa GeForce com muitas saídas pode sobrar zero para
  monitores — eles saem em x264, nunca pretos.
* **Sonda abre sessões na partida** (até 12, ≈0,2 s cada). Se outro programa
  usa a placa depois, a capacidade é corrigida na primeira recusa.
* **QC** continua sendo um publicador único na REFERÊNCIA (o perfil já segue
  a fonte até 4K/60, `inspection_profile`), ainda em x264: o empréstimo de
  sessão de placa para o QC não foi ligado ao fluxo de concessão do QC.
* **PVW decodificado em raster maior** (até 1080p em vez de 240p): menos
  escala no decodificador de preview, mais memória por quadro no `inter`.
* **Relógio de teste** mede a partir da entrada do encoder do monitor; o
  trecho compositor → `inter` (≤ 1 quadro) fica fora.
* Testes de integração SRT (`monitor_bench::*`) são `#[ignore]`: abrem portas
  e consomem CPU; rodar com `--ignored`.
