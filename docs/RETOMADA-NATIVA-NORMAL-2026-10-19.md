# 7.3 / 9.4 / 10.4 — retomada automática normal após perda de SQL

## Resultado

PASS no ensaio novo `scratch/native-checkpoint-restart-3IfSOg/result.json`:
PGM nativo em arquivo, timeout PROCESS real de30.014,8617ms, encerramento da
primeira instância e partida do **main compilado no mesmo banco QA**, sem
confirmação do operador. Checkpoint51; cursor observado antes de parar852;
retomada registrada51 e cursor posterior155. Não foi inventado avanço durante
a perda de comunicação. A repetição possível de801quadros/32,04s corresponde
à política LAST_SAVED_CHECKPOINT escolhida, não a reaplicação de SQL incerto.

A primeira fase usa o fonte atual via createApp/runtimeFor; a segunda executa
server.cjs/index normal, com escuta HTTP mas sem cliente HTTP. São processos
reais distintos, na mesma máquina, com host/posse/admissão de produção. Nenhuma
concessão foi falsificada e nenhum PID reconstruído foi encerrado. Não é
restauração de uma cópia: a cópia SQLite feita antes da segunda partida é
apenas evidência congelada; o servidor reabre o banco original deste ensaio.
Os casos antigos vHiSFE/pQ9ViJ e seus bancos não foram reutilizados/modificados.

## Falha encontrada e corrigida

`native-checkpoint-restart-MukdND` permanece FAIL: naquele ensaio a retomada
foi solicitada no cursor52 e a nova linha iniciou em52. O backend encerrou
com código1, pois closeGracefully liberava a posse
antes de app.flush finalizar o as-run. Não há captura decodificada homologada
nem resultado de fechamento completo naquele relatório.

Correção: closeGracefully cancela persistência operacional e pede parada do
engine, mas mantém a posse ativa para a gravação final autorizada do as-run.
O encerramento da aplicação libera a reserva somente depois da prova de saída
nativa. O contrato rápido de close(), reconfiguração e contextos cercados não
foi alterado. Regressão com posse/as-run reais em SQLite comprova que a linha
pode ser encerrada SHUTDOWN antes da liberação final.

`native-checkpoint-restart-HoaSPy` permanece FAIL do carregador Windows antes
da primeira fase. Corrigido somente o argumento ESM --import para URL de
arquivo; não houve alteração de política/ACL ou bypass de admissão.

## Evidência do ensaio aprovado

- Primeira instância: PROCESS perdeu conexão, resultado da transação permaneceu
  desconhecido ao chamador; backend e engine realmente encerrados antes da
  nova partida. No banco congelado: dono ACTIVE, instância OPEN, as-run aberto.
- Partida normal compilada: uma intenção CHECKPOINT_AUTO_RECOVERY_REQUESTED,
  posição51, sem confirmação manual e sem alegar confirmação nativa nessa
  intenção. Callback nativo abriu exatamente uma linha nova no quadro51;
  linha anterior encerrada RESTART, sem fabricar sua duração não persistida.
- Encerramento posterior: backend22584 exit0/sem sinal; engine25768 ausente;
  dono RELEASED/finalRelease/observationClosed, sem PIDs. Primeira instância
  continua OPEN historicamente; apenas a segunda foi assinada STORAGE_CLOSED.
- Leitura posterior confirmou a transação incerta ainda com valor0 e exatamente
  dois registros de execução. Não houve reenvio do UPDATE retido.
- Arquivo publicado após retomada:115quadros/4,6s e220160amostras estéreo/
  4,5867s. Três janelas contêm imagem em movimento e tom próximo de997Hz.
  SHA256 MKV08ebd312b57870282f6104fb785163280f0b1d3cc124dbb9e91ef975184565bb.

Conferência independente somente leitura:
`scratch/native-checkpoint-restart-evidence-uAdExk/result.json` PASS. Autenticou
posse, instâncias e intenção; leu snapshot, banco atual e derivados existentes;
validou hashes, ausência dos processos, movimento e áudio. Banco/WAL/snapshot
não mudaram. A duração anterior permanece UNKNOWN; o fechamento da nova linha
é CLOCK_ESTIMATE, não posição final exata do engine.

## Limites importantes

O pedido e o as-run usam o cursor51; a imagem publicada mostrou movimento.
Isso **não prova seek visual frame-exato** até51. Não há prova de PTS/continuidade
sem repetição/perda de quadros, alinhamento A/V ou SLA: cada janela de vídeo
teve19transições móveis em24; a janela central de áudio passou4/5subjanelas
e apresentou energia de tom menor. Não anunciar mídia broadcast perfeita.

Não homologa sinal físico NDI/OMT/DeckLink, saída de rede, reinstalação Windows,
cliente HTTP, QC visual, restauração/HA ou crash elétrico. App.flush precisa
ser aguardado no ciclo normal antes do fechamento final; o ensaio cobre o main
oficial. A assinatura STORAGE_CLOSED não é recibo EOS por publisher/índiceMKV.

## Validação e artefatos atuais

44/44testes do lote afetado PASS: recuperação22, App shutdown5, incidentes17.
Tipos do servidor e dos dois novos roteiros PASS. Compilação14entradas PASS.
Não repetir nem somar com os72testes da rodada anterior para inflar totais.

Servidor da rodada de retomada:
`scratch/host-history-r88-recovery-flush-20261019/server.cjs`
SHA256df63b20a7d0d91993b04bb542a91205ac757b827fc0d23d41e25c8b4a20364dc.
BridgeC60C2EFD/serviço9EB4D10D inalterados. Build1700DA6A anterior preservada.
Engine usado do cacheD:0250CF31; hostguardC:5B26 permanece anterior às mudanças
de diagnóstico nativo ainda não compiladas. Interface nova e r88 instalável
continuam sem qualificação; última instalação conferida permanece r87.

## Pendências mantidas

7.3: ampliar recuperação/contensão para outros momentos de falha e contextos
de admissão, sem reaplicar efeitos incertos; rodada não encerra o requisito.
9.4: integrar no instalado e validar observabilidade/recuperação nos demais
fluxos. 10.4: nativos finais, seleção/empacotamento, interface e instaladorD:.

10grupos/53verificações:8concluídas,34em andamento,4pendentes,7v3.
