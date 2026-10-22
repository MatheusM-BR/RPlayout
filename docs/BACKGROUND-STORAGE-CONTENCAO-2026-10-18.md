# 7.1 /7.3 /9.4 — Contenção das tarefas periódicas

## Problemas encontrados no fonte

O backend já recusava novas requisições quando o adapter marcava o banco como
indisponível. Porém, verificar isso na entrada do timer não tratava uma falha
ocorrida DURANTE o ciclo. O callback async do ciclo live não tinha consumidor
para sua rejeição; retenção e alguns predicados de admissão também podiam lançar
fora dos catches. Refresh de telemetria e algumas partidas de tarefas não tinham
tratamento de rejeição. Isso podia encerrar o processo por falha de background,
em vez de manter diagnóstico/controle bloqueado de forma previsível.

Além disso, quatro assinaturas de saúde eram marcadas como registradas ANTES
do INSERT. Um INSERT recusado com conexão ainda saudável podia fazer os ciclos
seguintes pularem uma transição que nunca foi persistida. O shutdown também
chamava app.close() sem aguardar a possível Promise de drenagem antes de exit0.

## Implementação

BackgroundTaskGuard contém falhas síncronas/assíncronas do corpo e da admissão.
Não reabre banco, não repete trabalho na própria chamada e não emite comando
nativo. Perda da geração de storage suspende novas tarefas dessa instância,
notifica uma única vez e permanece suspensa mesmo que um getter depois diga
conectado. Só uma nova App/guard cria outra geração. Erros do próprio diagnóstico/
notificação são consumidos, sem criar uma rejeição secundária.

Em index.ts, foram protegidos ciclo live, ingest refresh, acervo, mídia/áudio,
continuidade/publicação programada, backup/retenção/expiração, distribuição,
cache, telemetria e chamadas existentes de HA. Não se implementou HA v3 nem
alterou suas decisões/contratos; é contenção dos chamadores atuais.

Ao perder storage, o callback fecha sockets de controle com4503 e não agenda
novas ações. Checagens adicionais interrompem o ciclo antes de passos seguintes
se um domínio absorveu seu erro após inutilizar a conexão. Predicados de papel,
quarentena, admissão nativa e autorização de cada domínio permanecem. A exceção
de broadcast agora também tenta fechar o socket antes de removê-lo do mapa.

Não há cancelamento/reversão fictícios de efeitos já iniciados. Erro SQL conhecido
com conexão saudável pode ser observado de novo num ciclo normal; isso NÃO é
reenvio de uma gravação/TAKE com resultado desconhecido. Callback de mutação
editorial pós-commit (pushViews) não foi globalmente embrulhado: continua podendo
retornar applied+refreshError quando a atualização de tela não foi confirmada.

Assinaturas ENGINE/VIDEO/warning/MediaMTX agora só entram no cache de registrados
depois do INSERT bem-sucedido. Shutdown agora usa await app.close(); não presume
conclusão de uma Promise só porque foi criada. close do guard impede nova admissão,
mas não afirma drenar/cancelar por si só todas as tarefas em andamento.

## Verificações do lote

36 testes/4arquivos PASS: guard8, retenção4, incidentesPGM7 e incidentesruntime17.
Incluem falhas sync/async/admissão, latch de perda de geração, callback de erro
falhando, close sem fingir cancelamento e preservação das filas/incidentes.
Tipos do servidor e dos roteiros PASS. Não somar esses36 a requisitos/rodadas
históricas sobrepostas. Não foram repetidos os66testes de categorias nem as
rodadas de30s/commit/backup cujos componentes não mudaram.

BsZHwl PASS: guard de produção com banco PROCESS real. Resposta18MB inutilizou
a conexão; um erro foi tratado, uma notificação-fixture ocorreu, cinco tarefas
posteriores não executaram seus efeitos, linha permaneceu0 e não houve
unhandledRejection observado. Serviços próprios encerrados. A notificação é
fixture, NÃO WebSocket real nem prova de continuidade de PGM.

