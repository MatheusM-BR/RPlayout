# Consumo equilibrado: polling, WebSocket e memória (r88-36)

Pedido: "Temos que ter consumo equilibrado; disparos desnecessários causam peso desnecessário."
Branch `fix/perf-r88-36`. Medições no container de QA (Linux, 2 CPUs), instância
de QA na porta 4220 com o servidor empacotado (`dist/server.cjs`, banco em
processo separado como na produção), engine nativo, um canal no ar com grade em
loop. Chromium sem H.264: os monitores WHEP não decodificam, mas todo polling
roda igual.

## 1. Resumo

| Tela (uma aba) | Antes (req/s) | Depois (req/s) | Aba oculta antes | Aba oculta depois |
|---|---|---|---|---|
| Master | 5,3 | **0,23–0,30** | 5,1 | **0,03** |
| Monitoramento (Engenharia) | 6,1 | **1,23** | — | **0** |
| QC | 2,0 | **0,20** | — | — |
| Configurações | 1,6 | **0,03** | — | — |
| Master + painel Distribuição | 5,3 | **0,27** | — | — |

- **Meta:** Master parado abaixo de 0,5 req/s por aba, oculto perto de zero.
  Cumprida, verificada por `scripts/perf-master-ocioso.mjs`.
- **O que sobra no Master visível:** é causado por evento real. Entram releituras da sonda, do grafismo e da
  próxima playlist quando o item no ar troca ou abre alarme, e a miniatura e o
  proxy do item novo.
- **O que sobra no Master oculto:** só a leitura das pendências quando abre um alarme crítico, que é o alarme sonoro.
- **Tempo real:** TAKE, CUE, tally, relógio e medidores seguem pelo WebSocket, sem mudança de latência.

| Servidor | Antes | Depois |
|---|---|---|
| Requisições, Master + Monitor + QC abertos (soak) | 12,5/s | 2,6/s |
| CPU do Node com essas 3 abas (média do soak) | 5,5–6,5 % | 3,6–4,3 % |
| Chamadas ao processo do banco, 3 abas | 154/s | 115–125/s |
| Chamadas ao banco sem nenhuma aba | 85/s | 85/s (laço interno, ver 6) |
| WebSocket, aba visível | 16–19 msg/s, 33 kB/s | 20 msg/s, 29 kB/s |
| WebSocket, aba oculta | 17 msg/s, 34 kB/s | 2 msg/s, 6,5 kB/s |
| Linhas no log por requisição de leitura | 2 | 0 (só comando, erro ou >1 s) |
| `GET /api/health-events` do selo ALERTAS, banco com 100 mil incidentes | 2140 ms | 28 ms (`?view=pending`) |
| Notificações abertas, 100 mil incidentes | 120 ms | 5 ms |

## 2. Inventário de polling e temporizadores da web

Legenda da coluna WS: **sim** = o dado já chegava pelo `live()`; **tópico** = agora o
servidor avisa pelo WebSocket quando muda; **não** = só HTTP.

### 2.1 Antes (r88-35/r88-36 base)

