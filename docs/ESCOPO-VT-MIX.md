# RPlayout — Escopo: corte no meio do VT e MIX/WIPE

Analista técnico · 30/10/2026 · leitura de fonte, sem build ou testes executados.
Legenda: **[fato]** = está no código citado · **[inferência]** = conclusão minha ou comportamento do GStreamer que precisa ser medido.

---

## 0. Resumo

1. **O corte de TAKE sobre um VT em execução já existe de ponta a ponta.** Servidor, engine e UI aceitam TAKE com um arquivo no ar e trocam o PGM na hora. O que falta é **qualidade e registro**:
   - o as-run e o "VT interrompido" usam a última posição recebida (amostrada a cada 100 ms), não o quadro real do corte;
   - não há declick no áudio;
   - não existe medição objetiva de quadro congelado, estalo ou A/V no instante do corte.
   - Trabalho: pequeno a médio, **≈ 6–11 dias-pessoa** com a bancada de testes.
2. **MIX/WIPE não existem em lugar nenhum além do botão desabilitado na UI.** A arquitetura atual comuta o PGM com `input-selector`, que só passa uma fonte por vez. Por isso **uma transição com duração não cabe no grafo atual sem um segundo caminho até o compositor e o mixer**.
   - MVP honesto: dissolve apenas no TAKE manual, atrás de flag por canal, com um ramo "B" em paralelo.
   - Custo: **≈ 13–22 dias-pessoa**. WIPE em cima disso: **+3–5**. MIX automático no fim do VT: **+8–14**. Recomendo **não** fazer o MIX automático agora.
3. **Ambiguidade a resolver antes de tudo.** Nos docs do projeto, "corte no meio do VT" quer dizer **pular um trecho do meio** (marcação QC `MIDDLE`, "aguarda motor"). Não quer dizer "TAKE sobre item em execução". São funções diferentes e o custo muda (ver §10, decisão D1).

---

## 1. O que já existe (com referência)

### Arquitetura real do PGM no engine
O README do engine está **desatualizado**: descreve um único `intervideosrc`. O código atual é este **[fato]**:

- Cada item roda num pipeline próprio e publica num par `inter` por slot: `{canal}-video-{0,1,2}`.
- O canal tem 3 `intervideosrc`/`interaudiosrc` permanentes, ligados a **dois `input-selector`** (vídeo e áudio), em `apps/engine/src/channel.rs:1242-1263`.
  - Os seletores usam `sync-mode=clock`, `cache-buffers` e `drop-backwards` (`channel.rs:1250`).
  - O slot 2 fica reservado para a troca de fonte ao vivo (`channel.rs:1384-1396`).
- A saída do seletor de vídeo passa por convert/scale/videorate/caps/queue e chega a **um único pad** do `compositor` (zorder 1), acima do fundo preto (zorder 0), em `channel.rs:1435-1449`.
- Áudio:
  - Em 2 canais, o seletor alimenta um `audiomixer` junto com o silêncio.
  - **Em 8/16 canais não há mixer**: a fila vai direto ao convert/limiter (`channel.rs:1415`).
- O grafismo fica **em linha depois do compositor**, de propósito. O comentário diz: "um pad a mais no compositor faz o programa esperar por ele" (`channel.rs:1273-1278`). Esse alerta vale diretamente para o MIX.

### TAKE e corte
- `Channel::take()` (`channel.rs:3058-3080`) chama `activate_armed_with_audio()` (`channel.rs:2965-3029`).
  - Esta troca `active-pad` nos dois seletores e faz busy-wait de até `3 quadros` (limitado a 250–1500 ms) pela confirmação (`channel.rs:2997`).
  - Se a confirmação não vier, restaura os pads anteriores.
  - Só depois disso descarta o item anterior.
  - **Não verifica se o item no ar é um arquivo em execução.** Logo, TAKE no meio do VT funciona hoje **[fato]**.
- Para fonte ao vivo, o TAKE fica pendente até o primeiro quadro válido, com prazo de 10 s (`channel.rs:3097-3145`). O PGM anterior segura o último quadro por 12 s (`channel.rs:633-640`).
- O corte de arquivo (`trimIn`/`trimOut`) é um seek ACCURATE com início e fim, feito no `load` (`channel.rs:2626-2640`). O fim do item chega como EOS e o engine não cronometra nada.
- `ItemSpec.emergency_cut_fade_ms` existe no protocolo do engine (`apps/engine/src/protocol.rs:90`), mas **não é usado em lugar nenhum** **[fato]**.

