# Retorno HA — construtor de cópia com mídia revisada

11/10/2026 — implementação em lote, NOT_RUN; fora do pacote R55.

materializeReturnMediaCandidate está ligado ao auxiliar existente por
runReturnMediaCandidate. Cria media.db em novo diretório UUID privado, copiando
bound.db selada. Ainda falta diário/quota/Store/Replication/API/UI para essa
gravação; prepareReviewedMedia continua apenas preparação interna.

copySealedReturnDatabase confere fonte/destino específicos, hash/tamanho/identidade,
ancestralidade, sidecars e arquivo novo/vazio; não apaga/reescreve original.
Lê proveniência dos bytes copiados, valida candidato/aplicação/cofre e MAC da
evidência EXATAMENTE codificada. Não recalcula MAC sobre JSON reordenado pelo
validador. Contrato/contagens da revisão são conferidos pelo mesmo verificador
usado no Store; job privado≤32 MiB, evidência≤16 MiB, DB≤256 MiB.

Materializador compartilhado reconstrói variantes com paths/probes/QC local,
cortes/mixes e referências de entrada escolhidas. IDs de revisão novos; cursor
operacional vazio/parado; intenção de retomada guardada separadamente na
proveniência cifrada, sem extrapolar tempo ou importar confirmação nativa.

Preserva markers anteriores e cria ha_return_media_origin. Bootstrap genérico
recusa também esse marker sozinho/vazio. Canal deve continuar arquivado, sem SDI
principal, output_profiles/live_sources/owner runs/as-run; integrity/FK/cópia
reconferidos. Fonte preservada, parcial conservado se falhar.

Resultado distingue mídia com evidência aplicada de checks restantes: live,
mixes, grafismos e automação. Nenhuma saída/engine/autoridade/publicação habilitada.
Acervo e decisões locais não são importados como histórico estrangeiro; metadados
locais ficam na edição congelada e evidência cifrada. Admissão futura deve conferir
esse contrato e os gates completos, não abrir essa DB como instalação comum.

Próximo: orquestração durável da nova DB conferindo bytes/QC/runtime/planos nas
fronteiras, relatório sanitizado e ação na página; grafismos/mixes/saídas/engine/
principal atual/KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin, histórico/recuperação
explícita e homologação física. Não remover marker como atalho de execução.

Fixtures de contrato/correlação/marker/MAC exato adicionadas, não executadas.
Sem testes/build nesta fase. Totais 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 em andamento/12 pendentes).
