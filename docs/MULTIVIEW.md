# Multiview composto (R88-36)

Pedido: o multiview de entradas abria um WHEP por fonte. Eram N codificações no engine, N decodificações no navegador e N conexões, com as imagens fora de sincronia. Agora o engine monta uma imagem só, como um multiviewer de hardware, e codifica uma vez. O multiview por fonte continua disponível como **"fontes individuais"**.

## Desenho

```
 pipeline do canal e dos itens (intocados)          pipeline do multiview (próprio, sob demanda)
 tee-video (PGM) ─┐                                   appsrc 0 ─ videoconvertscale ─┐
 item PVW ────────┤  sonda de pad: try_lock e         appsrc 1 ─ videoconvertscale ─┤ compositor ─ intervideosink {canal}-mv-video
 item NEXT ───────┤  troca da referência do           ...                         ─┘                       │
 item QC ─────────┤  último quadro (O(1),             ^ thread de cadência: a cada período                Publisher "mv" (output.rs)
 contingência ────┘  sem cópia, nunca espera)           leva o quadro mais novo de cada sonda              x264 → SRT → MediaMTX {canal}/mv → WHEP
```

- **Engine: `apps/engine/src/multiview.rs`.** É um módulo filho de `channel`, para ler os itens sem abrir campos. Em `channel.rs` só entraram os pontos de ligação: o campo, o `set_monitor("mv")`, o `service_outputs`, o `outputs_report` e o `shutdown`.
- **Fontes das células:** PGM (sinal do `tee-video`, com grafismo), PVW, NEXT (item armado), QC, contingência (o slot de troca ao vivo) e as **entradas ao vivo cadastradas**. Uma entrada é encontrada onde o engine a tiver aberta, nesta ordem: PGM, PVW, NEXT, QC, contingência. A célula do PGM recebe o item da entrada, sem grafismo.
- **Escala:** um `videoconvertscale` por célula leva a fonte do tamanho original direto ao tamanho da célula, com `add-borders` (4:3 ganha barra, não deformação). Não há escala intermediária.
- **Fonte congelada:** o buffer entra sem duração, e o compositor o repete sem reescalar. Fonte que para de entregar quadros mostra o último quadro por até 2 s (estado `held`). Depois disso a célula vira o quadro de **sem sinal**, cinza com listras. Fonte que não está aberta em lugar nenhum fica **indisponível**, cinza liso. Célula vazia fica preta. O estado de congelamento por conteúdo vem do watchdog, desenhado no navegador.
- **Isolamento do PGM:** a sonda só faz `try_lock`. Se o multiview estiver ocupado, o quadro não entra no mosaico, conta em `skipped` e o PGM segue. O `appsrc` de cada célula tem `block=false`, `max-buffers=1` e `leaky-type=downstream`, e a fila antes do `intervideosink` é `leaky`. Se o multiview atrasar, quem descarta é ele.
- **Layouts:** `MV_PGM_PVW` (PGM e PVW grandes, oito fontes embaixo), `MV_2X2`, `MV_3X3`, `MV_4X4` e `MV_1_PLUS_5`. Todos usam uma grade de 12 unidades, a mesma em `packages/protocol/src/multiview-composite.ts`, e os testes dos dois lados conferem. Trocar o layout recria **só** o pipeline do multiview. As sondas da mesma fonte são reaproveitadas, e o Publisher segura o último quadro (5 s) durante a troca.
- **Níveis (integrado na r88-36 com `docs/MONITORES-NAVEGADOR.md`).** O `Quality` salvo no canal é o **teto**: o nível de monitor (`MonitorTier`) em que o mosaico é composto. O publicador do `mv` é o mesmo `MonitorBus` dos monitores PGM/PVW, com um ramo por nível (`{canal}/mv-ref`, `{canal}/mv-std` e `{canal}/mv`, o LEVE no caminho histórico). Cada espectador escolhe o próprio nível até o teto, com o mesmo seletor `AUTO · REF · PAD · LEV` e a mesma troca automática por estatísticas WebRTC do `Whep`. O selo `AUTO·xxx` mostra o nível em uso. A tabela de perfis é uma só, `monitor::mosaic_profile`:

