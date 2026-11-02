# Esboço: operar o RPlayout por Telegram (verificação inicial)

Data: 2026-10-30. Status: esboço para decisão, nada implementado. Telegram segue adiado.
Código lido: `packages/protocol/src/permissions.ts`, `apps/server/src/routes.ts`, `domain/alert-notifier.ts`, `domain/integration-outbox.ts`.

## 1. Resposta curta

Dá para operar por Telegram sem acessar o servidor, em partes:

- **Viável já, sem rota nova:** leitura (estado, alertas, playlist, fontes) e alertas bidirecionais. O envio já existe. Falta um serviço que receba as mensagens e chame a API existente.
- **Viável com poucas rotas novas:** programar entradas live (`/live`) e verificar a fonte (`/testar`).
- **Possível, mas arriscado:** TAKE, parar canal e publicar. Só com SUPERVISOR+, confirmação em dois passos e kill switch.
- **Desaconselhado:** mexer em usuários, saídas, configuração de canal, HA e cofre pelo Telegram.

O Telegram deve ser um cliente da API existente, como a UI web. Ele não pode virar caminho paralelo ao playout.

**"Vomitar":** entendi como despejar/enviar em lote (exportar ou listar a playlist ou os logs). Tratei como "listar/exportar em lote" (`/exportar`, nível 0). **Dúvida registrada:** confirmar se é isso, ou se era outra coisa (ex.: "voltar"/desfazer).

## 2. O que o servidor já expõe

Referências `routes.ts:linha` são aproximadas.

### 2.1 Autorização existente

`permissions.ts` define `OPERATOR < PROGRAMMER < SUPERVISOR < ADMIN`.

| Ação | OPERATOR | PROGRAMMER | SUPERVISOR | ADMIN |
|---|---|---|---|---|
| TRANSPORT | sim | sim | sim | sim |
| PLAYLIST_EDIT | sim | sim | sim | sim |
| PLAYLIST_PUBLISH | não | sim | sim | sim |
| OUTPUT_CONTROL | não | não | sim | sim |
| CHANNEL_STOP | não | não | sim | sim |
| USER_MANAGE | não | não | não | sim |
| REPORT_EXPORT | sim | sim | sim | sim |

GESTOR (entre SUPERVISOR e ADMIN) ainda não existe no código.

Mecanismos de segurança que o bot herda se usar a mesma API:

- Escopo por canal: hook global em `routes.ts` ~700-715 devolve 403 se a conta não tem o canal (`identity.channelIds`).
- Canal arquivado e grade espelhada: o mesmo hook bloqueia escrita (409).
- Posse de transporte em HA: `assertTransportOwnership`, standby recusa escrita (~598).
- Auditoria: `securityAudit(...)` (~583) grava com o ator. `GET /api/audit` (~807) filtra por `actor`. `GET /api/audit/integrity` (~822) confere a cadeia de selos.

**Achado importante:** `POST /api/channels/:id/transport` (~5539) exige só `PLAYLIST_EDIT` para `take`, `cue`, `park` e `seek`. `CHANNEL_STOP` só vale para `stop`. Hoje um OPERATOR pode dar TAKE pela UI. A regra "TAKE só SUPERVISOR+" **não existe no servidor**. O bot terá que impor essa regra por conta própria (camada Telegram), ou o dono muda a regra para todos. Isso é decisão de produto (pergunta 4).

**Achado 2:** o ciente de incidente (`POST /api/health-events/:id/ack`, ~858) exige `CHANNEL_STOP`, ou seja SUPERVISOR+. Mensagem do servidor: "Supervisor precisa reconhecer alertas." Um OPERATOR vinculado não poderá dar `/ciente`. Isso casa com a escalada (SUPERVISOR aos 2 min, ADMIN aos 7), mas contraria "ciente é nível 1 para qualquer um". Decidir (pergunta 5).

### 2.2 Rotas existentes por capacidade