### Servidor
- `EngineTransport.take()` chama `playFrom(..., exact=true)` (`apps/server/src/domain/engine.ts:1911-1914`).
  - Antes do `take`, monta `pendingProgramExit = {itemId, frames: this.elapsed, reason:'TAKE'|...}` (`engine.ts:1666`).
  - `frames` vem do último evento `position` (`engine.ts:899`). O engine emite esse evento a cada **100 ms** (`apps/engine/src/main.rs:31`).
- `confirmTake()` (`engine.ts:1730-1766`) dispara `onTakeConfirmed`. Em `apps/server/src/app.ts:294-310` isso chama `asRun.noteExit(previous.itemId, reason, frames)`, grava o checkpoint e chama `asRun.follow`.
  - `asrun.ts` registra `endedAt` pelo relógio do servidor (`asrun.ts:185`) e `airedFrames` a partir desses frames.
- "VT interrompido / retorno":
  - `Interruptions.record` diz textualmente: *"Cursor is the last position reported by the engine, not a fabricated exact cut"* (`apps/server/src/domain/interruptions.ts:14-15`).
  - **Só é gravado na inserção operacional NOW** (`app.ts:1058-1062`), não num TAKE manual comum.
  - O retorno é feito por `takeWithLifecycle` (`routes.ts:4512`).
- O corte automático no meio do VT também já existe: live prioritária por horário (`engine.ts:2348`, `reason 'LIVE_PRIORITY'`).
- O preroll do próximo item já é armado com antecedência (`prepareAhead`, `engine.ts:2458-2545`). O MIX precisa disso.
- Trims e cursores:
  - `programTrimSchema`/`assertProgramTrim` (`program-trim.ts`) validam o corte salvo contra hash, `trim.in` e duração.
  - O checkpoint (`checkpoints.ts:8-30`) exige `elapsed < out-in` e `ownerRunId` sob lease.
  - Os dois assumem **um item no PGM por vez**.
- Política "sem TAKE automático após recuperação": `canStartProgram`/`canRecoverProgram` (`app.ts:288-291`) bloqueiam TAKE automático com interrupção, configuração pendente ou passagem de playlist incerta. Os pontos que respeitam isso estão em `engine.ts:1662,1999,2021`.
- Posse: `ExecutionOwnership` (`execution-ownership.ts`) é uma cerca por processo. O checkpoint só é escrito pelo dono (`checkpoints.ts:43-56`).

### UI
- `MasterControlView.tsx:200` declara `transitionMode` com `CUT|MIX|WIPE`.
- Em `1086-1101`, MIX e WIPE ficam `disabled`, com o tooltip "ainda não existe no engine". Isso está documentado em `docs/CORRECOES-R88-31-2026-10-28.md:224-229`.

### Specs
- `docs/SPEC-FASE-A-AUTOMACAO-24-7.md:252` previa "crossfade áudio 30 ms" no chaveamento. Não foi implementado.
- `docs/SPEC-FASE-E-...:481` previa `transition?: 'CUT'|'DISSOLVE'` por linha. Não existe no protocolo nem no banco.

---

## 2. Função 1 — corte no meio do VT (TAKE sobre item em execução)

### Já coberto
- Comutação no ar sem derrubar o canal.
- Preservação do PGM em caso de falha.
- Espera de quadro válido para live.
- Registro de saída no as-run, com motivo `TAKE`/`LIVE_PRIORITY`.
- Retorno ao VT interrompido, só via inserção NOW.

### O que falta