| Nível | Mosaico (teto) | Cadência | Bitrate |
|---|---|---|---|
| REFERÊNCIA | 1920×1080 | a do canal | 8 Mbps |
| PADRÃO (teto padrão) | 1280×720 | a do canal, ou metade acima de 30 q/s | 3 Mbps |
| LEVE | 960×540 | 15 q/s | 1,2 Mbps |

  - Pedido acima do teto é rebaixado pelo servidor (`clampTier`); o engine recusa nível acima do teto. Baixar o teto derruba os níveis acima dele.
  - **Orçamento de CPU:** os ramos do `mv` em software entram no mesmo orçamento da máquina dos monitores (`RPLAYOUT_MONITOR_SW_MPX`, contado no servidor sobre todos os canais, o LEVE incluído) e descem um degrau por vez, dizendo o motivo. O custo da composição (escala das células e compositor) não entra na conta: é fixo e foi medido abaixo.
  - **Sem espectador**, o serviço do multiview nem monta os pontos de sonda (antes: a ~50 Hz). **Desmontar** o mosaico (troca de teto, último espectador saindo) não faz join no laço principal do engine: a espera da thread de cadência (até 2 s) e o NULL do pipeline vão para uma thread própria.
  - **Placa:** REF/PADRÃO do `mv` pedem sessão ao `EncoderSessions`, como PGM/PVW, depois da reserva do programa. O LEVE fica em x264.
  - **HA/restauração:** como o QC, o destino do `mv` fica retido até a admissão do preview (`release_preview_output`). A composição pedida nesse intervalo é guardada e aplicada na liberação. Um nó em preparação não publica o mosaico do próprio PGM/PVW.

- **Sob demanda:** o monitor `mv` segue o mesmo `watching {bus, tier}` dos monitores `pvw` e `mon` (um só aviso e um só caminho no servidor). Sem espectador não há sonda instalada, pipeline nem thread (custo zero). O desligamento acontece 20 s depois do último aviso.
- **Protocolo:** o comando `{"cmd":"multiview","composition":{layout,quality,cells:[{kind:"pgm"|"pvw"|"next"|"qc"|"contingency"|"empty"}|{kind:"source",id}]}}` e o evento `multiviewState` (geometria, nível, estado, fps, resolução e barramento de cada célula, quadros compostos), a cada 500 ms enquanto roda. O destino vem da configuração privada (`"multiview"`) ou de `--multiview`.

### Sobreposição no navegador (`CompositeMultiview.tsx`)

Nada é queimado na imagem. Sobre um único `<Whep>` do caminho `{canal}/mv`, o HTML desenha, pela mesma grade:
- o nome da fonte (UMD);
- o tally: borda e faixa vermelhas no PGM, verdes no PVW. A cor vem do barramento real em que o engine encontrou a fonte;
- o VU vertical por canal, a partir dos medidores BS.1770 de PGM e PVW que já chegavam no `live()`. Não há VU sem medição real: NEXT, QC e entradas fora de PGM/PVW ficam sem barra;
- o estado do sinal da célula (`SEM SINAL`, `SEM QUADRO NOVO x s`, `FORA DOS BARRAMENTOS`);
- o estado do watchdog (`WD SUSPEITA/ESPERA/CONTINGÊNCIA/RETORNO` e o tempo restante), lido de `/api/channels/:id/live-watchdog`;
- o relógio.

Clicar numa célula abre o monitor individual (o WHEP por barramento que já existia, PGM `mon` ou PVW `pvw`). O seletor **COMPOSTO | FONTES INDIVIDUAIS** guarda a escolha no navegador.

### Servidor

- `GET /api/channels/:id/multiview/composite` devolve os layouts, os níveis, o layout salvo e a ETag, a composição efetiva, o estado do engine, o WHEP e o motivo de indisponibilidade. Pede sessão e acesso ao canal.
- `PUT /api/channels/:id/multiview/composite` pede `If-Match`. Salvar layout e células exige `PLAYLIST_EDIT`, como o layout das fontes individuais. **Trocar o teto exige `OUTPUT_CONTROL` (Supervisor ou acima)**, porque muda o custo de codificação na máquina do ar. A regra entrou na matriz `route-authorization-matrix.test.ts`.
- Sem células salvas, o preenchimento é automático, como num master: PGM, PVW, as entradas do canal (principal antes do backup), NEXT, QC e contingência.
- **Sem migração:** cada gravação é uma decisão `@multiview` / `MULTIVIEW_COMPOSITE` em `operator_decisions`, com o canal em `item_id`, e vale a última. A migração 59 não foi usada: com a 58 de outro agente ainda inexistente, a lista posicional de `schema-compatibility.ts` deixaria este branch sem banco "current". Na integração, uma tabela própria pode ler essas linhas.
- MediaMTX ganha o caminho `{canal}/mv`. O engine recebe `multiview` na configuração privada, e a composição é reenviada quando o engine reinicia.

