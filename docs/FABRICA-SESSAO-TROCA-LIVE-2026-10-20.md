# 6.2 / 7.3 — fábrica de sessão autorizada, rotas e STOP entre processos

Estado: **SOURCE_INTEGRATED / LOCAL_TESTED / NATIVE_MEDIA_NOT_RUN**.
Não é corte nativo homologado nem instalador novo. Uso interno e testes.
Base: commit c50ce22 (snapshot de 19/10, enviado ao GitHub em 20/10).

## O que mudou neste lote

1. **Fábrica de sessão no ChannelRuntime** (`app.ts` → `nativeReplacementSession`,
   módulo `domain/native-live-replacement-session.ts`). Liga ledger, contexto
   atual da execução (revisão, ocorrência do as-run, posse, decoder/geração do
   PGM) e o helper atômico recibo+vínculo+checkpoint ao EngineTransport real.
   O contexto e o cursor são lidos no momento de cada uso; nada é congelado na
   requisição que criou a sessão. Bloqueia durante recuperação, contingência,
   retorno de interrupção pendente e passagem de playlist inconclusiva.
2. **Autorização reavaliada a cada comando, dentro da fila do engine.**
   O EngineTransport guardava por transação o objeto de persistência da primeira
   requisição; usar ali a autorização faria um COMMIT posterior herdar a sessão
   da requisição inicial. Agora cada comando leva sua própria
   `NativeReplacementAction`, instalada no slot da fila e removida quando o
   comando termina (ACK, timeout ou recusa). A persistência durável guardada pelo
   transporte só grava fatos do engine (recibo, STOP), exigindo apenas posse:
   continua funcionando depois que a sessão do operador expira. Os
   `validate/beforeSend` dessa persistência recusam: sem ação atual, nada é
   enviado. A autorização chama de novo `AccessControl` (sessão no banco,
   usuário habilitado, papel `TRANSPORT`, escopo de canal), confere que o
   operador é o mesmo e que o runtime não foi trocado.
3. **Rotas HTTP ligadas à fábrica** (`routes.ts`):
   - `POST /api/channels/:id/live-replacement` — corpo `{targetSourceId}`,
     cabeçalho `Idempotency-Key` obrigatório; grava intenção e envia PREPARE.
   - `POST /api/channels/:id/live-replacement/:tx/commit|cancel` — exige
     `{confirm:true}`; `.../status` consulta a mesma transação.
   - `GET /api/channels/:id/live-replacement/:tx` — journal durável.
   COMMIT sem `nativeProgramConfirmed` responde 409; resultado desconhecido
   devolve `outcomeUnknown:true` e orienta consultar, sem reenviar COMMIT.
   Nenhuma resposta declara saída física validada. Com engine que não anuncia o
   protocolo (r87 instalada), a rota recusa antes de qualquer byte. O failover
   manual existente continua METADATA_DECISION_ONLY e não chama a fábrica.
   Decisão: a permissão exigida é `TRANSPORT` (a mesma do TAKE), não
   `OUTPUT_CONTROL`; operador pode trocar a fonte da live no ar.
4. **Intenção abandonada antes do envio.** Lacuna anterior: `ledger.begin`
   grava o journal antes de o transporte criar a sessão; uma recusa nesse
   intervalo (engine sem protocolo, PGM sem live, contexto mudado) deixava o
   journal aberto e bloqueava todas as trocas futuras do canal. Novo
   `abandonUnsent`: fecha duravelmente só se `prepareSent` for falso, com
   auditoria `ABANDONED_BEFORE_SEND`; depois do PREPARE durável, só recibo
   nativo ou STOP fecham. Campo novo opcional no payload, validado pelo schema.
5. **Journal de outro processo do servidor após reinício completo.** Gancho
   `onStopDurable` executado dentro da seção durável do STOP do engine. Resolve
   em uma transação: (a) intenção não enviada do dono atual sem sessão no
   transporte → abandonada; (b) journal de execução anterior cujo dono está em
   `recoverablePredecessorRunIds()` (mesmo host, processo do servidor e PIDs de
   engine encerrados) → STOP com `previousOwnedGenerationExited`. Todo o resto
   é preservado e continua bloqueando novos cortes. Falha de gravação nessa
   etapa não transforma um STOP confirmado em PGM incerto (fica em
   `recoveryError`). Sem geração nativa identificada, nada é resolvido.
6. `AsRun.openOccurrence()` — acessor só de leitura da ocorrência aberta.
7. Teste preexistente `interruption-routes.test.ts`: dublê sem
   `closeGracefully/closeConfirmed` gerava 5 rejeições não tratadas no teardown
   e saída 1 já no commit c50ce22 (verificado com o código original). Corrigido
   só o dublê do teste.

## Evidência

- Typecheck completo do servidor: exit 0.
- Rodada focada (14 arquivos): **375 PASS / 0 FAIL**, sem erro não tratado após
  a correção do item 7. Novos: sessão 16, rotas 8, transporte +4 (198 no arquivo).
  Relatório: `scratch/fabrica-sessao-20261020/tests-focused.json`.
- Mutações de controle: remover a liberação da ação no fim do comando e remover
  o abandono da intenção não enviada derrubam os testes correspondentes.
  Remover a revalidação em `action.validate` NÃO derruba, porque
  `ledger.beforeSend` também revalida na fila (barreira dupla, intencional).
- Suíte completa do servidor (331 arquivos, Linux): 3163 PASS / 13 FAIL /
  1 pendente. As 13 falhas estão em 9 arquivos não tocados (cadence-conversion,
  distribution-processes, ha-local-payload, ha-local-probe, ha-media-replication,
  ha-replication, local-package, operational-routes, published-cache-plan) e
  são IDÊNTICAS no commit c50ce22 original (110 PASS / 13 FAIL nos dois): limites
  deste ambiente Linux (hardlink/junction, sonda de mídia, timing), não
  regressão do lote. Não foram investigadas a fundo nem corrigidas aqui.

Limites: SQLite real; filho nativo e transporte simulados; rotas via
Fastify.inject (não é acesso remoto). Não há IPC com engine novo, pixels/PCM,
NDI/OMT externo, DeckLink, interface, instalação ou r88.

## Ainda falta

1. Compilar e testar o Rust atualizado (12 testes escritos NOT_RUN); depois IPC
   real, vídeo/áudio, recuperação, CUE/próximo e repetição de comando.
2. Controles na interface web (as rotas existem; a UI não as chama).
3. Journal com PREPARE enviado pelo dono atual sem sessão no transporte (não
   deveria ocorrer; continua bloqueando até reconciliação manual).
4. Build da interface, seleção de componentes, r88, instalação e roteiro.

Totais mantidos: 10 grupos / 53 verificações — 8 concluídas, 34 em andamento,
4 pendentes, 7 v3. Nenhuma verificação ampla fechada por testes simulados.