| Capacidade | Rota (arquivo:linha) | Autorização | Serve ao bot? |
|---|---|---|---|
| Canais e grades | `GET /api/state` (1647) | escopo de canal | sim, `/status` |
| Estado do agendador | `GET /api/scheduler/status` (1462) | escopo de canal | sim, `/agora`, `/proximos` |
| Timeline do canal | `GET /api/channels/:id/timeline` (1626) | escopo | sim, `/agora` |
| Playlists em arquivo | `GET /api/playlists` (2188), `GET /api/playlists/entries?path=` (2212) | escopo; caminho precisa estar no acervo | parcial (ver abaixo) |
| Grade operacional | `GET /api/rundowns/:id` (3235), `GET /api/rundowns/:id/operational-playlist` (2271) | escopo | sim, `/playlist` |
| Exportar grade | `GET /api/rundowns/:id/export.csv` (3246) | REPORT_EXPORT | sim, `/exportar` |
| Fila de pendências | `GET /api/notifications` (852) | REPORT_EXPORT, filtrada por papel e canal | sim, `/alertas` |
| Eventos de saúde | `GET /api/health-events` (835), `.csv` (841) | escopo | sim |
| Ciente | `POST /api/health-events/:id/ack` (858) | CHANNEL_STOP | sim, `/ciente` |
| Ciente de interrupção | `POST /api/channels/:id/interruptions/:interruptionId/acknowledge` (4568) | OUTPUT_CONTROL, exige `requestId`, `reviewToken`, `confirm:true` | ao ar, não para o MVP |
| Fontes live: listar/ver | `GET /api/sources/live` (4134), `/:id` (4158), `GET /api/channels/:id/live-source-review` (4121) | escopo | sim |
| Fontes live: criar/editar/apagar | `POST/PUT/DELETE /api/sources/live[/:id]` (4149/4162/4165) | PLAYLIST_EDIT; exige `If-Match` e revisão (`sourceEditHooks`) | sim, com revisão |
| Forçar failover | `POST /api/sources/live/:id/force-failover` (4173) | a conferir | ao ar, desaconselhado no Telegram |
| Troca de live no PGM | `POST /api/channels/:id/live-replacement` (4542) e `.../:transactionId/commit\|cancel\|status` (4556) | ao ar; commit exige `{confirm:true}` e `Idempotency-Key` | fase 3 |
| Duração da live | `GET .../live-duration-review` (2554), `POST .../live-duration` (2566) | token de revisão | fase 2 (opcional) |
| TAKE, CUE, STOP, PARK | `POST /api/channels/:id/transport` (5539), `action: take\|cue\|stop\|park\|seek`, aceita `sourceRef` para abrir entrada de rede no PVW | PLAYLIST_EDIT (stop: CHANNEL_STOP) | fase 3 |
| Publicar grade | `POST /api/rundowns/:id/operational-publish` (2406) | PLAYLIST_PUBLISH | fase 3 |
| Sonda do PGM | `GET /api/v1/probe/pgm/status` (5720) | engenharia | sim, leitura |
| Contas | `POST /api/users` (931), `PUT /api/users/:id/access` (954) | USER_MANAGE | só a UI |
| Integrações | `GET/POST /api/integrations` (870/876), `POST .../:id/test` (882), entregas e retry (885-888) | ADMIN | só a UI |
| Controle externo | `POST /api/external/control` (5501) | token único `RPLAYOUT_CONTROL_TOKEN`, sem identidade de pessoa | **não usar** para o bot |

**Sobre `/api/playlists`:** lista arquivos de playlist em pastas do acervo (`Playlists.findPlaylists`). É outro conceito que a grade (`rundowns`). Antes de montar `/playlist`, decidir qual fonte o dono chama de "playlist" (pergunta 3).

### 2.3 O que falta (rotas e componentes inexistentes)

Não encontrei nada disso no código:

1. **Vínculo Telegram↔conta:** tabela `telegram_links` (user_id Telegram, conta, papel, canais, estado, criado por, expira) e rotas de ADMIN para gerar código, listar e revogar.
2. **Identidade de serviço por pessoa:** o `access.identity(request)` existente é de sessão web. O bot precisa chamar a API *em nome* de uma conta vinculada, com o papel dela e o escopo de canais, e ator `telegram:<conta>`. Opções: (a) o bot roda dentro do processo do servidor e usa o mesmo núcleo de autorização, ou (b) token de serviço que permite "agir como" só contas vinculadas e só com `can(...)`. Recomendo (a)/(b) com checagem de `can()` no servidor, nunca só no bot.
3. **Verificação de fonte (`/testar`):** não achei rota "testar fonte sem ir ao ar". Há `live-source-review` (revisão de cadastro, "not discovery or proof of a usable signal") e a sonda do PGM (só PGM). O mais próximo é `transport` `cue` com `sourceRef` no PVW. Falta uma rota de sonda de sinal da fonte (conectar, medir vídeo/áudio por poucos segundos, devolver ok/falha), que não toque PGM nem PVW.
4. **Confirmação em dois passos centralizada:** hoje cada fluxo tem o seu (`reviewToken`, `confirm:true`, `Idempotency-Key`). Falta um serviço de "comando pendente" com TTL.
5. **Kill switch e modo somente-leitura** do canal Telegram (flag persistida, auditada).
6. **Eventos `signal.*` e `clock.*`**: citados como "em breve"; o bot só os mostra quando existirem.
7. **Receber mensagens:** hoje só há envio (`integration-outbox.ts` ~94-98 monta `sendMessage`). Nada recebe updates.

**Ponto de atenção no que já existe:** o destino Telegram atual é uma URL `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>` guardada como alvo de integração. O token fica na URL. Conferir se o alvo é guardado cifrado no cofre (`installationVault`) e se aparece em logs, na tela de entregas ou em `lastError`. Para o bot novo, guardar o token só no cofre, fora de URL.

## 3. Telegram Bot API (verificação na doc oficial)

Fontes: `core.telegram.org/bots/api`, `/bots/faq`, `/bots/webapps`, consultadas em 2026-10-30. A página da API mostrou **Bot API 10.3, de 24/ago/2026**.

**Confirmado nesta consulta:**

| Tema | Fato |
|---|---|
| Recebimento | `getUpdates` (long polling) e `setWebhook` são mutuamente exclusivos. Updates ficam no servidor do Telegram por no máximo 24 h se o bot não os receber. |
| getUpdates | `limit` 1-100, `timeout` define a espera; chamar com `offset` maior confirma os anteriores. |
| Webhook | Exige URL **HTTPS**. Portas 443, 80, 88, 8443. `secret_token` de 1-256 caracteres (A-Z a-z 0-9 `_` `-`), enviado no cabeçalho `X-Telegram-Bot-Api-Secret-Token`. `max_connections` 1-100 (padrão 40). Resposta fora de 2xx gera novas tentativas e depois desistência. |
| Limites de envio (FAQ) | Cerca de 1 mensagem/s por chat (rajadas curtas toleradas, depois 429). Em grupo, no máximo 20 mensagens/min por bot. Envio em massa: cerca de 30 mensagens/s no total. |
| Privacidade em grupo | Com privacy mode ligado o bot só vê comandos endereçados a ele e respostas às suas mensagens. Bots nunca veem mensagens de outros bots. |
| Mini Apps | Seis a sete formas de abrir (botão de teclado, botão inline, menu, link direto etc.). O servidor deve validar `initData` antes de confiar; `initDataUnsafe` não é confiável. A 10.2 bloqueia chamadas de Mini App a origens diferentes da original, ativado para todos em 20/jul/2026. |