## Números (container Linux, 2 CPUs, sem GPU, x264 em software, outros agentes rodando)

O engine foi medido com `cargo test --release medir_custo_multiview -- --ignored --nocapture`. As fontes são `videotestsrc pattern=ball` 1280×720 a 25 q/s, como entradas já decodificadas. O **composto** é um mosaico PADRÃO de 1280×720 a 25 q/s em SRT. O **individual** é um monitor de 428×240 por fonte (o modelo WHEP por fonte, com o perfil do PVW de hoje), também em SRT. A CPU é a do processo, em % de um núcleo, **acima das fontes sozinhas**. Fizemos duas rodadas; a máquina é compartilhada e a variação é grande.

| | 4 fontes | 9 fontes |
|---|---|---|
| Composto (1 codificação 720p) | +26 a +40 % | +24 a +42 % |
| Individual (N codificações 240p) | +17 a +23 % | +52 a +160 % (saturou os 2 núcleos) |
| Latência fonte → quadro decodificado, composto | 0,97 a 0,98 s | 0,64 a 1,00 s |
| Latência fonte → quadro decodificado, individual | 0,92 a 0,94 s | 0,86 a 0,90 s |

Para o navegador, o roteiro é `scripts/qa-multiview-browser-cpu.cjs`. Ele mede o Chromium headless da Playwright, decodificação em software, com VP8, porque este Chromium não tem H.264 em `<video>`. A janela é de 1280×720 e a CPU somada de todos os processos do navegador:

| | CPU | Quadros/s decodificados | Quadros descartados em 10 s |
|---|---|---|---|
| Composto, 1 × 1280×720 | 11 % | 25 | 0 |
| Individual, 4 × 428×240 | 19 a 21 % | 100 | 1 a 36 |
| Individual, 9 × 428×240 | 28 a 30 % | 225 | 15 a 115 |

Leitura:
- **O custo do composto é fixo.** Não cresce com o número de fontes: uma escala pequena por célula e uma codificação. O individual cresce linearmente. Com 4 fontes os dois empatam no engine; o 240p é barato, e o mosaico 720p tem 2,2 vezes mais pixels que 4 × 240p. Com 9 fontes o composto custa de 2 a 4 vezes menos. No LEVE (960×540 a 15 q/s, cerca de 1/3 dos pixels por segundo do PADRÃO), o composto fica abaixo do individual já em 4 fontes.
- **No navegador o composto ganha sempre:** metade da CPU com 4 fontes, um terço com 9, e sem quadro descartado. É um decodificador e uma conexão WebRTC só, contra N.
- **Sincronia:** no composto todas as células saem no mesmo quadro codificado. No individual cada fonte tem encoder, buffer e jitter próprios.
- **Latência:** pela construção, o composto soma no máximo 1 período de cadência (espera da thread) mais 1 período de folga do compositor: cerca de 80 ms a 25 q/s. Isso fica dentro do ruído da medição. O que domina é a latência fixa de 650 ms do Publisher (`LATENCIA_DA_SAIDA`) mais 120 ms do SRT, igual nos dois modelos.
- **Resolução por célula:** no 3×3 do PADRÃO cada célula tem 426×240, a mesma resolução do monitor individual. No 2×2 tem 640×360, melhor.

## Provas

- `cargo test --release multiview` cobre seis testes:
  - geometria sem sobreposição e em pixels pares;
  - nomes do contrato;
  - composição: cada cor no seu quadrante, 4:3 com barra, fonte que para (primeiro `held` com o último quadro, depois "sem sinal"), fonte que sai do barramento (indisponível) e sem espectador (sem sondas);
  - troca de layout em sequência, com o PGM sem atraso (maior intervalo de 53 ms a 25 q/s) e o 3×3 no lugar;
  - **multiview 12 vezes mais lento e sonda travada por 1 s com o canal real**: o tee do PGM fica em 25,0 q/s, com maior intervalo de 47 a 59 ms (sem multiview, 50 ms), o multiview compõe 5 quadros em 3 s e a sonda deixa 25 quadros para trás sem esperar;
  - saída SRT lida pelo ffprobe: `h264` 960×540 a 15/1, mais Opus.
