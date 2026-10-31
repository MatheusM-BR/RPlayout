# 7.3 — Timeout real com transação não confirmada

## Resultado observado

`verify-storage-transaction-timeout.mts` PASS, código0, diretório
`scratch/storage-transaction-timeout-zDOQJl`. O caso exercitou o prazo real de
30.000ms do adapter PROCESS, sem alterar produção nem encurtar timer para teste.
A chamada observada durou30.015,437ms (inclui prepare); o RPC sem resposta
registrou30.010,465ms. São medidas desta execução, não SLA/RTO de canal.

Banco e tabela fixture_pending são novos e sintéticos. Adapter de produção
carregado do fonte, bridge/serviço compilados reais, dependências Node do projeto
e proxyQA declarado. Não é backend/pacote instalado, HTTP, migração do banco
operacional ou efeito de TAKE/as-run. Não abriu engine/PGM, não escreveu emD:,
não repetiu testes de conexão negados e não alterou permissões/políticas.

## Ponto da falha

Uma conexão real abriu BEGIN IMMEDIATE e enviou um UPDATE que incrementava0→1.
O serviçoSQLite REAL confirmou changes=1 e inTransaction=true. Um proxy QA
reteve apenas essa resposta, manteve o serviço vivo e não criou timer próprio.
O COMMIT ainda não havia sido solicitado: não é queda depois de commit nem
teste com alteração já confirmada. Não se inventou sucesso, PID ou recibo.

O adapter ficou sem resposta e atingiu seu Atomics.wait de30s. Retornou erro
de prazo/resultado desconhecido, inutilizou a conexão e terminou o bridge.
COMMIT e UPDATE posteriores na mesma conexão foram recusados antes de enviar
novo SQL; automaticReconnect=false e automaticReplay=false preservados.

Ao observar a desconexão do seu IPC pai, o proxy encerrou SOMENTE o ChildProcess
direto do serviço de teste. Marcador confirmou desconexão do pai, um pedido-alvo,
ACK real retido, zero pedidos COMMIT e saída SIGKILL. O proxy não foi encerrado
por PID histórico nem passou a integrar o produto.

Observador separado viu0 depois do timeout e novamente após a saída do serviço.
O arquivo reaberto também manteve0: o efeito da transação não confirmada não
persistiu. Isso não transforma o erro recebido pelo chamador em rollback
operacional confirmado. O chamador continuou recebendo resultado desconhecido;
a constatação de0 pertence à observação posterior desta fixture controlada.

O caso não determina se páginas sujas chegaram a ser derramadas no WAL antes
da interrupção. Não alega captura de frames WAL, perda física de energia ou
reconciliação do banco operacional por remoção de arquivos.

## Encerramento e prova independente

Observador9088, serviço14512 e proxy6296 ficaram ausentes; cleanupErrors vazio.
O controlador12952 terminou com código0. Nenhum processo de terceiros foi
encerrado. Todos os encerramentos/mutações pertencem às cópias QA desta rodada.

`verify-storage-transaction-timeout-evidence.mts` PASS, código0,0,94s. Conferiu
integridade/FKs, valor final0, consistência do marcador, hashes do adapter,
bridge real/cópia/serviço/proxy e ausência dos três PIDs próprios. Arquivo
principal sem alteração antes/depois da leitura readonly; sem limpeza de
WAL/SHM ou mudança de journal_mode na conferência. Não reconstrói de forma
independente o tempo histórico de cada RPC nem autentica o marcador como
diário de produção. Não repete o timeout, COMMIT, UPDATE ou crash.

Hashes observados:

- Adapter: `7973b886422b7f25cd6356b99dece7eb278c5e096f5d32cfd0ec24ea004afce6`.
- Bridge real/cópia: `a7be733dad1fc601a5b9922fa07d8d19d599e117e2f27c31a6193b732387e299`.
- Serviço real: `9eb4d10d289f440a78abe014108bf401cde7ab282168ab613939949f74d70771`.
- Proxy QA: `a2ceed3348866f3289a65f39e4692ce772e59608cf5f032c0d4c66dbc7cf7da5`.

Tipos dos dois roteiros PASS/zero diagnósticos, proxyCJS sintaxePASS. Produto,
bundles/ZIPs anteriores e os proxies das outras provas não foram modificados.

## Restante do grupo

Agora há evidência específica para três ramos de7.3: resposta excessiva (3I35Cy),
queda pós-commit/ACK não entregue (2mofBu) e timeout com transação pendente
(zDOQJl). São cenários, NÃO três requisitos novos além dos53.

7.3 continua em andamento: timeout/desconexão durante operações reais com PGM,
reservas/as-run, disponibilidade do controle e efeitos inconclusivos ainda não
foram homologados. O contrato atual é síncrono e esta chamada ocupa a thread
chamadora por30s: o caso NÃO prova que HTTP/WebSocket, renovação de concessões,
interface ou PGM permanecem disponíveis nesse intervalo. Esse impacto deve ser
medido/revisado antes de declarar a separação do banco pronta para operação.

7.1 pacote/compatibilidade completos,7.2 mutadores e autorização multiusuário e
7.4 carga/engine/migração ainda abertos. Não exactly-once operacional ou energia.
R88 NOT_BUILT; D:/PS5/HTTP aguardam suas permissões/provas, r87 intacta. Sem
cleanup/movimentação/publicação. DeckLink física adiada e grupo8v3 preservados.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
