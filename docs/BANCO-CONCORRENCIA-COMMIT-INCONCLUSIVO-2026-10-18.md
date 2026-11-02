# 7.2 /7.3 — Disputa de revisão e queda depois do commit

## Resultado e escopo

`scripts/verify-storage-race-fault.mts` PASS,2,67s/código0, diretório
`scratch/storage-race-fault-2mofBu`. Dois cenários de banco privado executados
em uma rodada, sem alterar produto, compilar novamente, abrir HTTP/engine/PGM
ou escrever emD:. Não é substituição dos ensaios HTTP bloqueados.

O adapter PROCESS é o código de produção; bridge/serviço reais compilados vêm
de `scratch/host-history-r88-20261018`, com dependências Node do projeto. Os
atores são fixtures Node independentes, não backends instalados nem usuários
autenticados. Tabelas fixture_state/fixture_audit/fixture_effect são explicitamente
sintéticas, sem alterar diários, checkpoints, donos ou as-run operacionais.

## 7.2 — Uma revisão aplicada

Dois atores, PIDs8256 e28476, cada um com serviçoSQLite próprio19452 e28600,
leram revisão0 antes da disputa. O controlador liberou ambas as operações sem
aguardar a primeira resposta. Cada ator abriu BEGIN IMMEDIATE, tentou
UPDATE condicionado à revisão0 e incluiu uma linha de auditoria da FIXTURE
na mesma transação somente se o UPDATE alterasse a linha.

Resultado: left alterou1linha; right alterou0. Banco final: revisão1/valor1,
exatamente uma linha de auditoria da fixture com left/revisão1. Isso prova
CAS e atomicidade deste contrato SQL através dos processos reais, não uma
certificação de todos os mutadores editoriais, uma medida de lock-wait ou
autorização/revogação de sessões multiusuário. Não houve fallback/reenvio.

## 7.3 — Commit persistiu, resposta não chegou

A fase de falha usa cópia byte a byte do bridge compilado e um proxy QA declarado
no lugar do arquivo de serviço daquela conexão. O proxy cria por ChildProcess
o serviçoSQLite REAL e inalterado, que é quem abre o arquivo e executa o SQL.
Não fabrica sucesso, PID do serviço, transação ou recibo operacional.

Ao receber do serviço real o ACK do UPDATE da fixture (`changes=1`,
`inTransaction=false`), o proxy grava sua marca QA, não encaminha essa resposta
e encerra SOMENTE seu ChildProcess direto. Esse ACK mais o valor persistido são
a evidência do ponto pós-commit, não um trigger/commit sintético no banco.

Serviço20948 encerrou com SIGKILL; proxy20860 encerrou. O chamador recebeu
StorageDisconnected/resultado de gravação desconhecido, não rollback/sucesso.
A conexão ficou inabilitada, sem reconexão ou replay automático. Nova tentativa
do mesmo UPDATE foi recusada pelo adapter antes de chegar ao serviço. Observador
independente na execução viu valor1, não0 e não2.

O marcador fault-marker.json tem um único pedido-alvo, ACK real retido e saída
observada do filho; é um TRACE QA, não diário autenticado de produção. O proxy
de falha não é componente do pacote. A propriedade é não repetir automaticamente
essa gravação inconclusiva; NÃO é exactly-once operacional ou garantia de entrega
de TAKE/grafismo/integração sob qualquer falha.

Hashes dos componentes usados:

- Bridge real/cópia: `a7be733dad1fc601a5b9922fa07d8d19d599e117e2f27c31a6193b732387e299`.
- Serviço real: `9eb4d10d289f440a78abe014108bf401cde7ab282168ab613939949f74d70771`.
- Proxy QA: `3e9bcb307118bd0c2106af4264ded1186c26a843b4ea50ee59e14d0c322c921b`.

## Encerramento e conferência independente

Os dois handles de atores encerraram normalmente depois de fechar seus bancos.
Os cinco processos de serviço/proxy conhecidos (incluindo o observador16360)
ficaram ausentes; limpeza sem erros e sem sinais contra PIDs históricos.
O único encerramento forçado da falha foi pelo handle direto do serviço QA.

`verify-storage-race-fault-evidence.mts` PASS,0,89s/código0. Conferiu dados
persistidos/integridade/FKs, revisão1/valor1/auditoria única/efeito1, hashes de
bridge/cópia/serviço/proxy, consistência do marcador e ausência dos próprios
atores/serviços. Arquivo principal do banco sem alteração antes/depois da
leitura. Não se apagou WAL/SHM nem mudou journal_mode nessa conferência.
Não se reconstruiu independentemente a ordem histórica completa do IPC nem se
converteu o marcador de fixture em recibo de produção.

Resultado em `assertions-storage-race-fault.json` no mesmo diretório. Os três
arquivos TypeScript da rodada/conferência passaram com zero diagnósticos; proxy
CJS também passou no check de sintaxe.

## Falha anterior preservada e reparos do roteiro

`scratch/storage-race-fault-ojIOSZ/result.json` FAIL preservado. Atores não
chegaram a carregar: --import com caminho absoluto Windows foi interpretado
como esquema c: pelo Node. Não foi falha de concorrência nem aprovação de
outro teste. Handles próprios encerrados e serviço observador fechado.

O roteiro agora passa URL file: correta para o loader. Também foi corrigida a
mesma construção nos wrappers qa-owned-held-source.ps1 e qa-owned-host-history.ps1,
que ainda não haviam sido executados. A sintaxe local desses wrappers foi
conferida; execução completa PS5/job/HELD/HTTP continua NOT_RUN/bloqueada, não
foi repetida nem contornada a recusa de políticas Windows.

O primeiro check de tipos do controlador também identificou windowsHide fora
do tipo ForkOptions; atores passaram a usar spawn com stdioIPC e janela oculta,
sem cast para esconder erro. Rodada final de tipos PASS. Nenhuma dependência
foi instalada, assinatura/política alterada ou bundle de produção modificado.

## Restante do grupo

7.1: pacote completo/rotas/operações e shutdown com canal ativo.
7.2: revisões e autoridade multiusuário dos mutadores REAIS, concorrência de
operação e conflito com PGM — não só tabelas de fixture.
7.3: timeout e outras janelas de queda, reservas/as-run/PGM e recuperação de
efeitos operacionais desconhecidos. Não equivale à perda física de energia.
7.4: carga, latência com engine, migração/restauração e operação prolongada.

Quatro checks7 permanecem em andamento. HTTP/browser/seleçãoPS5/engine atualizado
e instalador r88 aguardam suas provas e permissões; r88 NOT_BUILT. R87 intacta,
sem cleanup/movimentação/publicação. DeckLink física adiada, grupo8v3 e demais
homologações/fontes externas/licenças mantidas.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
