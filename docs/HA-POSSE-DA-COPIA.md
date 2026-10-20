# Posse local da cópia HA — NOT_RUN

Integração 8.3 posterior à R55, sem testes/build/homologação física.

Continuação: backend da cópia ligado ao orquestrador antes do adaptador. A mesma
capacidade confere fingerprint completo de schema/linhas, registra a instância
e auditoria HA na transação de abertura e transfere conexão sem liberar storage.
O adaptador recebe executionApp distinto; não abre a preparação original nem
reutiliza o backend do serviço standby. Configuração HA do ambiente não cria
outro espelho/serviço HA nesse backend admitido.

Esse backend continua em quarentena explícita: runtimeFor e syncDistribution
recusam execução; não constrói MediaMTX, não importa a raiz de mídia herdada nem
dispara descoberta inicial. Distribuição exige a etapa nativa ainda não liberada.
Fechar o backend drena seus trabalhos e registra STORAGE_CLOSED, mas não libera
nem fecha o banco reservado ou broker compartilhado: o orquestrador faz essa
liberação após parada confirmada. Stop do backend é deduplicado. Falha sem
handle conserva a reserva, mesmo que seu backend conhecido tenha sido drenado.
Fingerprint não é token de promoção nem prova de hardware.

O orquestrador, antes do adaptador, obtém posse nativa do computador e prova
fresca, autentica/revalida a cópia fechada, confere schema corrente e canal
único arquivado sem saídas. Não migra banco antigo nem remove quarentena.
Abre somente a cópia distinta e reserva storage com StorageMaintenance:
transação imediata, assinatura, identidade do arquivo e recusa de outro usuário
operacional vivo/remoto/incerto. Preparação e banco do serviço standby não são
alterados por essa reserva.

HaExecutionAdmission é capacidade registrada em WeakSet na instância atual.
Não é recibo JSON nem um token que o browser possa reconstruir. A posse do
computador e reserva do banco são rechecadas antes e durante admissão de PGM.
Pode transferir a conexão ao backend/worker admitido sem liberar a reserva e
sem aceitar outro caminho. A factory deve registrar a instância e execução
sob essa mesma reserva antes de abrir recursos.

Antes de chamar o adaptador, marca a preparação nativa. Exceção sem handle
de parada não comprova ausência de processo: reserva fica preservada. Cleanup
libera storage só após confirmação de parada dos recursos próprios; se release
falhar, resultado continua incerto. Crash conserva MAINTENANCE, sem roubo por
prazo. Diretório, banco parcial, cursor e diário nunca são apagados para liberar.

Broker do computador é compartilhado pela vida do orquestrador, não fechado
a cada recusa. Ao encerrar o backend, fecha seu IPC somente após drenagem das
operações; o broker nativo continua aguardando término real do pai/descendentes,
sem kill por PID externo nem liberação antecipada do job. Perda dessa posse
impede novos recursos e revalidação da promoção. Isso não certifica fencing
físico de switcher/SDI/rede fora da família de processos.

Ainda falta factory da execução nativa: registrar execução,
instalar destinos locais revisados e cursor, preparar
mix/grafismos e engine retido. Produto continua com adaptador nulo e recusa
antes de copiar/reservar/transferir. Nenhum botão de promoção habilitado.

Fixtures de objetos/protótipos forjados preparados, NOT_RUN. Fixtures do
orquestrador mockam host/storage/cópia/engine explicitamente; não são prova
nativa. Rodada consolidada deve cobrir broker real, reserva concorrente,
transferência de conexão, crash em cada etapa, parada perdida e release incerto.
