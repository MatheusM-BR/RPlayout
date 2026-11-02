# 7.3 /9.4 /10.4 — encerramento normal separado da parada de segurança

## Correções integradas em lote

O ensaio pQ9ViJ revelou encerramento por força. A investigação posterior encontrou
DUAS causas no backend: fallback de1s e shutdown enviado pelo caminho geral que
consultava a posse no banco. Com storage perdido, a consulta recusava até a ordem
de parar o próprio processo. Apenas aumentar o tempo não resolveria essa causa.

Implementado:

1. `EngineTransport.closeGracefully`:12s de espera normal e5s adicionais para
   observar saída após eventual força. Somente evento `exit` qualifica término;
   sucesso de kill, cano fechado ou prazo vencido não comprovam saída.
2. Cleanup `shutdown` é escrito SOMENTE no pipe do ChildProcess que o transporte
   abriu e ainda rastreia. Não depende de banco/posse para parar o próprio filho;
   não recebe PID do chamador nem permite load/TAKE/grant por esse caminho.
3. `closeConfirmed` continua parada imediata por handles próprios. Gerações
   cercadas/retidas/sobrepostas não recebem grace; pedido rápido/forçado anterior
   não ganha prazo novo. Falha de pipe força e espera prova, não presume parada.
4. Runtime cancela persistência/novos comandos antes do fechamento. Aplicação
   normal espera a prova; contextos HA/restaurados conservam o caminho de força.
   Nenhum prazo de CUE/TAKE, SQL, nonce ou perda de concessão foi aumentado.
5. Fechamento da aplicação observa rejeições antes de outros controladores poderem
   lançar erro, tenta todos os cleanups próprios e propaga as falhas. Não escreve
   STORAGE_CLOSED nem libera posse como sucesso se a prova/fechamento falhou.
6. Índice principal deixou de chamar close rápido antes de app.close no caso
   local normal; falha de flush/HTTP/storage não pula as tentativas de cleanup.
   Saída normal do backend só usa código0 quando as etapas não falharam.
7. Marca de encerramento bloqueia runtimeFor e criação pendente antes do construtor,
   impedindo reabrir/criar runtime durante a espera. Fechamento legado ocioso/
   simulado mantém fechamento imediato do SQLite; promessa conserva falhas.

## Evidência de software

Rodada inicial:177/178 PASS; um teste de contexto cercado montou a opção no
argumento errado da fixture. Tipos detectaram a mesma montagem. Corrigido o
argumento, caso dirigido PASS sem afrouxar a exigência de força imediata.

Após as correções adicionais do lote, rodada FINAL:198/198 PASS em3 arquivos
(EngineTransport176, fechamentoApp5, incidentes17). Não somar rodadas sobrepostas.
Tipos completos do servidor/roteiros e build14 entrypoints PASS. Interface não
mudou e não foi recompilada só para status. Casos simulados não homologam hardware.

## Falha intermediária preservada

FJZAML: primeira tentativa de grace ainda usava a checagem de banco no comando
shutdown. Processo de QA terminou código1 por rejeição não tratada de fechamento
normal; `result.json` não chegou a ser gravado. Pasta, snapshots e MKV preservados.
Não inventar valores de prova ausentes nem aprovar esse arquivo por inferência.
A sequência motivou a separação do comando de cleanup e a coleta de rejeições.

## PGM normal + prazo real de banco — PASS limitado

`scratch/normal-pgm-storage-timeout-vHiSFE/result.json`:

- `createApp/runtimeFor` NORMAL do workspace, PROCESS real e engine0250 existente
  no D:, SDK de desenvolvimento C:. Não é backend/instalação portátil homologado.
- ACK real retido em transação, prazo original30.011,1376ms; resultado desconhecido,
  conexão inabilitada e COMMIT posterior recusado. Nada foi repetido para passar.
- Mesmo item/decoder/engine, cursor52→851. Captura real:860quadros/34,4s e
  áudio34,3893s; três janelas com22/22/24transições e997Hz nos dois canais.
- Novo fechamento: `ownedNativeProcessesStopped:true`, `graceful:true`,
  `forceRequested:false`; processo saiu código0/sem sinal, não pelo fallback.
- Banco perdido continua SEM STORAGE_CLOSED: app.close recusado, as-run aberto,
  checkpoint52. O leitor autenticou a instância em fase **OPEN**. Isso preserva
  incerteza; não é recuperação completa ou promessa de exactly-once após falha.
- Cleanup adicional apenas da fixture fechou adapter já poisoned e pipe próprio
  do broker após saída nativa observada; nenhum reparo SQL/liberação assinada.

Leitor posterior PASS: usou capturas já produzidas, sem nova decodificação ou
repetir30s; hashes/snapshots/marker/provas, banco/FK, efeito0 e processos próprios
ausentes. A expectativa inicial STARTED do leitor foi corrigida para OPEN,
conforme schemaServerInstance/registro real, sem alterar o banco ou o cenário.

## Main compilado + banco saudável — PASS limitado

`scratch/compiled-native-shutdown-c5pwoh/result.json` e leitura independente PASS:

- Binário JS compilado real, PROCESS, engine nativo e fluxo principal de SIGTERM
  acionado por IPC QA próprio. Sem cliente HTTP nem teste de sinal físico do SO.
- Saída ociosa preta/silenciosa, não conteúdo ao vivo:53quadros e101.376amostras
  decodificados. Encerramento em5.188,9321ms, backend código0/sem sinal.
- Instância STORAGE_CLOSED autenticada; dono RELEASED/finalRelease=true, sem
  enginePids/tokens; integridade/FK corretas, zeroasrun. Bytes principais iguais
  na leitura. Nenhum PID reconstruído foi encerrado.

Os dois casos são complementares, NÃO um único ensaio on-air instalado/compilado
com falha SQL. Saída sem força+código0 e leitura linear não são recibo EOS por
publisher nem prova de índice/seekability do MKV: o Rust ainda ignora o resultado
de sua espera EOS. Essa confirmação específica e os demais gates não foram
substituídos por contagem de quadros ou sucesso de processo.

## Builds atuais / restante

Servidor `scratch/host-history-r88-owned-shutdown-20261019/server.cjs` SHA256
`8be914c660334a8b4178eee82a43792211ca15b83662fe662a3068cb7bbccf16`.
BridgeC60C2EFD/serviço9EB4D10D mantidos; interfaceEFDC03FF mantida. Builds
993530A2/99748AED/FADFFB13 anteriores preservados. C: release engine610E e host
guard5B26 não substituídos; engine usado no ensaio0250 foi somente lido/executado.

R88 ainda NOT_BUILT/NOT_INSTALLED. Faltam seleção/ZIP funcionais, compilação
nativa final/helper de diagnóstico, consulta de portas/retomada protegida,
integração instalada e recuperação/persistência com banco perdido, entre os
demais requisitos. Sem escrita D:, mudança de política, limpeza ou publicação.
DeckLink adiada/grupo8v3 mantidos. Não repetir casos aprovados por status.

Total:10grupos/53verificações —8concluídas,34em andamento,4pendentes,7v3.