- **Interface:** o roteiro Playwright `scripts/qa-multiview-ui.cjs` passou em 1920, 1366 e celular (390×844) contra a instância de QA na porta 4190. Ele confere o palco em 16:9, as células dentro do palco, a ausência de rolagem horizontal, o relógio, o 3×3 → salvar → API confirma, a volta ao PGM/PVW+8, o clique que abre o monitor individual e o Esc que fecha, e as "fontes individuais". O painel integrado do Monitor ganhou altura mínima de 380 px. Em 1366×768 o mosaico tinha só 208 px de altura; agora a área rola.

## Só no Windows de produção

- **A imagem no navegador (WHEP do `{canal}/mv`)**: aqui não há MediaMTX. O composto foi provado até o SRT, lido pelo ffprobe, e a sobreposição foi provada sem vídeo.
- **NVENC/QSV:** a concessão de sessão para REF/PADRÃO do `mv` foi testada com placa simulada (`encoder-sessions.test.ts`). A sessão real, a troca a quente e a devolução ao programa só se validam no Windows com placa.
- **CPU e latência reais** com entradas NDI, SRT e SDI e decodificação H.264 do Chrome/Edge (provavelmente por hardware): os números acima são relativos, num container de 2 núcleos.
- **Fontes reais nas células:** NDI, SRT e DeckLink no PVW, NEXT, QC e contingência, além do tally e do VU com áudio de verdade.

## Limites e próximos passos

- ~~Uma entrada aparece só quando o engine a tem aberta.~~ Resolvido na r88-37 pelo **ingest único por entrada** (seção abaixo): toda entrada cadastrada e ativa numa célula aparece o tempo todo.
- O mosaico é **um por canal**. Trocar o layout troca para todos que estão olhando, e a interface avisa antes de salvar.
- VU só existe onde há medição real (PGM e PVW).

# Ingest único por entrada (r88-37)

Pedido: um multiviewer de verdade mostra **todas** as entradas cadastradas o tempo todo, não só as que estão em PGM, PVW, NEXT, QC ou contingência. Sem abrir a mesma fonte duas vezes (NDI e SDI não aceitam; SRT listener tem conflito de porta) e sem que o monitoramento possa afetar o programa.

## Desenho

```
                        receptor da entrada (pipeline próprio, relógio do sistema)
 srt/rtmp/ndi/omt/sdi ─ source_for + decodificador ─┬─ fila ─ appsink vídeo (sync) ──┬─► appsrc no item PVW  ─ cadeia de sempre ─ inter
  (aberta UMA vez)       retomada SRT, keep-listening│   ▲ medição da entrada (uma vez)├─► appsrc no item PGM  (TAKE sem reabrir)
                         latência do tsdemux, bytes  │   └ sonda do multiview (try_lock)└─► appsrc no item QC/NEXT/contingência
                                                     └─ fila ─ appsink áudio N (sync) ─► appsrc da trilha que cada item pediu
```

