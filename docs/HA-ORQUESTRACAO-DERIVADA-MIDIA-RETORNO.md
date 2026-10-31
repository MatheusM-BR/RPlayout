# Retorno HA — criação de cópia com mídia ligada à página

11/10/2026 — implementação em lote, NOT_RUN; fora do pacote R55.

Diário/fila/Store/Replication/API/UI agora ligam criação de media.db ao construtor.
HaReturnMediaApplications registra intenção antes de preparar/criar arquivos;
reserva 512 MiB para DB/journal, DB consolidada até256 MiB. UUID repetido apenas
consulta, tentativa única por revisão. Falhas/partiais preservados e reservados.

Source e destino privados, plano/revisão/aplicação/cofre próprios, SHA/tamanho/
identidade/sidecars e MAC/provas reconferidos. Preparação atual verifica mídia/
QC/runtime antes e após construtor; canal permanece arquivado com cursor vazio/
parado e marcador bloqueando bootstrap. Não abre engine/saídas nem autoridade.

Store prepara contexto/provas, sem gerar variantes duas vezes: construção das
edições ocorre somente no worker. Evita duplicar materialização e memória no
servidor. Conferência leve de posse/sessão nos blocos e plano completo nas
fronteiras; revalida arquivos para confirmar cópia, não por mudar texto de status.

GET/POST `/api/ha/returns/media-application`: IDs de cópia/revisão/canal somente;
admin autorizado, escrita TRANSPORT/sessão estável, sem cache, auditoria de canal.
Página dentro de revisão REVIEWED; criação exige bytes/decode completos e sem
bloqueios de mídia/QC. Guarda intenção antes de enviar; consulta sem repetir.
Resposta sanitizada traz SHA/MAC/contagens: mixes/grafismos/lives podem seguir
pendentes. STAGED é histórico de cópia, não autorização para PGM.

Nenhum arquivo/probe/build/teste foi executado neste lote. Fixtures de contrato,
intenção/posse/quota adicionadas, não executadas. O pacote R55 exclui mudanças.

Próximo: conferir/aplicar mixes e render de grafismos/automação, saídas locais,
principal atual/KEEP_PRIMARY/híbrido, engine/autoridade/retorno/rejoin, recuperação
explícita e histórico entre estações, homologação física/partições/carga. Mídia
aplicada não significa runtime aprovado, quadro de PGM ou distribuição autorizada.

Totais 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes).
