# 7 — Banco separado: contrato privado executado

## Evidência nova, sem replay de HTTP ou build

`scripts/verify-storage-process.mts` executou o adapter real de banco PROCESS,
bridge e serviço compilados em `scratch/host-history-r88-20261018`, com Node da
QA local e dependências Node explícitas do projeto. Transporte é o IPC privado
próprio da arquitetura, sem listener de rede; não substitui nem reclassifica
os testes HTTP bloqueados. Banco, cofre, backup e dados são novos e isolados em
`scratch/RPlayout-storage-process-3I35Cy`.

Resultado PASS, código0,4,38s de execução observados. Roteiro de evidência foi
ampliado para conferir backup e saída dos próprios processos, sem mudar produto,
compilar novamente ou alterar instalações. Nenhum PGM/engine/dispositivo foi
aberto, nenhuma política/permissão foi alterada e nada foi escrito emD:.

Hashes dos auxiliares realmente usados:

- storage-bridge.cjs:
  `a7be733dad1fc601a5b9922fa07d8d19d599e117e2f27c31a6193b732387e299`.
- storage-service.cjs:
  `9eb4d10d289f440a78abe014108bf401cde7ab282168ab613939949f74d70771`.

## 7.1 — execução e encerramento: parcial qualificada

Backend próprio24244 criou serviçosSQLite distintos15708 e27056. O PID informado
pelo contrato não foi confundido com o backend. Nome de arquivo e dado
`EXIBIÇÃO-ÇÃO` atravessaram o contrato real sem perda de caracteres.
Preparação, run/get/all/raw/iterate e migrations atuais executaram via adapter.
Os dois serviços encerraram após fechar as conexões. O roteiro observou ausência
somente dos seus PIDs conhecidos, sem matar terceiros/PIDs históricos.
O Node do roteiro também terminou com código0.

Isso prova o contrato básico desses bundles, não o pacote instalado completo,
compatibilidade de todas as rotas/operações ou encerramento com PGM em execução.

## 7.2 — transações e visibilidade: parcial qualificada

Transação externa commitou uma linha e savepoint interno revertido não persistiu
a segunda. Outra conexão, com seu próprio processoSQLite, viu o valor commitado
e a atualização posterior3. Não foram executadas escritas simultâneas ou
autorizações multiusuário: são duas conexões e visibilidade sequencial real,
não um teste completo de concorrência, revisão/CAS ou sessões de operação.

## 7.3 — resposta excessiva: ramo de bloqueio qualificado

Uma resposta zeroblob18MB excedeu o limite privado16MB e inutilizou a primeira
conexão. O adapter recusou UPDATE posterior sem reabrir/repetir automaticamente.
A segunda conexão continuou vendo3, não4. Status preservou automaticReplay=false
e automaticReconnect=false. Não foram simulados timeout, crash com commit
inconclusivo, queda de PGM, reserva operacional ou duplicação de as-run.

## 7.4 — backup e latência observada: parcial qualificada

Backup pela API assíncrona real do adapter: integrity_check=ok, FKs sem erros,
linha commitada3, linha revertida ausente e dado Unicode preservado. Não se
alterou journal_mode, não se apagou WAL/SHM, não é restauração/ativação operacional
ou certificado de backup portátil autocontido.

Na SEGUNDA conexão houve1.019RPCs incluindo abertura/migrations e consultas:
média0,433ms, máximo230,951ms, último0,232ms. São medidas desse ensaio curto;
não P95/P99, carga representativa, SLA, desempenho com mídia/PGM ou soak.
O próprio status do adapter continua validation=PENDING; não foi forçado para
uma aprovação geral.

## Conferência independente dos dados persistidos

`verify-storage-process-evidence.mts` executado PASS, código0,0,90s. Reabriu
origem e backup somente-leitura, verificou integridade/FKs e igualdade do schema
e de todas as68tabelas lógicas (inclui a tabela de fixture). Confirmou Unicode,
ausência da linha revertida, valor3 preservado e hashes dos auxiliares compilados.
Hashes dos dois arquivos principais antes/depois idênticos. Não se alega
imutabilidade dos auxiliaresSQLite que uma abertura readonly possa criar.

Os dois PIDs próprios continuavam ausentes; nenhuma repetição de RPC, restart,
reparo de diário ou execução nativa foi disparada. Resultado em
`scratch/RPlayout-storage-process-3I35Cy/assertions-storage-process.json`.
A conferência independente prova dados/hashes/saída, não reconstrói a ordem
histórica de cada RPC a partir do banco final.

Tipos do roteiro principal PASS, sessão8201/código0/zero diagnósticos. Após o
ensaio, aliases const foram explicitados só para estreitamento de tipos nas
callbacks; não é mudança de comportamento nem outra rodada funcional.
Tipos do conferidor independente também PASS, com os tipos Node já existentes
em apps/server/node_modules/@types. A primeira configuração isolada não os
encontrou (17 diagnósticos de resolução/ambiente); o comando foi corrigido sem
instalar dependências ou alterar código para esconder erro. Zero diagnósticos
na configuração corrigida; não houve replay dos workers por essa mudança.

## Restante do grupo

7.1: arquitetura e shutdown do pacote inteiro, rotas e operações restantes.
7.2: competição simultânea, revisões/CAS e autorização/revogação multiusuário real.
7.3: timeout/desconexão/crash, reservas e efeitos inconclusivos com PGM/as-run.
7.4: carga e latência com engine, restauração/migração histórica e desempenho
operacional. Nenhuma dessas quatro verificações foi encerrada por este caso.

9.1 HTTP/browser,9.3 recuperação HELD e10.4 pacote r88 continuam aguardando suas
provas e permissões. Seleção isolada PS5 ainda não validada; r88 NOT_BUILT.
R87/instalações/ZIPs antigos preservados. Sem cleanup, movimentação ou publicação.
DeckLink física adiada, grupo8v3 e homologações externas/licenças mantidas.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
