# Retorno HA — revisão durável de mídia conectada

11/10/2026 — implementação em lote, NOT_RUN; fora R55.

Store/Replication/App/API/UI agora ligam a revisão à aplicação própria STAGED.
O adapter do App consulta o acervo primário inteiro por SHA/QC; runtime da sonda
é o configurado no servidor. Não executar testes/build nesta fase.

Diário cifrado ha_return_media_reviews: ACCEPTED/CHECKING/REVIEWED/FAILED.
Intenção/reserva 64 MiB antes do processamento; evidência privada clara até 16 MiB,
histórico até 1024 revisões. Falha conserva intenção e quota; UUID repetido só
consulta. Outra revisão ativa/interrompida bloqueia novo trabalho; não inferir
cancelamento por queda de conexão. Não há reinício automático ou adoção de outro
backend. Recuperação explícita de intenção interrompida continua pendente.

Fila/cancelamento/drenagem compartilham Store. Conferem aplicação/bound.db selada,
seleção/recebimento próprios, plano e configuração atuais antes/depois. Configuração
e inventário do acervo/QC não podem mudar antes da confirmação. Posse/sessão e
cancelamento leves nos blocos; sonda isolada existente, sem publicar ou alterar mídia.
Aplicação não é conferida outra vez só por mudar texto de status: SHA nas fronteiras
antes da análise e antes de confirmar a evidência.

Evidência detalhada inclui arquivos locais, probes, medições e montagem: fica
cifrada e NÃO é retornada pela consulta. Resposta inclui hashes/MAC, contagens e
até 200 pendências por edição/item; totais abrangem todas. REVIEWED pode conter
bloqueios. Conteúdos decodificados não significam QC aprovado ou sinal de live;
grafismos/automação/saídas/engine/autoridade ainda são etapas separadas.

GET/POST `/api/ha/returns/media-review`: somente IDs revisão/aplicação/canal.
Admin por canal; escrita TRANSPORT/sessão estável. Não armazenável em cache,
auditada por canal. Página guarda intenção antes de enviar e consulta sem repetir;
nova análise requer encerramento explícito de consulta terminal e novo UUID.

O pacote existente não inclui isso. Fixtures de contrato/diário/cifra/posse/quota
adicionadas, não executadas. Nenhum decode de mídia foi realizado neste lote.

Próximo: associação explícita em mídia ambígua, leitura privada da evidência
confirmada e aplicação a outra derivada com QC/mixes/trims/grafismos/automação,
saídas locais, principal atual/KEEP_PRIMARY/híbrido, autoridade/retorno/rejoin,
histórico entre estações e recuperação de intentos interrompidos. Revalidar bytes,
QC/runtime/configuração/evidência antes de admissão; confirmação histórica não é
estado operacional atual. publicação e operationalReady continuam false.

Totais 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes).
