# Criação guiada do candidato de retorno — NOT_RUN

Store/diário/quota/worker/Replication/routes/API/UI integrados em fonte. Sem testes,
typecheck, build, instalação, browser ou hardware nesta etapa. Fora R55.

POST /api/ha/returns/candidate recebe candidateId/planId/channelId estritos.
Descritores, caminhos, seleção e SHA vêm do diário interno. Exige principal
persistente, seleção/revisão/reproteção/recebimento próprios e correspondentes.
Sessão, canal e permissão de transporte reconferidos. UUID existente consulta
mesma intenção; um candidato por planId, sem adotar parcial ou retry automático.

Diário cifrado ACCEPTED e quota fixa 256 MiB registrados antes de qualquer arquivo.
Reserva conta todas as tentativas, inclusive falhas. Espaço físico conferido antes
da criação de UUID privado/ACL/candidate.db vazio. Fila serial do receiver, contador
de trabalho e AbortSignal compartilham cancelamento/drenagem no shutdown.
Falha anterior ao auxiliar também registra FAILED quando o diário está disponível.

Fonte é a inspection.db da revisão reprotegida, somente leitura; SHA/tamanho/
identidade/ancestrais/sidecars conferidos antes e depois. Worker constrói DB NOVO
com identidade local, canal arquivado, cursor parado, variantes bloqueadas sem
paths/endpoints/eventos estrangeiros executáveis e originais cifrados separados.
Backend exige encerramento confirmado do worker, prova de IDs/cofre/ausência de
posse importada, hash/tamanho/identidade efetivos do destino e consolidação sem
WAL/SHM/journal. Bytes do candidato limitados à reserva.

STAGED registra hash de fonte/destino, tamanho, contagem de edições e fingerprint,
sem caminho privado na resposta. channelArchived/cursorStopped=true;
bindingsResolved/nativePrepared/publicationAuthorized/authorityTransferred=false.
Query é histórica, não valida o arquivo neste instante ou confirma posse de engine.
Reinício não adota candidatos antigos automaticamente; ownedHere=false.

Página salva intenção antes do POST, exibe resultado e consulta sem repetir. Não
inicia engine, instala banco, muda perfil ou PGM. Guard genérico de bootstrap
continua recusando ha_return_candidate_origin; não remover marcador como licença.

Falta resolver mídia/versões locais, montar vínculos/saídas explícitos e validar
QC/probe/SHA/mixes/trims/grafismos/comandos em NOVA derivada, revisar principal
atual, construir autorização nativa e retorno/rejoin. KEEP_PRIMARY/híbrido,
retenção/geração perdida, recuperação de intenção incerta e homologação ainda
pendentes. Preparado não equivale a pronto. Fixtures de contrato/diário NOT_RUN.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em
andamento/12 pendentes). Não fechar verificações sem validação consolidada.