- **Engine: `apps/engine/src/ingest.rs`** (módulo filho de `channel`, como o multiview). Um `Hub` por canal guarda os receptores; a chave é o endereço normalizado da fonte (`decklink://0` = `sdi:0`, `ndi://X` = `ndi:X`).
- **Receptor:** monta a fonte com o mesmo `source_for` que o item usava — e com ele a retomada SRT (`srt_input`), o `keep-listening`, a latência de 150 ms do `tsdemux`, o contador de bytes de rede e a política de decodificador. Cada trilha decodificada (primeira de vídeo, todas as de áudio, na ordem da fonte) vai a uma fila e a um `appsink` **no relógio** (`sync=true`, `async=false`): o receptor faz o papel que o sink do item fazia, de segurar o quadro até a hora certa.
- **Item (consumidor do programa):** recebe um `bin` com um `appsrc` por trilha (`block=false`, fila de 2 quadros de vídeo / 8 de áudio, `leaky-type=downstream`). O bin expõe as trilhas como pads dinâmicos, e a montagem do item (o `pad-added` de sempre, com a escolha de trilha de áudio, deinterlace, escala, `videorate`, roteamento e medição) não mudou. Cada quadro chega carimbado com o tempo de chegada no relógio do item; o áudio segue sequência contínua (encaixa até 40 ms) para não virar buraco/sobreposição.
- **Multiview:** a célula `{kind:"source",id,endpoint}` segura o receptor da entrada (concessão `Multiview`) e sonda o pad do `appsink` de vídeo dele, com o mesmo `Tap` (`try_lock`, O(1)). O barramento em que o item da entrada está (PGM, PVW, NEXT...) só pinta o tally: a troca de barramento (TAKE) **não** reinstala a sonda. O servidor manda o `endpoint` do cadastro (`engineComposition`); ele nunca é gravado nem volta ao navegador (pode levar senha SRT).
- **Watchdog:** a medição da entrada (`SourceStatistics`/`InputQuality`: fps, conteúdo, luma, áudio, kbps) é feita **uma vez por entrada**, no receptor, e sai no evento `ingestState` a cada 500 ms. Na contingência, o watchdog do servidor acompanha a entrada pelo receptor (`ingestWatch`, concessão `Watchdog`) em vez de sintonizá-la no PVW do operador; se o engine não tiver receptor compartilhado, volta ao CUE no PVW. O retorno à live (TAKE) reaproveita o receptor que o watchdog já mantinha.
- **Vida do receptor:** existe enquanto houver concessão (item, multiview com espectador, watchdog). Sem nenhuma, espera `RPLAYOUT_INGEST_LINGER_MS` (2 s; um CUE seguido de TAKE não reabre) e fecha numa thread própria. Quem precisa da mesma porta/dispositivo espera esse NULL terminar (até 3 s).
- **Falha da fonte:** erro/EOS no receptor é repassado ao bus de cada item assinante, então a recuperação de sempre continua valendo (`LiveRecovery` do PGM, reabertura do QC). Reabrir cria uma nova geração do mesmo receptor. Receptor só de monitoramento é reaberto pelo serviço a cada 2 s, fora do laço.
- **SDI:** a captura de áudio é do receptor. Se um item pede mais canais (8/16) que o receptor aberto (2), ele é reaberto com a captura maior (o monitoramento pisca; o programa recebe o que precisa).
- **Desligar:** `RPLAYOUT_INGEST_SHARED=0` volta cada item a abrir a fonte no próprio pipeline (r88-36). Nesse modo as células de entrada voltam a aparecer só onde a entrada estiver aberta, e o watchdog usa o PVW.

## Prioridade do PGM

- O receptor entrega cada quadro **depois** da espera do relógio, num `appsrc` por item que não bloqueia; o multiview só faz `try_lock` na referência do último quadro. Consumidor lento perde quadros dele.
- Receptor pedido só pelo monitoramento (multiview, watchdog) sobe numa thread própria (`ingest-abre`): fonte que trava no `set_state` não segura o laço do engine. Fechar também é em thread própria (`ingest-fecha`). Receptor pedido por item sobe na hora, como antes, para o erro de abertura voltar no LOAD/CUE.
- Interface: cada célula de entrada mostra **OK**, **CONGELADO n s** (imagem parada há ≥ 2 s pela medição da entrada: impressão do conteúdo ou grade de luma, as mesmas do watchdog), **SEM SINAL** ou **ABRINDO ENTRADA** (`multiviewCellHealth` em `packages/protocol`).

## Provas (`cargo test --release ingest::`)

- `uma_fonte_aberta_uma_vez_com_varios_consumidores`: SRT local; watchdog, multiview (célula da entrada) e o NEXT ao mesmo tempo → **1 receptor, 1 abertura**, consumidores `item+multiview+watchdog`; TAKE leva o NEXT ao ar sem reabrir e a célula só troca o tally para o PGM; o estado do multiview não contém o endereço.
- `consumidor_lento_ou_receptor_travado_nao_atrasam_o_pgm`: PGM recebido pelo receptor; multiview **12× mais lento** lendo o mesmo receptor, um segundo receptor de monitoramento que **trava 3 s** ao subir, a sonda presa 1 s e depois a fonte de monitoramento caindo. O PGM mede-se na entrega do item à superfície dele, contra a mesma medida sem consumidor; o laço do engine (`service_outputs`) não passa de 100 ms.
- `take_reaproveita_o_receptor_e_fica_mais_rapido`: tempo do LOAD até o item ter quadro (o que o TAKE espera), SRT 720p, mediana de 3.
- `receptor_desaparece_sem_consumidores`: solta o watchdog → fica a espera → fecha; item descartado também solta.
- Todos os testes de entrada ao vivo já existentes (retomada SRT caller/listener, soluço sem reabrir, LIVE TAKE com quadro velho, QC, áudio embutido) passam pelo receptor agora.

## Números (container Linux, 2 CPUs, máquina compartilhada com outros 2 agentes, carga 10–18)