Build do servidor PASS em pasta NOVA:
`scratch/host-history-r88-background-20261018/server.cjs`, SHA256
`fadffb1346186bc6103417c87446ca346263f1a31cdf5da1c48156e4e187fe5d`.
É o destino atual para a futura r88, substituindo a seleção do3BBAC965 anterior,
que permanece intacto. HelpersSQLite a7be733d/9eb4d10d e frontendE15DBFFB não
mudaram; dist convencionais/instalações/ZIPs não foram sobrescritos.

## Backend compilado: corpo do caso observado, FAIL de marcador preservado

`compiled-background-recovery-gI0wvy/result.json` permanece **FAIL**. O caso usa
main/timers compilados reais, SQLitePROCESS e um proxy observador IPC declarado
que encaminha respostas reais sem fabricar ACK. Transporte do canal é SIMULATED
ocioso, grade vazia, engine/broker/relays desativados; sem cliente conectado.

Um trigger no banco QA recusou INSERT de saúde ENGINE. Foram observados três
ciclos live com erroSQLITE_CONSTRAINT_TRIGGER contido e processo vivo. Nenhum
eventoENGINE havia sido salvo. Retirado SOMENTE o trigger QA, o ciclo persistiu
uma transiçãoENGINE e umaVIDEO, estáveis por300ms sem duplicação. Isso comprova
que a assinatura não foi consumida antes do INSERT recusado. Não é reenvio de
comando operacional inconclusivo; a recusa SQL foi conhecida e o banco saudável.

Shutdown normal do processo próprio retornou0 e sua instância gravou
STORAGE_CLOSED assinado. Backend e os processosSQLite/proxy conhecidos foram
observados ausentes. Entretanto, o proxy auxiliar não deixou seu último marcador
EXITED; sobrou STARTED, embora os PIDs já estivessem ausentes. O roteiro exigia
esse marcador adicional e declarou FAIL no teardown. A causa exata de a última
gravação não ter persistido NÃO foi comprovada; não inferir sinal/job específico.

Roteiro futuro corrigido para aceitar a prova real de ausência dos seus processos
mais fechamento assinado, sem exigir gravação final de um processo já encerrado.
Não fabrica EXITED, não mata PID histórico e não altera o resultado antigo.
Essa versão do roteiro não foi reexecutada por mudança de status.

## Conferência independente sem replay

`verify-background-recovery-evidence.mts` PASS/sourceRunResult=FAIL,1,45s.
Conferiu logs de três erros live reais, dados/integridade/FKs, uma transição por
componente, checkpoint realEngine=false/playing=false, zero as-run e instância
STORAGE_CLOSED com assinatura válida. Hash do servidor/guard/helpers/proxy e
ausência atual de backend e serviços conhecidos conferidos. Arquivos principais
não mudaram durante leitura; sem limpar WAL/SHM ou repetir timer/trigger/backend.

Conferência diferencia o FAIL do roteiro e a aprovação das asserções existentes;
observerFinalMarkerObserved=false é preservado. Resultado:
`scratch/compiled-background-recovery-gI0wvy/assertions-background-recovery.json`.
Não reconstrói toda ordem histórica do IPC nem comprova inventário de auxiliares
OS. O estágio HTTP listening foi observado, mas nenhum clienteHTTP/WS foi
conectado — conexões locais continuam fora da prova, não contornadas por IPC.

## Restante do grupo e entrega

7.1: fechamento com trabalho pendente/engine e compatibilidade/pacote integrais.
O await está implementado, mas a drenagem ocupada não foi forçada neste caso.
7.3/9.4: backend compilado com perda real de geração, sockets reais, PGM/áudio/
vídeo, reservas/as-run e concessões durante a espera síncrona30s. Guard não
remove esse bloqueio da thread, não prova PGM contínuo e não muda fencing/leases.
Carga/soak/energia, demais mutadores/migrações e hardware continuam separados.

Seleção de origemPS5 segue NOT_VALIDATED; seu caso positivo agora referencia
o hash FADFFB13 atual, mas não foi reexecutado sob recusa de autorização.
R88 NOT_BUILT; engine ainda aguarda a rodada nativa final e permissões paraD:.
R87 permanece intacta. Sem cleanup/movimentação/publicação. DeckLink física
adiada, grupo8v3 e fontes externas/licenças/homologações mantidas.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
