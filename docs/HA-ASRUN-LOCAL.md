# As-run local após promoção HA — NOT_RUN

Continuação: checkpoint aponta para recibo local `ha-graphic:UUID:CONFIRMED`,
avançado somente após persistência do ACK/composição de preparo, expiração ou
evento futuro. Leitura usa codec cifrado, canal/promoção/owner/term, SHA do
display e cronologia rowid; composição confirmada mais recente ou alteração
posterior pendente/incerta recusam ponte antiga. CONFIRMED HA não é recebido
como GRAPHIC_COMMAND normal nem prova presente de publicação.
Snapshot e recuperação de Graphics do runtime normal reconhecem namespace
explicitamente; recuperação gera um comando/recibo próprio novo, sem importar
evento/owner estrangeiro. UUID de execução gráfico alinhado ao checkpoint.
Fixtures de leitura mockada NOT_RUN, não evidência de DB/engine/hardware.

Continuação: Checkpoints com lease local ligados após beginProgramAccounting,
primeiro cursor da prova de release e atualização periódica de 1 s. Novo UUID
de execução, rate/audio/edição/corte locais, sem dono/recibo/contingência estrangeiros.
Position nativo agora leva decoderId; o transporte expõe apenas amostra recente
(até 2 s) da mesma geração/item/decoder. Legacy/decoder anterior não provam
cursor para HA. Ausência de amostra preserva cursor anterior, não escreve zero;
frame terminal além do corte não é clampado nem vira ponto de retomada.
Limpeza nativa grava estado parado; exit/shutdown preservam último cursor
válido para retomada futura, não equivalem a STOP explícito. Timer cancelado
no stop, falha de escrita fecha transporte e conserva posse para reconciliação.
Fixtures de wire/identidade NOT_RUN; novo engine precisa ser incluído na build.

Posterior à R55, implementação em lote, sem testes/build nesta etapa.

A geração cercada mantém AsRun NATIVE com ExecutionLease próprio. LOAD/TAKE
internos retidos são ignorados pelo registro de exibição. Após release nativo,
orquestrador chama beginProgramAccounting com prova da mesma concessão/item/
decoder; valida novamente após escrita. Abre linha local a partir da posição
nativa confirmada e registra proveniência de promoção/preparação/edição/origem
em HA_PROGRAM_ACCOUNTING_STARTED. Não atualiza nem importa as-run do primário.

Callbacks locais de TAKE e programa limpo ficam em fila própria, usam as-run
existente com edição congelada e vínculos de posse. Falha de storage/registro
fecha apenas o transporte próprio; não reenvia TAKE nem inventa fechamento.
Parada aguarda exit nativo, drena a fila e fecha linha própria antes de aposentar
posse. Sem posição final comprovada, o fechamento usa a evidência de duração
de relógio explicitamente prevista por AsRun, não a rotula como posição nativa.

Esta etapa não completa ChannelRuntime HA: checkpoint operacional, fronteiras
de edição, contingência, operação pelo painel, Preview, replicação reversa e
admissão de eventos gráficos para novos itens continuam faltando. Prova nativa
de release não homologa destino físico. Adaptador padrão continua null.
Checkpoint HA tem ponte própria de composição, ainda não homologada. Recibos
HA_GRAPHIC não são GRAPHIC_COMMAND da operação normal; não associar recibo do
primário como atalho. Faltam fronteiras/contingência/painel/Preview, reconciliação
durável dos eventos após novo reinício e adaptador completo.