| Componente | URL | Intervalo | Roda oculta | WS |
|---|---|---|---|---|
| `DynamicCgSecondaryBar` (Master) | `/api/v1/graphics/layers` | 1 s | sim | parcial (`live.graphic`) |
| `LiveWatchdogStrip` (Master, Monitor) | `/api/channels/:id/live-watchdog` | 1 s | sim | não |
| `PgmProbeBanner` (Master) | `/api/v1/engineering/pgm-probe/status` | 2 s | sim | não |
| `ContingencyTool` | idem | 5 s | sim | não |
| `InterruptedItemsBanner` | `/api/channels/:id/interruptions` | 2 s | sim | não |
| `NextPlaylistPanel` | `/api/channels/:id/next-playlist` | 2 s (aberto/ativo) | sim | não |
| `PublishedContinuityPanel` | `/api/channels/:id/published-continuity` | 3 s | sim | não |
| `HeaderHealth` | `/api/processes` | 3 s | sim | parcial (`live.alerts`) |
| `HeaderHealth` | `/api/host-metrics`, `/api/clock`, `/api/health-events` (página com 30 linhas) | 10 s | sim | não |
| `App` (acervo) | `/api/library` + `/api/library/scan` + `/api/categories` | 10 s (1,5 s varrendo) | sim | `library` ao fim da varredura |
| `useNotifications` | `/api/notifications` | 10 s | não | não |
| `ContinuityCacheBadge` | `/api/v1/continuity/cache/status` | 30 s | sim | não |
| `useChannelMirror` | `/api/channels/:id/programming` | 30 s | sim | não |
| `useClockOffset` | `/api/health` | 60 s | sim | não |
| `Whep` (cada monitor) | `POST /api/channels/:id/watching` | 5 s por monitor | sim | não |
| `BroadcastMonitor` (WHEP caído) | `POST .../watching` + nova oferta WHEP | 5 s + 6 s fixos | sim | não |
| `Whep` (falha) | nova oferta WHEP | 3 s fixos, sem fim | sim | não |
| `BroadcastMonitor` (proxy) | `GET /api/assets/:id/media?preview=1` | a cada remontagem (425 em laço) | sim | não |
| `EngineeringDistributionView` | sources/live, srt/telemetry, host-metrics, processes, outputs, engineering/status, clock | 3 s (7 rotas) | sim | não |
| `MonitorEngineeringPanel` | `/api/channels/:id/monitors` | 2 s | sim | não |
| `CompositeMultiview` | multiview/composite; live-watchdog | 10 s; 2 s | sim | não |
| `SettingsView` | `/api/processes` | 3 s | sim | não |
| `QualityControlView` | `/api/assets/:id/workflow` | 3 s | sim | não |
| `QualityControlView` | quadro QC com 503 | 700 ms fixos, 8 vezes | sim | não |
| `use-qc-live-inputs` | sources/live + srt/telemetry | 3 s | sim | não |
| `use-qc-live-inspection` | `POST .../qc/inspection` | 500 ms abrindo, 5 s aberto | sim | não |
| `Distribution` | 7 rotas | 3 s (15 s oculto) | reduzido | não |
| `AsRunPanel`, `AiredView`, `TechnicalLogsPanel` | as-run, aired, logs | 2–3 s | sim | não |
| `IntegrationsPanel`, `StudioAutomationPanel`, `HaExecutionPanel`, `HaReplicationPanel` | respectivas | 5 s | sim | não |
| `StorageStatusPanel`, `HostResourcesPanel`, histórico do host, histórico operacional | respectivas | 15 s | sim | não |
| `SchedulePublicationPanel` | schedule-publication | 3 s (aberto) | sim | não |
| `PastasPanel` | `/api/library/scan` | 1,5 s varrendo | sim | não |
| `AudioDialog`, `LiveReplacementControl` | análise/estado | 1–2 s durante operação | sim | não |
| Temporizadores só locais | relógio do cabeçalho (40 ms), `nowMs` do Master (1 s), scopes (100–250 ms), multiview (250 ms), contagem do ABORT | — | navegador limita a 1 Hz | — |

### 2.2 Depois

