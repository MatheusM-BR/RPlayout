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
- **Níveis** (`Quality`, já parametrizados para ligar ao seletor de output.rs):

| Nível | Mosaico | Cadência | Bitrate |
|---|---|---|---|
| REFERÊNCIA | 1920×1080 | a do canal | 8 Mbps |
| PADRÃO (padrão) | 1280×720 | a do canal, ou metade acima de 30 q/s | 3 Mbps |
| LEVE | 960×540 | 15 q/s | 1,2 Mbps |

- **Sob demanda:** o monitor `mv` segue o mesmo `watching` dos monitores `pvw` e `mon`. Sem espectador não há sonda instalada, pipeline nem thread (custo zero). O desligamento acontece 20 s depois do último aviso.
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
- `PUT /api/channels/:id/multiview/composite` pede `If-Match`. Salvar layout e células exige `PLAYLIST_EDIT`, como o layout das fontes individuais. **Trocar o nível exige `OUTPUT_CONTROL` (Supervisor ou acima)**, porque muda o custo de codificação na máquina do ar. A regra entrou na matriz `route-authorization-matrix.test.ts`.
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
- **NVENC/QSV:** o monitor sai em software (`prefer_software`), como os outros monitores. A contagem de sessões NVENC é do outro branch.
- **CPU e latência reais** com entradas NDI, SRT e SDI e decodificação H.264 do Chrome/Edge (provavelmente por hardware): os números acima são relativos, num container de 2 núcleos.
- **Fontes reais nas células:** NDI, SRT e DeckLink no PVW, NEXT, QC e contingência, além do tally e do VU com áudio de verdade.

## Limites e próximos passos

- Uma entrada aparece **só quando o engine a tem aberta** (PGM, PVW, NEXT, QC ou contingência). Não é limitação do multiview: é a regra da casa de não abrir segunda conexão (SDI e SRT listener não aceitam duas) e de o Monitor não sintonizar nada. Para ver todas as entradas o tempo todo, como num multiviewer de hardware, o passo seguinte é o **ingest único por entrada**: cada entrada decodificada uma vez e distribuída por superfícies para PGM, PVW e multiview. O multiview já está pronto para isso: basta mais um `TapPoint` por entrada.
- O mosaico é **um por canal**. Trocar o layout troca para todos que estão olhando, e a interface avisa antes de salvar.
- VU só existe onde há medição real (PGM e PVW).