**Não consegui confirmar nesta consulta** (a página é grande e o trecho lido não cobriu): `callback_data` 1-64 bytes, `sendMessage.text` até 4096 caracteres, `editMessageText`, `answerCallbackQuery`, `setMyCommands`, formato exato do HMAC de `initData`, e se há `retry_after` em 429. São valores que conheço da documentação, mas **verificar na página antes de implementar**. O `alertText` atual corta em 3500, o que é compatível com 4096.

**Consequências de projeto:**

- **Long polling, não webhook.** O servidor de ar normalmente só tem saída. Webhook exigiria URL pública HTTPS, ou seja, abrir entrada no servidor de ar, o contrário do objetivo. Long polling só faz conexões de saída a `api.telegram.org`. A latência fica em ~100-500 ms, aceitável para ciente e leitura.
- **Onde rodar o poller:** idealmente processo separado do motor de ar (ou ao menos isolado por falhas), com fila e limites, para que queda do Telegram não afete o playout. Ver riscos.
- **Teclados inline e `callback_query`:** a seleção por botões (canal → horário → fonte) funciona; `callback_data` é curto, então não colocar dados dentro dele. Usar um id curto de sessão de comando guardado no servidor (ex.: `c:<id>:<opção>`).
- **Edição de mensagens:** atualizar a mesma mensagem durante o fluxo e ao confirmar, para não inundar o chat (limite de 1 msg/s por chat).
- **Mensagens longas:** playlist grande deve ser paginada (botões "próxima página") ou enviada como arquivo (`/exportar` → CSV). Não despejar em texto.
- **Comandos:** registrar com BotFather (`/setcommands`) ou `setMyCommands`. Comandos são só atalho de interface; a autorização é nossa.
- **Grupo x privado:** privado (1:1) para comandos. Grupo só para **alertas** (leitura). Em grupo, qualquer membro vê o chat; comandos de ação não devem funcionar em grupo (ou exigir privado).
- **Mini App:** alternativa para telas ricas (grade completa, escolha de horário). Exige hospedar página HTTPS pública, ou seja, nova superfície exposta. Fica para depois, se o teclado inline não bastar.

**O que NÃO é seguro:**

- **Token do bot:** quem o tem controla o bot (lê comandos, envia mensagens). Guardar no cofre, nunca em URL, log ou repositório; rotacionar no BotFather se vazar.
- **`chat_id` de terceiros:** identifica destino, mas não prova quem é a pessoa. Autorizar por `from.id` do usuário, nunca pelo `chat_id` do grupo, e nunca por `@username` (mutável e reutilizável).
- **Sem criptografia ponta a ponta nos bots:** conversas com bots são chats em nuvem (não são "chats secretos"); o conteúdo trafega e fica nos servidores do Telegram. Não enviar senhas, tokens, URLs de ingestão com chave, caminhos internos, IPs de infraestrutura. (Afirmação conhecida da documentação geral do Telegram, não revalidada nesta consulta.)
- **Mensagens enviadas ficam no histórico do chat** em todos os dispositivos da pessoa. Se ela perder o celular ou o Telegram for comprometido, o histórico vaza. O `sanitizeDiagnostic` já usado nos alertas deve valer para toda saída do bot.

## 4. Modelo de segurança

