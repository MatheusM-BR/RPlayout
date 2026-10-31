# Seleção explícita de edição/cursor no retorno — NOT_RUN

Lote sem testes/typecheck/build/browser/hardware, fora R55. É registro de escolha
histórica, NÃO execução/preparação nativa ou aprovação do retorno.

Revisão reprotegida agora lista candidatos (ID/grade/ativo), até 1.000, e referências
do checkpoint/contingência sem conteúdo privado. Inventário truncado bloqueia
seleção, não é interpretado como lista completa. Operador escolhe conjunto de até
128 edições e uma edição de execução; futuras ativas são preservadas obrigatoriamente.
Cursor é explicitamente STOPPED ou RECEIVED_LAST_CONFIRMED, com justificativa.

POST /api/ha/returns/selection recebe somente IDs, resumos autenticados da edição/
checkpoint e decisão; nunca chaves ou caminhos. Exige revisão REKEYED completa
sem mudança durante análise, derivada/recebimento próprios do backend atual,
mesmo canal/transfer/rekey e SHA do recibo. Cursor recebido deve corresponder à
edição selecionada, referências válidas e contingências incluídas.

HaReturnSelections registra em tabela HA separada, transação e cofre local, ator/
instante, revisão e SHA de origem. Triggers recusam update/delete/replace.
Autorização e base reconferidas antes/depois do commit. UUID existente consulta
mesma intenção; trocar decisão sob mesmo UUID recusa. GET é histórico sem efeito.
Namespace de restart HA reconhece tabela/triggers. Limite 1.024 escolhas conserva
históricos anteriores; não descarta evidências para liberar espaço.

Página mostra candidatos, seleção de edição/cursor e justificativa. Salva intenção
em sessionStorage antes do POST, sem retry automático; perda de resposta exige
consulta do mesmo ID. Históricos de outro backend não confirmam posse atual.

Fase SELECTION_RECORDED: historyReconciled/mediaValidated/nativePrepared/
authorityTransferred/publicationAuthorized/operationalReady=false. Não abre engine,
não copia/escolhe caminho, não muda banco ativo, não faz TAKE nem repete evento.
Consulta confirma apenas a decisão registrada, não arquivo atual ou prontidão.

Ainda falta materializar seleção em NOVA derivada/candidato e revisar mídia local,
QC/decodificação/mixes/trims/grafismos/eventos/comandos/abertos, configuração/vínculos
locais e revisão atualizada do principal. Escolha KEEP_PRIMARY ou composição
editorial híbrida não estão neste contrato (source=RETURNED_REKEYED_COPY); precisam
fluxo explícito próprio sem importar caminhos ou autoridade estrangeira. Faltam
retenção/geração perdida, seleção revisada de saídas, concessão nativa e operação
completa de retorno/rejoin. Fixtures novas NOT_RUN; sem homologação.

10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em andamento/
12 pendentes). Nenhuma conclusão nova por registrar escolha.