| Camada | Lacuna |
|---|---|
| Engine | **Recibo do instante real do corte.** Hoje não há evento com "quadro N do item que saiu × decoder que entrou × running-time". Proposta: uma probe no `src` dos seletores que detecta o primeiro buffer do novo pad e consulta `query_position` do item que sai naquele instante. Sai como evento `programCut {fromItemId, fromDecoderId, fromFrames, toItemId, toDecoderId, runningTimeNs, wallClock}`. Também anunciar a capacidade em `Ready` (como `live_replacement_protocol`, `main.rs:557`). |
| Engine | **Declick de áudio.** A troca do seletor de áudio é um degrau de amostra. Áudio alto pode estalar **[inferência; medir]**. Mínimo: rampa de 3–10 ms (descer, comutar, subir) ou crossfade curto com linha de atraso. O `limiter_element` já tem lookahead, de ~240 amostras pelo teste de `continuous_bus.rs`, e poderia hospedar isso sem latência extra **[inferência]**. |
| Engine | **Quadro congelado no corte.** O slot de arquivo armado está em PAUSED com o quadro de preroll na superfície `inter`. Ao ir para PLAYING, pode haver repetição de 1–2 quadros **[inferência; medir com fixture numerada]**. |
| Engine | O busy-wait de até 1,5 s em `activate_armed` trava o laço principal (posição, medidores, fence) durante o TAKE. É aceitável hoje, mas deve ser medido. |
| Servidor | Trocar `pendingProgramExit.frames` e o `endedAt` do as-run pelo recibo do engine, com fallback marcado como `CLOCK_ESTIMATE` (`asrun.ts:228-232` já tem o conceito de evidência). Gravar o checkpoint com o cursor exato. |
| Servidor | Decidir se o TAKE manual sobre VT também grava `interrupted_items` para oferecer retorno (D2). |
| Protocolo (`packages/protocol`) | Campo de evidência do corte no as-run (`EXACT_CUT` × `POSITION_SAMPLE`). |
| UI | Mostrar no as-run e no cartão de "retornar VT" o quadro exato. Não precisa de novo botão. |

### Desenho mínimo
- Não mudar a topologia.
- Fazer só três coisas: a probe de recibo, o declick e o uso do recibo no servidor.
- Nenhuma mudança em posse ou recuperação: o recibo é evidência, não autorização.

---

## 3. Função 2 — MIX/WIPE

### Por que não cabe no grafo atual **[fato + inferência]**
- O `input-selector` entrega uma fonte só. Uma dissolução precisa das duas ao mesmo tempo no compositor e no mixer.
- **Não dá para pôr um segundo `interaudiosrc` lendo o mesmo canal `inter`.** O `interaudiosrc` consome de um buffer compartilhado, então dois leitores dividiriam as amostras **[inferência forte; confirmar]**. Para vídeo um segundo leitor funcionaria, mas o áudio obriga a outra solução.

### Desenho mínimo viável (recomendado): ramo B paralelo, atrás de flag por canal
```
slot i: intervideosrc ─ tee ─┬─ queue ─ selector A ─ conv/scale/rate/caps/queue ─ compositor pad z1 (alpha 1)
                             └─ queue(leaky) ─ selector B ─ conv/scale/rate/caps/queue ─[smptealpha]─ compositor pad z2 (alpha 0)
slot i: interaudiosrc ─ caps ─ tee ─┬─ selector A ─ … ─ audiomixer pad (volume 1)
                                    └─ selector B ─ … ─ audiomixer pad (volume 0)
```

**Sequência do MIX de duração D quadros:**
1. O item novo já está armado no slot k.
2. Selector B vai para k e o item k entra em PLAYING (o que o TAKE já faz).
3. Calcula-se `T0 = running_time_atual + 2 quadros`.
4. Programar com `GstController`/`InterpolationControlSource`, crate `gstreamer-controller`, que é **nova dependência**:
   - `alpha` do pad z2 de 0→1 em `[T0, T0+D]`;
   - `volume` do áudio A de 1→0 e do áudio B de 0→1, com curva de potência constante ou linear (D6).
   - Vídeo e áudio usam o mesmo relógio, então ficam em sincronia por construção. O compositor e o audiomixer sincronizam os valores controlados pelo tempo do buffer de saída **[inferência; validar]**.
5. Em `T0+D`: selector A vai para k, e os volumes A=1/B=0 trocam **no mesmo timestamp**. Senão há eco ou buraco de ~10 ms.
6. Alpha B volta a 0, selector B fica ocioso e o item antigo é descartado.

**Cadência:**
- D em **quadros do canal**, convertido para ns com o racional `fps_n/fps_d` (já existe `frame_to_time`, `channel.rs:2376`).
- 29,97 = 30000/1001 exatos.
- Em entrelaçado, a composição roda na taxa de campos (`channel.rs:1149-1152`), então a rampa anda por campo.