| Componente | Disparo | Fallback (WS fora) | Aba oculta |
|---|---|---|---|
| Grafismo (`graphics`) | tópico + 60 s; contagem regressiva local | 1 s | pausa |
| Sonda PGM (`probe`) | tópico + 30 s; métricas vivas no próprio WS (1/s, ~330 B) | 2 s | pausa |
| Contingência | tópico; 5 s só com contingência no ar | 5 s | pausa |
| Watchdog (`watchdog`) | tópico (com entrada ao vivo, acompanha as métricas) | 1 s | pausa |
| Retornos (`interruptions`) | tópico + 60 s | 2 s | pausa |
| Próxima playlist (`nextPlaylist`) | tópico + 30 s (aberto/ativo) | 2 s | pausa |
| Continuidade (`continuity`) | tópico + 60 s | 3 s | pausa |
| Cabeçalho: engine/saídas (`engine`) | tópico + 60 s; `/api/processes?counters=0` | 3 s | pausa |
| Cabeçalho: selo ALERTAS (`health`) | tópico + 60 s; `?view=pending` | 10 s | pausa |
| Cabeçalho: relógio (`clock`) | tópico + 120 s | 10 s | pausa |
| Cabeçalho: disco/host | 60 s | — | pausa |
| Pendências e alarme (`alarms`) | tópico + 60 s | 10 s | **lê** (alarme sonoro) |
| Acervo/scanner (`scan`) | tópico só lê o scanner; acervo vem pela mensagem `library`; completo a cada 120 s (5 s varrendo) | 10 s | pausa |
| Monitores (`watching`) | **um** `POST .../watching/batch` por canal a cada 7 s com todos os monitores da aba | — | **não avisa**: o servidor desliga a codificação em 20 s |
| WHEP com falha | 3, 6, 12, 24, 30 s (±20 %) | — | — |
| Monitor caído | nova oferta em 6, 12, 24, 48, 60 s | — | — |
| Proxy leve 425 | lembrado por arquivo: 10 s, 20 s… até 5 min | — | sem `src`/`poster` |
| Quadro QC 503 | 700 ms dobrando até 5 s (8 tentativas) | — | — |
| Monitoramento | 5 s (entradas, SRT, processos, saídas), 10 s (host), 60 s (versão e relógio) + tópicos `engine`/`clock` | — | pausa |
| `MonitorEngineeringPanel` | 5 s | — | pausa |
| Multiview | 30 s; watchdog por tópico | — | pausa |
| QC: fila de mídia | 3 s preparando, 30 s pronto | — | pausa |
| QC: entradas ao vivo | 3 s com entrada, 30 s sem | — | pausa |
| QC: inspeção ao vivo | 500 ms → 2 s abrindo, 5 s aberto | — | não renova |
| Badge de cache, espelho, relógio do navegador | 120 s, 60 s, 60 s | — | pausa |
| Painéis técnicos (as-run, aired, logs, integrações, automação, HA, armazenamento, histórico) | mesmo intervalo de antes | — | pausa (`whenVisible`) |
| `Distribution` | inalterado (já pausava a 15 s) | — | 15 s |

### 2.3 Mecanismo

- **Servidor** (`apps/server/src/domain/live-topics.ts`, `live-topic-sources.ts`):
  - Uma vez por segundo, e só com navegador conectado, calcula uma assinatura de cada tópico a partir do estado em memória e de consultas de ponta de índice (O(log n)).
  - Campos que andam sozinhos, como o relógio e a duração em curso, ficam fora da assinatura.
  - Quando a assinatura muda, sai `{type:'topics', channelId, revs}`, de cerca de 330 B.
  - A mensagem não carrega dado de domínio. A tela relê pela rota de sempre, com as mesmas checagens de acesso.
  - O socket recém-conectado recebe as revisões atuais.
- **Web** (`apps/web/src/domain/live-topics.ts`):
  - `useTopicRefresh` relê quando o tópico sobe e quando a aba volta a ficar visível com leitura pendente.
  - Mantém um polling longo de segurança.
  - Enquanto o WebSocket não entrega tópicos (servidor antigo, rede caída), volta ao intervalo antigo: perder o aviso nunca congela a tela.
- **Aba oculta:**
  - A aba avisa pelo WebSocket (`{type:'visibility'}`) e passa a receber `live` a 1 Hz por canal (`LiveSocketPacing`).
  - Grade, acervo e tópicos chegam na hora.
- **Leituras idênticas em voo:** `GET` simples com a mesma URL (sem corpo, cabeçalho ou `signal`) é uma requisição só (`sharedRead` em `api.ts`).
- **Heartbeat:** `MonitorWatch` (`apps/web/src/domain/monitor-watch.ts`) junta todos os monitores da aba num aviso por canal.
  - Monitor novo avisa em 30 ms. Fechado, sai do aviso imediatamente (`release`) ou em 16 s.
  - A rota antiga `POST /api/channels/:id/watching` continua para clientes antigos.

