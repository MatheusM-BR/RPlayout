# Revisão técnica do banco retornado — NOT_RUN

Fonte, diário cifrado, API e painel integrados em lote. Nenhum teste/build
executado; pacote R55 não contém esta implementação. Novo auxiliar necessário:
ha-return-review-worker.cjs, adicionado ao build e exigido no pacote parcial.

Revisão exige recebimento completo da mesma instância, administrador autorizado
no canal, sessão estável e posse local. Pedido com UUID persistido antes do trabalho;
UUID repetido somente consulta. Intenções locais inválidas não são sobrescritas.

Verifica SHA atual/identidade do recebimento antes e depois do diagnóstico.
SQLite readonly pode criar WAL/SHM: por isso a conexão NÃO abre o arquivo recebido.
Uma NOVA derivada privada de revisão é copiada, conferida por SHA e inspecionada
em worker separado, readonly/query_only/trusted_schema OFF; não migra/instala.
Derivada e parciais são retidos, sem limpeza/truncamento automático. Quota reserva
recebimentos mais todas as revisões, inclusive falhas; limite de 128 revisões e
espaço livre conferidos. Sem auxiliar/espaço/quota, falha sem alterar o principal.

Worker limitado em memória/tempo; crash/cancelamento/mensagem sem exit confirmado
não geram revisão concluída. Encerramento cancela e drena antes de fechar diário.
Checa integridade/referências SQLite, contrato nominal de migrations e canal.
Compara histórico por ID e todos os campos com snapshot transacional do principal:
novos no recebido, alterados, somente no principal, iguais e ainda abertos.
Inventory SHA cobre todas as diferenças; detalhes limitados e truncamento explícito.
Comparação de edição mostra IDs, NÃO aprova payload protegido. Checkpoint hashes
são evidência distinta, NÃO comparação semântica/cursor escolhido.

Relatório histórico registra SHA de origem e baseline; mudança do principal durante
o trabalho é um bloqueio adicional. Não devolve conteúdos protegidos, caminhos
privados ou credenciais ao navegador. Diário de revisão é cifrado.

Integridade ok NÃO implica restauração operacional. Permanecem bloqueios de
chaves/campos protegidos, mídia/local bindings, cursor, comandos incertos e
autoridade; divergências de schema/as-run/edição têm bloqueios próprios.
primaryApproved/publicationAuthorized/historyMerged/authorityTransferred=false.

Faltam reconciliação durável efetiva (campos protegidos/chaves, edição/mídia,
cursor, as-run e comandos), retenção/arquivamento explícito das cópias, recuperação
de geração perdida, retorno admitido/rejoin, fixtures de concorrência/bytes/schema/
histórico/cancelamento/crash/limites/TOCTOU, homologação, nova build e publicação.