**WIPE:**
- `smptealpha` (gst-plugins-good; presente localmente na 1.24.2, com `position` controlável e tipos `bar-wipe-lr/tb`, `box-wipe-*`, etc.) no ramo B, antes do pad z2, com alpha fixo em 1.
- Exige AYUV/ARGB nesse ramo, ou seja, uma conversão a mais.

**Não animar pelo laço principal**, como o grafismo faz hoje (`tick_graphics`, granularidade do loop de ~20 ms): isso não é quadro-exato.

**Recusas obrigatórias (o MIX vira erro ou CUT, nunca algo implícito):**
- `program_hold_cursor`/`program_hold_unconfirmed`;
- `replacement_selection_uncertain` ou troca ao vivo em curso no slot 2;
- TAKE de live ainda sem quadro (`pending_live_take`);
- `D` maior que os quadros restantes do item que sai;
- engine sem a capacidade anunciada.

### Alternativa que eu **não** recomendo agora: trocar o selector por 3 pads fixos no compositor e mixer
Seria um CUT por alpha 0/1, uma arquitetura mais limpa. Mas reescreve o núcleo do PGM:
- confirmação de TAKE (`activate_armed`);
- troca ao vivo (`commit_live_replacement`);
- program hold e restore;
- `release_program_outputs` e todos os testes nativos.

O risco de regressão no ar é alto demais para o ganho.

### Mudanças por camada
- **Engine:**
  - ramo B com tees, selector B, pad z2 e pad de áudio;
  - `audiomixer` também em 8/16 canais numerados **só com a flag**. Hoje esses barramentos não passam por mixer (`channel.rs:1415`), e a compatibilidade do `audiomixer` com 16 canais não posicionais **não está comprovada**;
  - `Command::Take { transition: Option<{kind: Mix|Wipe, frames, pattern?}> }`, com a ausência significando CUT, compatível com o que existe;
  - eventos `transition {phase: started|completed|aborted, fromDecoder, toDecoder, t0, frames}`;
  - capacidade em `Ready`;
  - EOS do item que sai durante o MIX não pode virar avanço de grade. Hoje `eos` do `onAir` dispara `advanceAfter` em `engine.ts:914-919`. Como o item que sai deixa de ser `onAir` só no fim, o engine precisa suprimir ou retaguardar esse EOS.
- **Protocolo:**
  - tipo `Transition` em `packages/protocol` (rundown item + padrão do canal);
  - campos de transição no as-run;
  - entra na `specificationKey`, para que mudar a transição após o CUE invalide o armado.
- **Servidor:**
  - migração (coluna por linha e padrão por canal);
  - `specFor` e `take(..., transition)`;
  - estado `TRANSITIONING` no `TransportState`;
  - TAKE durante a transição = completar já ou recusar (D8);
  - as-run com sobreposição (D3);
  - checkpoint durante a transição grava o item **que entra** a partir do ponto de commit definido (D3);
  - recuperação sempre CUT.
- **UI:**
  - habilitar MIX/WIPE quando o canal anunciar a capacidade;
  - duração em quadros ou segundos;
  - padrão de wipe;
  - indicador de transição em curso;
  - transição por linha na grade (fase posterior).

---

## 4. Latência e CPU **[inferência — medir na máquina-alvo]**
- **Latência:**
  - CUT: sem mudança.
  - MIX: sem latência extra em regime. O compositor já agrega, e o ramo B tem a mesma fila do A.
  - Declick com linha de atraso própria: +3–10 ms no áudio. Zero se for fundido ao lookahead do limiter.
- **CPU em regime, ramo B ocioso:**
  - tee, fila e seletor, com convert/scale em passthrough;
  - o pad z2 com alpha 0 provavelmente é pulado pelo compositor (a confirmar na 1.24);
  - o `smptealpha` e a conversão AYUV **rodam sempre** se ficarem fixos no ramo. Ou se mede, ou só entram na flag de WIPE.
- **Durante a transição:**
  - **dois decoders simultâneos**. Em 1080p50, H.264/XDCAM em software custa algo como +1 núcleo por canal durante D;
  - mais o blend de uma camada 1080p em software, alguns ms por quadro (o orçamento é 20 ms a 50p).
  - Com 4 canais num servidor, transições coincidentes somam. É preciso medir o pior caso (4 MIX simultâneos).
