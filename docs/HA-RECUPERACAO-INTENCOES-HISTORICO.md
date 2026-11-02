# Listagem e recuperação das intenções de histórico

11/10 — implementado em fonte, NOT_RUN. Sem testes/build; fora R55.

HISTORY_IMPORT e HISTORY_VARIANT integrados à listagem por canal, seletor
da página e encerramento explícito. A paginação aplica filtro SQL fixo de
tipo na tabela compartilhada. Não expõe registros as-run, variantes, caminhos
ou owner privado; somente IDs/fase/data/flags.

GET history-job consulta a intenção durável e o recibo no banco operacional.
Recibo deve corresponder ao request integral. Adapter ausente/erro ou recibo
divergente não vira ausência. Diário CONFIRMED sem recibo comprovado continua
aparecendo como COMMITTING/incerto. Um recibo operacional correlacionado tira
o pedido da lista de pendentes, sem considerar histórico totalmente resolvido.

Só ACCEPTED/EXTRACTING podem ser encerrados, com fase/data/owner exatos,
processo anterior encerrado comprovadamente, nenhum trabalho corrente e
consulta operacional sem recibo antes/depois. Alvo FAILED e diário de
recuperação compartilham a transação no banco HA. Quota/owner/intenção
preservados; não há nova importação, alteração de as-run ou replay.

COMMITTING não é admitido pelo contrato de encerramento, mesmo se consulta
não achar recibo. UI mostra a incerteza e oferece atualizar a página somente
por leitura. A ausência isolada não prova falha de gravação, especialmente
com bancos/restaurações diferentes. Não há ação de forçar, repetir ou apagar.

O painel faz consulta fresca ao endpoint da intenção antes do POST, valida
IDs/estado/data/sem resultado, guarda recoveryId e usa consulta após erro.
Mantidos os limites/paginação sem snapshot e proteção de processo/quota.

Fixtures NOT_RUN: recusa de COMMITTING/CONFIRMED, recusa de recibo encontrado,
estado preservado quando falha conferência e consultas antes/depois da mudança.
Não comprovam transação distribuída nem homologação operacional.

Restam pedidos não registrados, decisões explícitas sobre commits incertos
com identidade do banco operacional, qualificação/QC/contingência/grafismos,
engine/autoridade/retorno efetivo, homologação física e pacote atualizado.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.