| Controle | Desenho |
|---|---|
| Lista de permissão | Tabela de vínculos por **`from.id` numérico** do Telegram. Mensagem de qualquer outro id: ignorada, sem resposta (não revela que o bot existe) e registrada em contador. |
| Vínculo | ADMIN (e GESTOR, quando existir) gera na UI um **código de uso único** (8-10 caracteres, validade de 10 min, ligado a uma conta e papel). A pessoa envia `/vincular <código>` **em chat privado**. O servidor consome o código (atômico) e grava o `from.id`. Nunca por username, nunca por número de telefone. |
| Papel | O papel vem da **conta RPlayout**, nunca do Telegram. Mudou o papel ou desativou a conta: o vínculo acompanha. O teto do bot pode ser menor que o da conta (ver modo). |
| Modo por vínculo | Padrão: **somente leitura**. Cada nível acima (ciente, programação, ao ar) liga por vínculo e por canal, pelo ADMIN. |
| Escopo de canais | Mesmo `channelIds` da conta. O bot nunca lista nem age em canal fora dele. |
| Ações ao ar (TAKE, parar, publicar, troca de live) | **Dois passos:** o bot mostra o resumo exato (canal, item, horário, quem) com botões `Confirmar` / `Cancelar`. Comando pendente com **TTL de 30 s** (ao ar) ou 2 min (programação), amarrado ao `from.id`, ao chat e ao `message_id`. Confirmação por outro usuário não vale. Reaproveita `reviewToken` e `Idempotency-Key` onde já existem. |
| Chat | Ações só em **chat privado**. Em grupo, o bot responde só leitura e alertas. |
| Auditoria | Toda tentativa (aceita, negada, expirada, cancelada) grava na auditoria imutável existente (`securityAudit`/`logDecision`), ator `telegram:<conta>`, com `from.id`, tipo de comando e resultado. Não gravar texto livre do usuário sem sanitizar. |
| Taxa | Por usuário: leitura 20/min; escrita 5/min; ao ar 2/min. Global: abaixo de 1 msg/s por chat nas respostas. Excesso: resposta curta e bloqueio temporário; 5 negativas seguidas suspendem o vínculo até revisão. |
| Kill switch | Chave no servidor (UI de ADMIN e arquivo/variável de ambiente que o operador local consegue ligar sem a rede) que desativa **todas** as ações do bot em < 1 s e mantém só o envio de alertas, ou desliga tudo. Estado auditado. Revogar vínculo derruba as confirmações pendentes. |
| Segredos | Token do bot no cofre (`installationVault`, contexto próprio, ex.: `telegram-bot-token:v1`). Nunca em URL de integração, nunca em log, nunca exibido na UI depois de salvo. Rotação documentada. |
| Anti-replay | Cada update processado uma vez (`update_id` guardado); `callback_query` de mensagem antiga expira; botão usado uma vez. |
| Saída | Sem dados sensíveis: nada de chaves de fonte, URLs com credenciais, caminhos de disco. Reusar `sanitizeDiagnostic`. |

**Engenharia social:** o ponto mais fraco é a pessoa vinculada perder o celular ou alguém pedir "dá o ciente aí". Mitigações: confirmação com resumo explícito, TTL curto, ações só em privado, revogação rápida (ADMIN revoga em um clique; também `/sair` pelo próprio usuário), alerta ao grupo de supervisão quando um vínculo novo é criado ou uma ação ao ar é executada pelo bot, e revisão periódica dos vínculos (a UI já tem `GET /api/users/review`, 796).

## 5. Catálogo de comandos

Legenda de viabilidade: **A** = viável já com rotas existentes; **B** = depende de rota/componente novo; **C** = não recomendado por Telegram.

### Nível 0: leitura (modo padrão)

| Comando | Faz | Rota que cobre | Falta | Viab. |
|---|---|---|---|---|
| `/status` | Resumo por canal: no ar, sinal, alertas abertos, HA | `GET /api/state` (1647), `GET /api/health-events` (835), `GET /api/ha/status` (970) | Só o bot e o formatador | A |
| `/agora [canal]` | O que está no ar e o próximo | `GET /api/channels/:id/timeline` (1626), `GET /api/scheduler/status` (1462) | Formatador | A |
| `/playlist [canal]` | Grade do dia, paginada, com botões de página | `GET /api/rundowns/:id` (3235) ou `.../operational-playlist` (2271) | Formatador e paginação; definir o que é "playlist" | A |
| `/proximos [canal] [n]` | Próximos n itens | Mesmas | Formatador | A |
| `/alertas` | Pendências abertas, por canal | `GET /api/notifications` (852) | Formatador | A |
| `/relogio` | Hora do servidor e sincronismo | `GET /api/health` (959) / futuro `clock.*` | `clock.*` ainda não existe | A (hora) / B (sincronismo) |
| `/fontes [canal]` | Entradas live cadastradas e estado | `GET /api/sources/live?channelId=` (4134) | Formatador | A |
| `/exportar [playlist\|log] [canal] [data]` | Envia CSV como arquivo (provável sentido de "vomitar") | `GET /api/rundowns/:id/export.csv` (3246), `GET /api/health-events.csv` (841), `GET /api/audit` (807) | Enviar o arquivo por `sendDocument`; limite de tamanho e conferência de sensibilidade | A (confirmar sentido) |

