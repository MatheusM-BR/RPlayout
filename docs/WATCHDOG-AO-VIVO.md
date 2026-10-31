# Watchdog das entradas ao vivo

Pedido do dono: se a entrada ao vivo cair, entra um grafismo por até 5 s. Passando disso é contingência: vinheta e, se for preciso, vários vídeos. O watchdog também tem de ver se o vídeo está íntegro, se a taxa caiu, se o áudio falhou ou travou, e se o conteúdo ficou "sem bitrate" (fade-to-black de 3 a 5 s no fim de um vídeo). Vale para toda entrada ao vivo (SRT, RTMP, NDI, OMT, SDI/DeckLink) e tem de ser configurável.

## O que já existia (reaproveitado)

| Peça | Onde | Uso no watchdog |
|---|---|---|
| Estatística por entrada no pad decodificado (`SourceStatistics`): idade do último quadro e do último áudio, quadros recebidos, jitter de chegada, conteúdo amostrado parado | `apps/engine/src/channel.rs` | Base de perda de sinal, congelamento e áudio ausente. Ganhou um campo `quality`. |
| Telemetria `sourceTelemetry` → `liveSources[].measurements.{pgm,pvw}` e `busSignals` (`videoRecent`/`audioRecent`) | engine `main.rs` → `apps/server/src/domain/engine.ts` | Fonte das amostras do watchdog. Agora sai a cada 500 ms (antes 1 s). |
| Retomada da live no ar (`LiveRecovery`, `restart_on_air`) | engine `main.rs` | Continua reabrindo a fonte enquanto a arte de espera está no ar. |
| Sonda PGM (preto/congelado/silêncio do **programa**) com histerese e contador | `apps/server/src/domain/pgm-probe.ts` | Mesmo padrão de histerese. Fica separada: ela olha o PGM composto, o watchdog olha a **entrada**. |
| Slate opaco (`setEmergencySlate`, livro de comandos gráficos) | `apps/server/src/app.ts` | É a arte de espera. Agora aceita uma arte cadastrada além da apresentação técnica do canal. |
| Reserva de contingência: playlist publicada em loop, só vídeos aprovados no QC, com cópia local verificada (`prepareContingencyPlaylist`, `enterContingency`) | `contingency-playlist.ts`, `app.ts`, `ContingencyLoopPanel.tsx` | É a contingência: o primeiro item é a vinheta e os demais são os vídeos. |
| TAKE de live só com quadro confirmado ("TAKE recusado… não confirmou quadro/áudio") | engine + `takeFromPlaylistNow` | Usado no retorno à live. A razão `WATCHDOG_LIVE_RETURN` foi liberada para fonte ao vivo. |
| CUE de fonte no PVW (`{kind:'SOURCE'}`) | `engine.ts` | Mantém a entrada em observação enquanto a contingência está no PGM. |

## O que foi acrescentado

**Engine (`apps/engine/src/input_quality.rs`).** As medições são baratas e saem do mesmo ponto do pipeline para todos os tipos de entrada: o pad que sai do decodificador (ou da placa/NDI/OMT, que já entregam quadro cru).

- **Taxa de chegada:** quadros por segundo numa janela de 2 s.
- **Taxa efetiva:** quadros *diferentes* por segundo. Usa uma impressão digital de 64 bytes por quadro e pega a fonte que repete quadro.
- **Luma:** média e desvio de uma grade 32×18 do plano Y (ou do RGB), no máximo 4 vezes por segundo. Lê I420/NV12/Y42B/Y444, as variantes de 10/12 bits, UYVY/YUY2, v210 (DeckLink 10 bits), AYUV e BGRA/RGBA/ARGB. Formato desconhecido não gera leitura (`lumaUnsupportedFormat`).
- **Áudio:** RMS por buffer (até 1024 amostras), amostras entregues por segundo contra a taxa nominal, carimbo de tempo parado e bloco idêntico repetido com som (áudio "travado").
- **Taxa de dados de rede:** bytes na saída do elemento de rede do `uridecodebin` (SRT, RTMP, UDP). NDI, SDI e OMT não têm esse número.