## 3. Servidor: custo das rotas polidas

| Rota | Custo encontrado | O que mudou |
|---|---|---|
| `/api/health-events` (selo do cabeçalho, 10 s por aba) | Página inteira: 2 contagens de pendentes, 3 contagens de risco sem índice adequado, total filtrado, 30 linhas com mensagem decifrada. 2,1 s com 100 mil incidentes | `?view=pending`: só as duas contagens pelo índice de pendentes por canal, 28 ms |
| `/api/notifications` | Varredura da tabela inteira e ordenação (sem índice para SIGNAL/CRITICAL aberto): 120 ms com 100 mil | Índice parcial `health_events_open_alerts`: 5 ms |
| `/api/v1/engineering/pgm-probe/status` | Devolvia o histórico inteiro da sonda, sem teto: com 6500 alertas, **2 MB por leitura**, e o Master lia a cada 2 s e a cada 5 s | Histórico em memória limitado a 100 (32 kB); leitura por tópico |
| `/api/processes` | No Windows, um `powershell.exe` por leitura (cache de 2 s). Cabeçalho, Monitoramento e Configurações liam a cada 3 s | Cabeçalho e Configurações usam `?counters=0`, sem contadores do SO; cache dos contadores em 5 s |
| `/api/library` + `scan` + `categories` | Releitura completa a cada 10 s por aba, e a cada fim da varredura automática (60 s), mesmo sem nada novo | Varredura sem mudança em `media_assets` não manda `library` nem regrava a grade dos canais |
| Log HTTP | Duas linhas JSON por requisição; a captura de logs técnicos fazia `JSON.parse` de cada uma para descartar | Uma linha só para comando, erro (≥ 400) ou leitura lenta (≥ 1 s) |
| `live-watchdog`, `interruptions`, `next-playlist`, `published-continuity`, `graphics/layers` | Rápidos individualmente (3–11 ms), mas a 1–3 s por aba | Lidos só quando o tópico muda |

## 4. WebSocket `live()`

- **Frequência:** 20 Hz por canal, enquanto houver socket.
  - A mensagem tem cerca de 1,3 kB: estado do transporte, medidores, alertas e multiview.
  - É serializada **uma vez** por envio e mandada para todos os sockets autorizados (já era assim).
  - A autorização de cada socket fica em cache de 1 s.
- **Aba oculta:** agora 1 Hz (era 20 Hz). Uma aba de Master esquecida aberta em segundo plano passou de 34 kB/s para 6,5 kB/s.
- **`view`:** cerca de 75 kB, a grade inteira. Sai na troca de item e em mudança editorial, uma vez a cada 15–20 s nesta grade de teste.
- **Não feito:** enviar diferença em vez do estado inteiro. A `live` de 1,3 kB a 20 Hz é aceitável (26 kB/s por aba visível). Uma `view` em diferença economizaria mais, mas mexe no contrato de grade e de execução que outros itens da r88-36 tocam. Fica como próximo passo (ver 7).

## 5. Retenção e índices

- **`health_events`:**
  - A retenção (30 dias, a cada 10 min) só apagava o que tinha ciente. INFO nunca recebe ciente, então todo INFO (partidas, recuperações, repetições) ficava para sempre.
  - Agora INFO antigo sai mesmo sem ciente. Aviso e crítico sem ciente continuam preservados.
  - O expurgo roda em lotes de 5000, como a auditoria HTTP: o primeiro expurgo de um banco grande não segura o armazenamento.
- **Índices novos** (`db/health-query-indexes.ts`):
  - São `CREATE INDEX IF NOT EXISTS`, não migração: não mudam coluna nem dado, e uma edição anterior abre o banco normalmente.
  - Lista: `open_alerts` (parcial), `ack_time`, `resolved_time`, `observation_time`, `severity`.
  - As assinaturas `health` e `alarms` custam 0,006 ms com 100 mil linhas.
