# Histórico e variantes: intenções duráveis

11/10 — implementado em fonte, NOT_RUN. Sem testes/build; fora R55.

Importação de as-run e preservação de variantes antes mantinham pedidos em
andamento apenas em mapas de memória. Após queda, ausência do mapa podia
aparecer como NOT_REGISTERED embora uma extração tivesse começado.

Novo diário ha_return_history_jobs guarda intenção criptografada, tipo,
owner, ator, fase/data antes de enfileirar extração. Namespace e quota do
Store integrados. Reserva 256 KiB por intenção, limite 1024; quota permanece
após falha. Somente IDs/hashes/decisões escolhidos, sem paths ou linhas de
as-run neste diário. Pedido excessivo é recusado sem truncar.

Transições: ACCEPTED → EXTRACTING → COMMITTING → CONFIRMED. Falha antes de
COMMITTING permite FAILED; falha depois não presume ausência de gravação.
COMMITTING fica incerto até consulta do recibo operacional. Nenhuma tentativa
durável existente é reenfileirada, mesmo após queda/troca de owner ou falha.
Reutilização do UUID com outra intenção é recusada.

As duas operações continuam usando commit transacional e recibo no banco
operacional. O Store só registra CONFIRMED após consultar esse recibo e
correlacionar request integral. O recibo continua fonte de verdade: diário
CONFIRMED sem recibo disponível gera COMMIT_UNCERTAIN, nunca sucesso presumido.
Não existe transação distribuída entre os dois bancos; a incerteza nesse
intervalo é explícita e não provoca replay automático.

Consultas/páginas reconhecem PROCESSING, CONFIRMED, NOT_REGISTERED,
INTERRUPTED, COMMIT_UNCERTAIN e FAILED. Sem processo rastreado, intenção
ACCEPTED/EXTRACTING vira indicação de tentativa durável a recuperar, não prova
de processo morto. UI mantém o mesmo pedido para consulta e não libera PGM.
Só fase CONFIRMED pode conter recibo validado; não libera autoridade nem
declara histórico totalmente reconciliado.

Fixtures NOT_RUN: persistência entre owners, UUID exato/alterado, isolamento,
criptografia/quota, transições ordenadas, falha pré-commit e incerteza após
COMMITTING. Não provam integração física nem transação entre bancos.

Restam listagem/encerramento explícito dessas intenções com conferência do
recibo operacional e ausência comprovada do processo, pedidos não registrados,
qualificação/QC/contingência/grafismos e retomada real com engine/autoridade.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.