**Custo por entrada recebida o tempo todo** (`cargo test --release medir_custo_ingest -- --ignored --nocapture`; geradores SRT H.264 720p25 1,5 Mbps + AAC em processos à parte, CPU e RSS do processo do engine acima do canal parado):

| entradas recebidas | CPU (% de um núcleo) | RSS |
|---|---|---|
| 1 | +4 % | +75 MB |
| 2 | +8 % | +118 MB |
| 3 | +13 % | +160 MB |
| 4 | +27 % | +203 MB |
| + mosaico LEVE 2×2 lendo os 4 (escala das células e composição, sem codificar) | +12 % | — |

- Leitura: ~4–7 % de núcleo e ~50 MB por entrada 720p, quase tudo decodificação H.264 (`avdec_h264`) e as filas de quadros crus. O padrão `ball` do gerador é fácil de decodificar: câmera real em 1080p custa mais (ordem de 10–20 % de núcleo por entrada sem decodificação por hardware). O receptor não reescala nem converte: o item e o mosaico fazem isso uma vez cada, como antes.
- **A escala para o mosaico é barata por construção:** a célula escala só o quadro que o mosaico vai mostrar, na cadência do mosaico (15 q/s no LEVE), num passo só (`videoconvertscale` bilinear com `add-borders`), e só quando o quadro mudou (`seq`); entrada parada não custa escala. O custo é fixo por célula (≈3 % de núcleo por célula 480×270 a 15 q/s aqui), não por entrada recebida.
- A memória por receptor é dominada pelos quadros crus em fila (fila de vídeo antes do appsink, até a latência do pipeline). 16 entradas permanentes em 1080p cabem com folga numa máquina do ar, mas a CPU de decodificação não: para muitas entradas, `RPLAYOUT_HARDWARE_DECODE=1` (NVDEC/QSV) na máquina de produção.

**TAKE** (`take_reaproveita_o_receptor_e_fica_mais_rapido`, LOAD até o item ter quadro, que é o que o TAKE espera; SRT 720p, GOP de 1 s, mediana de 3, duas rodadas):

| | rodada 1 | rodada 2 |
|---|---|---|
| antes (item abre a fonte, r88-36) | 669 ms | 905 ms |
| receptor frio (ninguém recebia a entrada) | 1238 ms | 1110 ms |
| **receptor já recebendo** (multiview, watchdog, PVW) | **264 ms** | **79 ms** |

- Com a entrada já recebida (multiview aberto, PVW, watchdog), o TAKE não abre conexão, não espera handshake, quadro-chave nem a latência do demux: o item recebe o próximo quadro. É o caso comum, porque o multiview mostra todas as entradas.
- Receptor frio é ~0,2–0,5 s mais lento que o caminho antigo: a abertura passa por dois pipelines (o receptor espera a latência dele no appsink, e o item soma 40 ms de folga). É o caso raro (entrada que ninguém recebia) e fica dentro do prazo do TAKE ao vivo (10 s).

**Isolamento do PGM** (`consumidor_lento_ou_receptor_travado_nao_atrasam_o_pgm`, PGM 640×360 pelo receptor): sozinho 25,3 q/s (maior intervalo 51 ms); multiview 12× mais lento no mesmo receptor + receptor de monitoramento travado 3 s ao subir 25,2 q/s (87 ms; serviço do laço no pior caso 69 ms); sonda do multiview presa 1 s 25,1 q/s (70 ms); fonte de monitoramento caída 24,9 q/s (53 ms; serviço 0,2 ms).

**Latência acrescentada:** 40 ms (um quadro a 25 q/s) declarados pelo appsrc do item (`RPLAYOUT_INGEST_ITEM_LATENCY_MS`). Sem ela, a cadeia do item (conversão, escala, `videorate`) entregava quadros 50–120 ms atrasados ao `intervideosink` sob carga, que os descarta acima de 20 ms. Retomada SRT medida depois da mudança: listener 720 ms, caller 796 ms até a superfície (alvo < 1,5 s), soluço de 1,5 s sem reabrir.

## Só no Windows de produção

- NDI, OMT e DeckLink pelo receptor (sem hardware/SDK aqui). O código é o mesmo `source_for`; o que muda é que a placa/NDI é aberta uma vez e repartida.
- O custo com decodificação por hardware (`RPLAYOUT_HARDWARE_DECODE=1`): o receptor pede memória de sistema (`video/x-raw` sem *features*), como o item pedia.