**Protocolo (`packages/protocol/src/live-watchdog.ts`).** Contrato com as detecções, os estados, a política (zod) com padrões e validação, a leitura tolerante de versões antigas, o ajuste por entrada e os rótulos em português.

**Servidor:**

- `domain/live-watchdog.ts`: detectores puros e a máquina de estados. A máquina devolve efeitos e só avança quando o executor confirma.
- `domain/live-watchdog-events.ts`: grava as transições e ações em `operator_decisions` (`LIVE_WATCHDOG_*`) e os incidentes em `health_events` (componente `LIVE_WATCHDOG`).
- `db/live-watchdog-policies.ts`: **migração 56**, aditiva. Cria só a tabela `live_watchdog_policies`, com revisão para recusar gravação concorrente.
- Rotas:
  - `GET /api/channels/:id/live-watchdog`: estado, política e eventos. Todos os papéis.
  - `PUT /api/channels/:id/live-watchdog`: configurar. **Supervisor ou acima** (`OUTPUT_CONTROL`).
  - `POST /api/channels/:id/live-watchdog/command`: `RETURN_NOW`, `HOLD` e `RELEASE_HOLD`. Operador ou acima (`TRANSPORT`).

**Interface:**

- `LiveWatchdogStrip`: indicador por entrada no **Master** (aparece só quando há live no PGM ou no PVW) e no **Monitor**. Mostra o estado, as métricas ao vivo e os botões "VOLTAR PARA A LIVE AGORA" e "MANTER CONTINGÊNCIA".
- `LiveWatchdogConfigDialog`: configuração, aberta pelo botão CONFIGURAR da faixa.

## Detecções e padrões

| Detecção | Condição (no sinal decodificado) | Tempo padrão | Ação padrão |
|---|---|---|---|
| Perda de sinal | nenhum quadro há mais de X ms (idade do quadro + atraso da entrega; amostra velha também conta) | 1 s | espera + contingência |
| Taxa baixa | taxa efetiva < 50 % da referência (cadência do canal ou da entrada) | 3 s | espera + contingência |
| Preto / sem informação | luma ≤ 6 % **e** desvio ≤ 3 % (opcional: chapado de qualquer cor) | 3 s | espera + contingência |
| Congelado | conteúdo amostrado igual (preto parado conta como preto) | 5 s | espera + contingência |
| Silêncio | RMS máximo do último segundo ≤ −60 dBFS | 10 s | só alerta |
| Áudio travado | sem amostra nova com vídeo andando, carimbo parado, bloco repetido ou < 50 % das amostras | 1,5 s | espera + contingência |
| Sem áudio | entrada que deveria ter áudio e nunca entregou | 3 s | só alerta |
| Taxa de dados baixa | rede < 300 kbps (só SRT/RTMP) | 3 s | só alerta |

Cada detecção pode ser *Desligada*, *Só alertar* ou *Espera + contingência*, com tempo e parâmetros próprios.

Outros padrões:

- **T1** (arte de espera) = 5 s e **T2** (estável antes do retorno) = 5 s.
- Retorno automático.
- Histerese de 1,5 s.
- Arte de espera = apresentação técnica do canal.
- Modo padrão = **só alerta**: o supervisor liga o automático depois de escolher arte e contingência.

Com os padrões, um fade-to-black de 3 a 5 s nunca chega à contingência, porque precisaria de 3 s de preto mais 5 s de espera. Se o preto passar de 3 s, a arte de espera entra. Para não cobrir nem isso, suba o tempo do preto (por exemplo, para 6 s).

**Ajuste por entrada:** modo próprio, "entrada tem áudio" (desliga silêncio, áudio travado e sem áudio para uma câmera NDI muda) e ações por detecção.

## Máquina de estados (por entrada no PGM)