### Nível 1: ciente

| Comando | Faz | Rota | Falta | Viab. |
|---|---|---|---|---|
| Botão `Ciente` no alerta, ou `/ciente <id>` | Reconhece o incidente e encerra a escalada | `POST /api/health-events/:id/ack` (858): exige **CHANNEL_STOP (SUPERVISOR+)** | Bot receptor; ator `telegram:<conta>`; vínculo com modo "ciente". O `AlertNotifier` já para a escalada quando `acknowledgedAt` é preenchido (`escalate()`). Decidir se OPERATOR pode dar ciente (hoje não pode) | A |
| Alerta com botões `Ciente` / `Detalhes` | O `alertText` ganha teclado inline | `alertText` (alert-notifier.ts, fim do arquivo) hoje devolve só texto | Mudar o envio para aceitar `reply_markup` com `callback_data` curto (id do incidente por referência) | B (pequeno) |

### Nível 2: programação

| Comando | Faz | Rota | Falta | Viab. |
|---|---|---|---|---|
| `/live adicionar` | Fluxo por teclado: canal → data/horário → fonte → resumo → confirmar | Cadastro de fonte: `POST /api/sources/live` (4149, PLAYLIST_EDIT, `If-Match`/revisão). Inserir na grade: `POST /api/rundowns/:id/items` (3355) | Orquestração com estado do fluxo; a grade usa revisão de edição e escopo; escolher horário válido (colisão, zonas protegidas). **Hoje não vi rota que agende "live às HH:MM"** de forma única; precisa definir qual caminho (item de grade do tipo live) e confirmar | B |
| `/live listar`, `/live cancelar <id>` | Lista e remove entrada programada | `GET /api/sources/live`, `DELETE /api/items/:id` (3656) | Orquestração e confirmação | B |
| `/testar <fonte>` | Verifica sinal da fonte sem ir ao ar | **Não existe** rota de sonda de fonte. Parcial: `transport cue` com `sourceRef` no PVW (5539) | Rota nova de sonda (conecta, mede vídeo/áudio, devolve ok/falha, sem tocar PGM/PVW). **Não usar PVW real**: ocupa o preview do operador | B |
| `/publicar [canal]` | Publica a grade | `POST /api/rundowns/:id/operational-publish` (2406, PLAYLIST_PUBLISH) | Resumo do que muda, confirmação, simulação (`operational-simulation`, 2460) | B (e sensível; ver nível 3) |

### Nível 3: ao ar (SUPERVISOR+, confirmação obrigatória)

| Comando | Faz | Rota | Falta | Viab. |
|---|---|---|---|---|
| `/take [canal] [item]` | TAKE do item | `POST /api/channels/:id/transport` `action:'take'` (5539). **Hoje basta PLAYLIST_EDIT** | Regra nova "SUPERVISOR+" na camada do bot; confirmação; trava de posse HA já existe | B |
| `/parar [canal]` | STOP do PGM | Mesma rota `action:'stop'`, CHANNEL_STOP (SUPERVISOR+) | Confirmação com resumo e TTL curto | B |
| `/trocar-live` | Troca a fonte da live no PGM | `POST /api/channels/:id/live-replacement` + `commit` com `confirm:true` (4542/4556), com `Idempotency-Key` | Fluxo em 2 etapas + 2 confirmações | B (desaconselho no MVP) |
| Failover manual | `force-failover` (4173) | existe | n/a | **C** |