- **Memória:** cada `intervideosrc` ocioso gera quadros pretos em resolução cheia. O ramo B não acrescenta fontes, só ramifica as que existem.

---

## 5. Riscos de regressão no ar 24/7
1. **Pad extra no compositor pode atrasar o programa** se o ramo B travar. É o alerta registrado em `channel.rs:1273-1278`. Mitigação: fila leaky, fontes vivas e flag por canal desligada por padrão. Avaliar `ignore-inactive-pads` com cuidado.
2. **Áudio de 8/16 canais passando a ter mixer:** caminho novo no barramento sempre ligado. Mitigação: só com a flag, com testes `cue_take_preserves_auxiliary_identity_gain_and_silence_in_eight_and_sixteen_channels` (`channel.rs:4021`) e equivalentes rodando com a flag ligada.
3. **Troca A↔B no fim do MIX:** se volume ou alpha não trocarem no mesmo timestamp, há salto, eco ou buraco.
4. **Interação com a troca ao vivo (slot 2), program hold e restore:** as recusas precisam ser explícitas e testadas.
5. **Recuperação e watchdog no meio de uma transição:** o engine reinicia sem estado de transição. O servidor deve retomar **o item que entra**, com CUT, e só se a política permitir. Nunca pode retomar a transição.
6. **Timing da grade:** cada MIX sobrepõe D quadros. Se o planejador não descontar isso, horários fixos e o as-run divergem (D3).
7. **Fence/HA:** o TAKE com transição passa pela mesma cerca do `take`. A expiração do fence durante o MIX derruba a saída como hoje (`fencing::guard_pipeline`), sem caminho novo.

## 6. Como não quebrar contingência e failover
- Transição é **atributo de um TAKE já autorizado**, nunca um gatilho. Não cria caminho novo de TAKE automático.
- `canStartProgram`, `canRecoverProgram`, lease e fence continuam decidindo **se** há TAKE. A transição só decide **como**.
- Recuperação (`recover`, `recoverHeld`), contingência (`takeFromPlaylist`), passagem de playlist, HA/backup e watchdog: **sempre CUT**. Isso deve ser regra de código com teste.
- Checkpoint e cursor continuam com um item só. O item que entra vira dono do cursor no ponto de commit definido.
- Capacidade anunciada pelo engine: um servidor novo com engine antigo, ou engine de backup sem flag, faz CUT e avisa. Nunca falha o TAKE por falta de MIX. Isso também é uma decisão (D9).

---

## 7. Como testar sem DeckLink
O padrão de teste nativo já existe: `RunningChannel`, fixtures geradas com `videotestsrc`/`audiotestsrc`, `capture()` por appsink (`channel.rs:3646-3665, 3961-4020`), saídas `null`/`file:`/`snapshot:` e a ferramenta `bin/avsync.rs`.

- **Fixtures:**
  - item A com vídeo em cor sólida ou número de quadro codificado em barras de luma e áudio de 440 Hz;
  - item B em outra cor com 1 kHz;
  - variante com flash+bip a cada segundo, para medir A/V.
- **Corte:**
  - capturar o PGM pós-compositor e pós-limiter por appsink;
  - verificar o índice do quadro de corte contra o recibo `programCut`;
  - verificar a ausência de quadros repetidos (hash consecutivo; já existe `video_signature`);
  - medir o estalo pelo pico de derivada ou energia em passa-alta numa janela de ±5 ms do corte, com limiar fixo;
  - medir o A/V com o flash/bip antes e depois do corte.
- **MIX:**
  - para cada quadro em `[T0, T0+D]`, a cor medida = interpolação esperada, com tolerância de ±1 nível e ±1 quadro;
  - Goertzel em 440/1000 Hz por janela de 10 ms deve seguir a curva de ganho;
  - no fim, nenhum degrau na troca A↔B;
  - WIPE: posição da borda por coluna ou linha ao longo do tempo.