- **Decision log (`operator_decisions`):**
  - A auditoria HTTP `@http` já tinha retenção de 90 dias em lotes.
  - O heartbeat de monitor não é auditado, nem a rota nova `watching/batch`.
  - Registros operacionais e de segurança são imutáveis por gatilho e não entram na retenção, por desenho.
- **Agrupamento de alertas repetidos:** é feito pelo outro agente (`a978e42`) e reduz a entrada. Aqui se garante só que consulta e retenção não pesem.

## 6. Memória do Node

### Medido aqui (Linux, Master + Monitoramento + QC abertos)

| | Antes (40 min) | Depois (40 min) |
|---|---|---|
| RSS no início | 218 MB | 192 MB |
| RSS em platô | 333–339 MB (a partir de 5 min) | 312–322 MB (a partir de 15 min) |
| Heap do V8 (snapshot aos 3 min e aos 38 min) | 54,5 → 55,1 MB | 53,5 → 53,7 MB |
| Maior crescimento entre snapshots | código JIT (+547 kB), sem objeto de domínio | nenhum (objetos caíram) |
| `heapUsed` amostrado | — | 38–58 MB, oscilando, sem tendência |

- **Soak final (30 min, build final, com a suíte de testes rodando ao lado):**
  - RSS de 197 → 321 MB em platô a partir de 20 min.
  - `heapTotal` de 47–79 MB, `heapUsed` de 38–54 MB, `external` de 3 MB.
  - Snapshots aos 3 e aos 28 min: 52,6 → 53,7 MB, só código JIT.
  - Ou seja: dos ~320 MB de RSS, só ~80 MB são heap do V8. O resto é nativo, incluindo ~80 MB deixados pelo próprio snapshot.
- **Sem vazamento de objetos do JavaScript:** nenhum construtor de domínio cresce entre os snapshots.
- **Cada snapshot custa cerca de 80 MB de RSS** (degrau visível no CSV). Não é crescimento do servidor.
- **O RSS acima do heap é memória nativa:**
  - o binário e o código do Node;
  - a thread do bridge do banco (outro isolate V8);
  - o `SharedArrayBuffer` de 16 MB da ponte com o banco;
  - buffers de rede.
- **Processo do banco:** à parte, de 63 a 67 MB.

### Caches e estruturas revisados

| Estrutura | Limite |
|---|---|
| `QcFrames` (quadros de QC) | 64 MB por bytes, fila 6, concorrência 2, entradas em voo removidas |
| `TechnicalLog` | 5000 linhas × até 4000 caracteres (teto teórico ~40 MB) |
| Histórico do watchdog | 200 |
| `ProcessMetrics.previousCpu` | 512 |
| Statements preparados do banco em processo | 512 |
| Autorização de socket e cadência de aba oculta | `WeakMap`, somem com o socket |
| `recorded` do laço | uma chave por canal ou condição |
| Tópicos | apagados quando o canal some |
| `inflightReads` e heartbeat na web | removidos ao terminar ou fechar |
| **Histórico de alertas da sonda PGM** | **não tinha limite** (vazamento real, corrigido): agora 100 (`pgm-probe-history.test.ts`) |

### Por que a produção fica perto de 900 MB

Dados da produção, r88-35: 233 MB, 1124 MB em 2 h, platô de 820 a 965 MB, 857 MB no fim. Engine estável, 6500 incidentes por dia.

1. **O formato é de dimensionamento do heap, não de vazamento linear.**
   - O V8 dimensiona o heap pela taxa de alocação. Com muito lixo por segundo, ele cresce a geração velha e o espaço novo até um alvo alto e não devolve memória ao sistema enquanto não houver pressão.
   - No Windows, o working set acompanha.
   - O resultado é exatamente "sobe muito na primeira hora e oscila num platô".