**Desaconselhado por Telegram (C):** criar/alterar contas e papéis; mudar saídas e destinos (`/api/outputs`); configurar canal; operações HA (`/api/ha/*`); restaurar backup; mexer em integrações e no cofre; forçar failover; qualquer ação que dependa de olhar vídeo/áudio para decidir (corte, ajuste de áudio). Essas ficam na UI, onde o operador vê o sinal.

**Observação sobre TAKE por celular:** o operador decide olhando o monitor. Pelo Telegram ele decide "às cegas" e com latência de rede. TAKE e parar só fazem sentido como **contingência** (operador longe da cabine, alguém do suporte). Recomendo deixar o nível 3 desligado por padrão e ligar canal a canal.

## 6. Estimativa por fase

Valores em dias de uma pessoa, inclusive testes. São estimativas, não compromisso. Pressupõem desenvolvimento em apps/server (ou pacote irmão) com a base de testes que o projeto já tem.

| Fase | Entrega | Estimativa | Dependências |
|---|---|---|---|
| **0. Decisões e piloto** | Responder as perguntas da seção 8, criar o bot no BotFather, conferir limites na doc | 1-2 d | Dono |
| **1. MVP** | Poller (long polling) isolado, vínculo por código na UI (ADMIN), lista de permissão, nível 0 (`/status`, `/agora`, `/playlist`, `/proximos`, `/alertas`, `/fontes`, `/exportar`), alertas com botão `Ciente`, auditoria `telegram:<conta>`, taxa, kill switch, token no cofre | 8-12 d | Tabela de vínculos; identidade "agir como conta vinculada"; sem rota de operação nova |
| **2. Programação** | `/live adicionar` por teclado inline, `/live listar\|cancelar`, `/testar` (rota de sonda nova), confirmações com TTL | 8-12 d | Rota de sonda de fonte; definir caminho de agendar live; ajuste de revisão/`If-Match` |
| **3. Ao ar** | `/take`, `/parar`, `/publicar`, regra SUPERVISOR+, dois passos, alerta ao grupo a cada ação, testes de falha | 6-10 d | Decisão sobre TAKE para OPERATOR; teste em ambiente de ensaio (`/api/ha/rehearsal`, 1404) antes de produção |
| **Opcional: Mini App** | Tela rica (grade e escolha de horário) | 10-15 d | URL pública HTTPS, validação de `initData`, nova superfície exposta |

Total até a fase 3: cerca de 25-35 dias. A fase 1 sozinha já entrega valor (alerta com ciente + consulta).