```
            condição vista                 detecção de ação confirmada (modo automático)
   OK ───────────────────▶ SUSPEITA ─────────────────────────────────────────▶ ESPERA
    ▲  sem condição (histerese)  │                                  arte de espera no ar │
    └────────────────────────────┘                                                       │
    ▲                                                     ainda falhando após T1          ▼
    │   retorno confirmado                                ┌──────────────────────── CONTINGÊNCIA
    │   (arte retirada / TAKE da live                     │  playlist de reserva no PGM,
    │    confirmado com quadro real)                      │  entrada observada no PVW
    │                                                     │        │ sinal íntegro (PVW)
  RETORNO ◀── sinal íntegro (ESPERA) ─────────────────────┘        ▼
    │  estável por T2 → automático, ou espera o operador (modo manual / "manter contingência")
    └── falha confirmada de novo → volta a ESPERA ou CONTINGÊNCIA (T1 continua contando)
```

- **Histerese:**
  - Uma condição só é dada como encerrada depois de `clearHoldMs` limpa.
  - No RETORNO, qualquer recaída zera a contagem de T2.
  - Voltar de RETORNO para ESPERA mantém o início da ESPERA. Uma entrada que fica caindo e voltando chega à contingência em vez de ficar alternando arte e live.
  - Tudo é zerado quando o estado volta a OK.
- **Só alerta:** as detecções de ação viram alerta, e o estado nunca passa de SUSPEITA. O PVW é sempre só alerta.
- **Sem playlist de contingência:** o estado vira CONTINGÊNCIA "sem conteúdo", a arte de espera continua e um incidente crítico é aberto.
- **Ação recusada** (TAKE ou contingência sem confirmação): fica registrada, e a máquina tenta de novo em 10 s, sem avalanche.
- **TAKE manual** para outro item: o watchdog retira a própria arte e deixa de acompanhar. Se o operador sair da contingência por conta própria, o watchdog também deixa de acompanhar.
- **Arte "congelar último quadro"** não cobre o PGM. O engine retém o último quadro enquanto reabre a fonte, por cerca de 12 s, e depois vai a preto. É indicada só para quedas curtas.

## Registro (sem avalanche)

- **`operator_decisions`:** uma linha por transição real, por ação confirmada ou recusada e por comando do operador. Fica na trilha de auditoria, ao lado das decisões de contingência existentes.
- **As-run:** os vídeos da contingência e a volta da live aparecem como itens, porque entram por TAKE confirmado.
- **`health_events` (`LIVE_WATCHDOG`):**
  - Um incidente por episódio de condição, resolvido quando normaliza.
  - Mais: entrada em ESPERA ou CONTINGÊNCIA, falha de ação e retorno. SUSPEITA não abre incidente.

## Onde configurar e por quê

A configuração fica no **Monitor**, botão CONFIGURAR da faixa "Watchdog ao vivo" (Supervisor ou acima). O Monitor é a tela de engenharia do canal: a sonda PGM e a reserva "Configurar contingência e retorno" já ficam lá, e a contingência do watchdog usa a mesma reserva. Configurações › Entradas trata do cadastro das fontes. O ajuste por entrada fica dentro do mesmo diálogo, para a política do canal ser lida inteira num lugar só.

## Limitações conhecidas

- NDI e SDI/DeckLink não puderam ser testados no Linux de desenvolvimento, porque não há SDK NDI nem placa. As medições ficam no mesmo pad, depois da placa ou do demux, e os formatos que essas fontes entregam (UYVY, v210, BGRA) são lidos e têm teste unitário.
- A taxa de dados de rede só existe para fontes por URI (SRT/RTMP/UDP).
- Durante a contingência, o PVW fica ocupado observando a entrada. Um CUE do operador nesse intervalo substitui a observação, e o watchdog volta a sintonizar a entrada em seguida.
- "Sequência sem loop" não é oferecida: a reserva exige loop, para não terminar em preto. Uma lista que toca uma vez e para pode ser montada com a vinheta e os vídeos numa playlist curta, que se repete até a live voltar.
