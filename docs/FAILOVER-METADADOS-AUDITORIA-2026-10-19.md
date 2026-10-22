# 6.2 — failover manual: decisão durável não é confirmação do PGM

## Defeito confirmado e correção

Reprodutor `scratch/failover-audit-order-EtuImI/result.json`: FAIL preservado.
Nas4rotas, rejeitar INSERT do histórico retornava500, mas já mudava a seleção
PRIMARY→BACKUP. Repetir o MESMO pedido/chave alternava BACKUP→PRIMARY→BACKUP
e gerava2eventos de auditoria. Não havia deduplicação do Idempotency-Key.

Agora decisão e histórico são gravados na mesma transação imediata antes de
qualquer alteração/notificação do cache local. Falha de SQL preserva a seleção;
resultado desconhecido não provoca reenvio. Pedido repetido retorna o recibo,
inclusive entre aliases, sem alternar novamente ou publicar outro evento.

A identidade está vinculada ao ator e ao conteúdo do pedido. Outra fonte,
motivo, destino ou ator com a mesma chave é recusado. Autorização/canal são
reconferidos dentro da transação, também no replay. Motivo é redigido para
não devolver credenciais de URL. Após restart, o recibo é histórico; uma nova
decisão explícita deriva o papel anterior da decisão durável, não do cache vazio.

Falha de atualização/notificação após commit retorna decisão gravada com aviso,
não rollback fictício. Cache local não aplicado não é apresentado como seleção
observada. Não se repete esse efeito automaticamente na consulta/repetição.

## Contrato API

As4rotas POST exigem Idempotency-Key estável (ASCII limitado a128caracteres).
Sem chave:428; chave inválida:400; chave reusada com outro conteúdo/ator:409.
Engineering aceita sourceId, targetRole opcional e reason opcional. Os aliases
por fonte aceitam targetRole/reason, com body estrito. A chave deve ser mantida
se a resposta não chegar; não gerar outra chave para tentar o mesmo pedido.

Mantidos os campos operation=METADATA_DECISION_ONLY, nativeProgramConfirmed=false
e physicalOutputValidated=false. metadataDecision é recibo de decisão gravada,
com replayed e currentExecutionObserved=false. Evento de saúde agora é
METADATA_RECORDED, não uma afirmação de comutação executada no PGM.

Não existe nesta alteração comando de troca de decoder/PGM. O controlador
anterior só selecionava papel em memória/notificava listeners; não foi encontrado
consumidor de produção ligando esse caminho ao engine. A lacuna NATIVA continua
explícita, assim como falta de validação do par/primeiro quadro/retorno no fluxo
real. Não confundir isso com redundância de máquinas do grupo8, adiada para v3.

## Validação

32/32testes finais PASS em4arquivos: ledger manual13, SRT9, rotas8 e timing2.
Incluem rollback de cada INSERT, chave/ator/canal, recriação do controlador
(não restart completo do backend), falha pós-commit,
perda de ACK de COMMIT sintética, redaction, aliases e notificações. Tipos do
servidor/roteiro PASS; build14entradas PASS. A fixture inicial sem canal falhou
FK; foi corrigida sem desligar FK. Uma expectativa textual outro/outra foi
corrigida; resultados sobrepostos não foram somados.

INLINE `failover-audit-order-gik2es` PASS:4aliases, rejeição preserva PRIMARY,
retry aplica BACKUP e replay mantém BACKUP,1evento por pedido.
PROCESS `failover-audit-order-nwp9Kh` PASS: mesmo contrato com SQLite real em
outro processo e arquivo próprio; serviço24588 observado ausente no fechamento.
Usa dependências de desenvolvimento explícitas, NÃO valida pacote portátil.

Conferência posterior somente leitura PASS:4decisões protegidas/4eventos,
as-run0, instância assinada STORAGE_CLOSED, integrity/FK, serviço ausente e
arquivo principal do banco inalterado. Nenhum replay do cenário.

FAIL intermediárioTJb6v8 preservado: acesso incorreto a tx.$client foi corrigido
para o cliente da mesma conexão/transação; não é qualificação de falhaSQL.
Primeira tentativa PROCESS morreu antes dos casos por ausência de NODE_PATH
para módulos externos ao build isolado; não gerou result.json. A resolução
de módulo foi conferida somente leitura e o fixture passou a declarar as
dependências de desenvolvimento, sem mudança de ACL/política ou admissão.

Limites: injeção interna, sem cliente HTTP, fonte/gateway real, engine, sinal
físico, crash de COMMIT real, backend compilado instalado ou soak. Não é
exactly-once em equipamento. 6.2 permanece em andamento: falta implementar e
validar a passagem desta decisão ao PGM com autoridade, par e primeiro quadro,
além de estados incertos/crash e fluxo remoto/visual completo.

Servidor selecionado:
scratch/host-history-r88-manual-failover-20261019/server.cjs
SHA2564e3ff51c73b0647d7ac4418b453873b5bb9543e417aa79ce5a3707297e12d85d.
BridgeC60C2EFD/serviço9EB4D10D inalterados. Não houve compilação nativa,
buildweb, instalação, escritaD: ou publicação. r88 NOT_BUILT; r87 preservada.

10grupos/53verificações:8concluídas,34em andamento,4pendentes,7v3.