## 7. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Telegram indisponível** (queda, bloqueio de rede, 429) | Perde alertas e comandos | Playout **nunca** depende do bot. Poller em processo isolado, com timeouts, backoff e fila limitada. Alertas continuam também por e-mail/webhook/UI (a fila de integrações já é persistida e tenta de novo). Falha do bot não pode lançar exceção para o motor (mesmo padrão do `AlertNotifier`: `catch` e segue) |
| **Latência** (celular, rede, polling) | Comando ao ar chega tarde ou duplicado | Comando carrega horário; TTL curto; idempotência (`Idempotency-Key`); resposta sempre diz o estado real lido do servidor, não o "enviado" |
| **Vazamento do token do bot** | Terceiro lê comandos e responde como o bot | Cofre; nunca em URL/log; rotação; o token sozinho **não** dá poder de operar (a autorização é por `from.id` vinculado), mas permite enganar usuários com mensagens falsas. Instruir a pessoa a só confiar em mensagem com botões de confirmação que repetem o resumo |
| **Conta Telegram da pessoa comprometida** | Ator mal-intencionado opera como ela | Modo somente-leitura por padrão; ações só em privado; confirmação; revogação rápida; notificação de ação ao ar; limite por papel |
| **Engenharia social** ("me passa o código") | Vínculo para o `from.id` errado | Código de uso único, 10 min, ligado à conta e conferido em privado; ADMIN vê o `from.id` e o nome exibido antes de ativar |
| **Comando duplicado ou fora de ordem** | Dois TAKEs | `update_id` único; botão de uso único; trava de posse existente |
| **Divergência de regra** (OPERATOR dá TAKE na UI mas não no bot, ou o contrário) | Confusão e brechas | Regra única em `permissions.ts`; o bot consulta `can()` do servidor, não tabela própria |
| **Exposição de dados no histórico** | Nomes de fonte, horários, estado de canais ficam no Telegram | Sanitizar saída; evitar URLs/chaves; documentar que o histórico não é cifrado de ponta a ponta |
| **Superfície nova** | Mais código dentro do servidor de ar | Processo separado, sem escrita direta no banco, só pela API com autorização; kill switch |
| **Carga em grupo** | 20 msg/min por bot | Alertas agrupados; resumo em vez de mensagem por evento |

## 8. Perguntas em aberto para o dono

1. **"Vomitar":** é despejar/exportar em lote (playlist ou logs)? Ou era outra coisa, como desfazer? Qual formato (texto, CSV, planilha)?
2. **Quem usa:** quais papéis ligam ao Telegram? Só SUPERVISOR+ e ADMIN, ou também PROGRAMMER e OPERATOR? Isso define o nível 1 e 2.
3. **"Playlist":** é a grade (`rundowns`) ou os arquivos de playlist (`/api/playlists`)? O bot lista qual?
4. **TAKE:** hoje o servidor deixa OPERATOR dar TAKE (PLAYLIST_EDIT). Manter assim na UI e restringir só no bot, ou apertar para todos (exigir OUTPUT_CONTROL)?
5. **Ciente:** hoje exige SUPERVISOR+ (CHANNEL_STOP). Quer abrir para OPERATOR no Telegram? Isso muda a escalada (o operador cala o alerta antes do supervisor saber).
6. **GESTOR:** quais ações ele terá? (pode gerar código de vínculo, mas não gerenciar contas?) Preciso saber antes de desenhar a tabela de vínculos.
7. **Ao ar pelo celular:** quer mesmo TAKE/parar por Telegram, ou só como contingência, desligado por padrão?
8. **Programação de live:** a live é item de grade com horário fixo, ou "entrada manual" que o operador dispara? Quais horários o bot pode escolher (hoje só do dia, ou semana)?
9. **`/testar`:** o que deve provar? Só conexão, ou vídeo+áudio por N segundos? Pode ocupar a sonda (CPU/rede) com o canal no ar?
10. **Grupo:** quer um grupo de supervisão só para alertas (leitura)? Quem administra os membros?
11. **Rede:** o servidor de ar pode falar com `api.telegram.org` (porta 443 de saída)? Se não, é preciso um relé, o que muda o desenho.
12. **Bot único ou por ambiente:** um bot para produção e outro para ensaio?
13. **Retenção:** por quanto tempo guardar a auditoria do bot e o histórico de vínculos?
14. **Token atual:** o alvo `api.telegram.org/bot<TOKEN>/sendMessage` das integrações já guarda o token cifrado? Conferir antes de reaproveitar.

## 9. Próximos passos sugeridos

1. Responder as perguntas 1-5 (bloqueiam o desenho).
2. Conferir na doc oficial os valores marcados como "não confirmados" (seção 3).
3. Fase 1 (MVP) como piloto em ensaio, só leitura mais ciente, com um grupo pequeno.
4. Só depois abrir programação (fase 2) e, por último, ao ar (fase 3).
