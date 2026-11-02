# Retorno HA — preparação privada com evidência revisada

11/10/2026 — implementação em lote, NOT_RUN; fora R55.

HaReturnMediaReviews.privateEvidence valida envelope próprio confirmado,
application hash, MAC da evidência, contrato privado e correspondência dos totais.
Recusa revisão de outro backend/canal/aplicação ou inventário inconsistente.
Caminhos, probes e mapas continuam internos; nenhuma API os devolve.

verifyReviewedReturnMedia compara requisitos da seleção, acervo/QC atual e runtime
com a revisão, reconfere SHA/stamp dos arquivos escolhidos e reavalia QC técnico
dos probes identificados. Não roda sonda outra vez só para mudar status. Recusa
mídia ignorada, QC revogado, decode não comprovado, arquivo ou runtime alterado.
Esse código não foi executado/qualificado neste lote.

prepareReturnMediaVariants usa o materializador compartilhado para gerar variantes
novas com paths/probes locais, cortes/mixes originais e vínculos escolhidos.
QC local explícito prevalece no ativo derivado; não aprova pelo estado vindo da
reserva. Exige cadência e barramento iguais aos publicados; diferença requer
decisão explícita, não reinterpretar frames. Grafismos/automação/mixes e sinal
live continuam com checks independentes. Não autoriza PGM.

Store.prepareReviewedMedia integra leitura/preparação privadas à fila e drenagem:
revisão/aplicação/seleção/recebimento e plano/configuração próprios, conferência da
bound.db selada e revalidação de bytes/QC/runtime. Resultado só interno, com
verifyCurrent para futura criação/admissão. AINDA não grava uma nova DB de mídia
nem existe botão/endpoint de materialização dessa nova cópia.

Próximo: construtor privado/diário/quota/worker/API/UI da nova derivada com mídia,
guardando marcador de quarentena e canal parado; conferir checks/mixes/grafismos/
automação/saídas, principal/KEEP_PRIMARY/híbrido, engine/autoridade/retorno/rejoin,
histórico/recuperação explícita e homologação. Mesmo evidência aplicada não é
first frame, áudio/sinal físico, grafismo renderizado ou autoridade de execução.

Fixtures de leitura privada/propriedade/application hash e construção pura/
cadência/barramento/bloqueios adicionadas, não executadas. Sem testes/build.
Totais 10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).