- **Matriz de cadência:** 25p, 29,97p (30000/1001), 50i, 59,94p; 2/8/16 canais; D = 1, 12, 25, 50 quadros e D = restante−1.
- **Casos negativos:** MIX com hold, com troca ao vivo pendente, com live sem quadro, D maior que o restante, segundo TAKE no meio, kill do engine no meio (o servidor retoma o item que entra com CUT ou bloqueia, conforme a política).
- **Soak de 24 h:** MIX ou CUT a cada 20–30 s com `frames_out` monotônico contra o esperado, RSS estável e CPU p95. Rodar com 4 canais simultâneos.
- Homologação em SDI/DeckLink real fica para o fim, por amostragem.

---

## 8. Estimativa (dias-pessoa, uma pessoa que já conhece o código)

| Fase | Conteúdo | Dias-pessoa |
|---|---|---|
| F0 | Bancada de medição do corte atual: fixtures, métricas de estalo, congelamento e A/V, matriz de cadência. **Gera a linha de base.** | 2–4 |
| F1 | Corte no meio do VT: recibo `programCut` no engine, declick, servidor/as-run/checkpoint/interrupções usando o recibo, UI de evidência, testes | 4–7 |
| F2 | MIX (dissolve) manual: ramo B com flag, controller, protocolo `take{transition}`, capacidade, recusas, estado `TRANSITIONING`, as-run, UI, testes nativos e soak curto | 13–22 |
| F3 | WIPE (smptealpha, 2–4 padrões) sobre F2 | 3–5 |
| F4 | Soak de 24 h multicanal e homologação em saída real | 3–5 (+ tempo de hardware) |
| — | **Total recomendado (F0–F4)** | **25–43** |
| F5 (não agora) | MIX automático no fim do VT: engine dispara em `out−D` de forma quadro-exata, planejador desconta sobreposição, semântica de recuperação | 8–14 |
| F6 (não agora) | Pular trecho MIDDLE das marcações do QC: TAKE agendado quadro-exato com segundo decoder do mesmo arquivo | 5–9 |

Os intervalos são largos porque o projeto exige provas nativas e recibos em cada mudança, e porque ainda não sabemos o resultado do audiomixer com 16 canais e do custo de CPU. **[inferência]**

**Ordem recomendada:** F0 → F1 → (decisões D3/D4/D6) → F2 → F3 → F4. F0 vem primeiro porque pode mostrar que o corte atual já está limpo, e então F1 encolhe para só o recibo.

---

## 9. O que eu recomendo NÃO fazer agora
- Substituir o `input-selector` por pads fixos no compositor e mixer.
- MIX automático no fim do item (F5). Mexe no planejador, na recuperação e cria um disparo automático novo.
- Transição em recuperação, contingência, passagem de playlist ou HA.
- Animar alpha ou volume pelo laço principal (como os fades de grafismo).
- Usar um segundo `interaudiosrc` no mesmo canal `inter`.
- DVE ou wipes com GL (`glvideomixer`): dependência de GPU num servidor 24/7.
- Ligar o `emergency_cut_fade_ms` ao acaso: hoje ele é morto. Ou ganha semântica definida em F1, ou deve ser removido.

## 10. Decisões do dono
- **D1.** "Corte no meio do VT" é TAKE sobre item em execução (já existe; falta qualidade e registro) ou pular trecho MIDDLE marcado no QC (F6)?
- **D2.** TAKE manual sobre VT deve gravar "VT interrompido" para retorno, como a inserção NOW já faz?
- **D3.** Semântica de MIX no as-run e na grade: o item que sai termina no início, no meio ou no fim da transição? O horário da grade desconta D?
- **D4.** MVP só com MIX manual (recomendado) ou já com automático?
- **D5.** Confirmar que recuperação, contingência e HA são sempre CUT (recomendado).
- **D6.** Curva do crossfade: potência constante (recomendado para materiais diferentes) ou linear?
- **D7.** Live como item que entra num MIX: só com quadro confirmado. Sem quadro: recusar ou cair para "CUT no primeiro quadro"?
- **D8.** Segundo TAKE durante uma transição: completar na hora ou ignorar?
- **D9.** Engine sem capacidade ou flag desligada: degradar para CUT com aviso ou recusar o TAKE?
- **D10.** Quais canais e servidores ligam a flag, e qual o orçamento de CPU aceito por canal.
- **D11.** Lista fechada de padrões de wipe, borda e suavidade.

## 11. Observações laterais
- `apps/engine/README.md` descreve a topologia antiga (um `intervideosrc`, sem seletor). Convém atualizar.