2. **As fontes de lixo por segundo eram as leituras de polling** (5 req/s por aba, com tela, cabeçalho e monitores).
   - Cada uma passa por `JSON.stringify`.
   - Cada uma copia o resultado do banco em processo para um `Buffer` novo (`deserialize`).
   - A maior era o status da sonda PGM. Com 6500 alertas no histórico (um por passagem do VT mudo em loop), cada leitura gerava ~2 MB de JSON mais a cópia do histórico, a 1,4 leitura por segundo por aba: **~1,4 MB/s por aba aberta, crescendo com o histórico**.
   - Por isso o pico (1124 MB) coincide com as primeiras horas do loop, e o platô depende de quantas abas estavam abertas ("interface aberta parte do tempo").
3. **O histórico em memória da sonda era retenção real, sem limite.**
   - Pequeno em bytes (alguns MB por dia), mas era ele que fazia o item 2 crescer.
4. **Não foi possível reproduzir os 900 MB aqui.**
   - Aqui o platô é ~320 MB nos dois casos, porque a sonda deste QA não acumulou milhares de alertas em 40 min.
   - Numa simulação isolada (6500 alertas lidos 3 abas × 1,4/s), o V8 do Linux recolheu sem crescer.
   - Logo, o item 2 é a explicação mais provável, **não demonstrada** no Windows.

**O que baixa o patamar:**
- 20× menos requisições por aba;
- status da sonda limitado a 32 kB;
- aba oculta quase sem tráfego;
- log HTTP sem duas linhas por leitura;
- varredura sem novidade que não relê nada.

**Para confirmar na próxima r88:** `/api/host-metrics` passou a trazer `process.heapTotalBytes`, `externalBytes` e `arrayBuffersBytes`, gravados no histórico do host a cada 10 s.
- Se `heapTotal` acompanhar o RSS, é o heap do V8 (item 1).
- Se `external`/`arrayBuffers` crescer, são Buffers (cópias do banco ou do QC).
- Se nenhum dos dois, é memória nativa (thread do bridge, alocador do Windows).
- Só depois disso vale fixar `--max-old-space-size` no launcher: fixar sem medir pode derrubar o servidor do ar.

**Laço interno sem interface:**
- São cerca de 85 chamadas por segundo ao banco: portão de grafismo (37/s, a 20 Hz), checkpoint, interrupções e posse da execução.
- Não depende de aba aberta, então não pesa no consumo por tela, mas é o próximo alvo de CPU (ver 7).

## 7. Riscos e próximos passos

- **Riscos:**
  - **Tópicos dependem do WebSocket.** Com o WebSocket caído, cada tela volta ao intervalo antigo; com tópicos chegando, há a releitura longa de segurança (30–120 s).
  - **Mudança sem assinatura atrasa.** Uma mudança que não altere nenhuma assinatura só aparece na releitura de segurança. Exemplo: um texto de política salvo por outra estação no mesmo segundo em que voltou ao valor anterior.
  - **Aba oculta não avisa os monitores.** Em 20 s o servidor desliga a codificação. Ao voltar, o monitor acende de novo, levando o tempo de uma oferta WHEP.
  - **Aviso de visibilidade é dado pelo cliente.** Quem não manda o aviso (cliente antigo) continua a 20 Hz.
- **Próximos passos:**
  - `view` em diferença;
  - portão de grafismo do laço de 20 Hz em memória (37 chamadas por segundo ao banco);
  - medir `heapTotal`/`external` num soak de 24 h no Windows.

## 8. Como medir de novo

- **Regressão:** `node scripts/perf-master-ocioso.mjs http://127.0.0.1:4220 30`.
  - Visível < 0,5/s; oculto < 0,1/s.
  - Use uma grade sem mídia que gere alarme em loop (preto ou mudo). Num canal assim, cada passagem abre alarme crítico real e as pendências são relidas, de propósito.
- **Scripts de QA usados:** em `/tmp/qa/perf-scripts`, fora do repositório.
  - `measure.js <tela> 30 [hidden]`: req/s, CPU, RSS e WebSocket por tipo.
  - `soak.js <min> <csv> <snapshots>`: RSS, CPU, req/s, heap e chamadas ao banco a cada 30 s.
  - `heapdiff.js`: compara dois snapshots por construtor.
