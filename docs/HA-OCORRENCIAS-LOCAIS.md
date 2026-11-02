# Mudança de item na execução promovida — NOT_RUN

Após a primeira admissão PGM, cada TAKE confirmado no transporte próprio captura
o decoder nativo. A fila de accounting admite uma ocorrência nova no compositor,
com novo executionId, item e duração da edição congelada/corte efetivo. Não usa
edição editorial mutável nem confirma comandos da máquina de origem.

O compositor drena manutenção anterior, confere concessão/geração/decoder e grava
HA_OCCURRENCE_ADMITTED antes de resetar o scheduler para o novo item. A retomada
inicial continua usando supressão dos eventos passados da origem; uma ocorrência
nova pode executar seus próprios eventos, sem reutilizar IDs/fases de execução.
Eventos relativos ao fim de live sem duração explícita são recusados.

Checkpoint só avança quando o decoder atual corresponde à ocorrência admitida
no accounting; não associa o executionId anterior ao novo item. Se outro TAKE
ultrapassar a fila/admissão, a geração própria é encerrada em vez de registrar uma
execução presumida. A composição já confirmada é preservada e sua expiração
continua com recibos locais; não se presume que toda troca exija apagar grafismos.

Isso integra mudanças de item dentro da edição já admitida. Não conclui troca de
edição, fronteiras entre playlists, contingência, controle HTTP de TAKE da reserva,
comandos externos/SCTE, replicação reversa ou retorno ao principal. Fixtures
mockados preparados, não executados; nenhuma prova física nem nova build.
