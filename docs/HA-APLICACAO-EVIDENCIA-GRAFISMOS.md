# Aplicação de recibos gráficos à derivada de retorno

11/10/2026 — NOT_RUN: código/fixtures preparados, sem teste, typecheck, build,
renderização executada, navegador ou homologação. Não é conclusão de 8.5/8.6.

O construtor da media.db liga os recibos às referências gráficas congeladas da
seleção. Confere edição, item, posição global da referência, digest da composição
preenchida e chave individual. Referências repetidas do mesmo item/template têm
identidades distintas; ausência/excesso/ordem/conteúdo/edição divergentes recusam
aplicação. Não há fallback posicional para outra composição.

Na preparação e após o worker, o servidor reconfere o executável gráfico quando
há recibos RENDERED, além de fonte selada, mídia, QC e demais estados. Runtime
ausente/alterado exige nova revisão; não adota um recibo antigo como estado atual.
Isso não prova DLLs, fontes, recursos, formato final ou engine do canal.

Cada edição derivada guarda proveniência dos recibos no arquivo privado. Um
recibo RENDERED substitui a pendência de render por pendências explícitas de
aprovação visual e qualificação de composição/camadas/transições. UNAVAILABLE
continua sem render; FAILED continua bloqueio. Não altera a fonte ou o diário
histórico. Históricos sem recibos permanecem sem evidência gráfica aplicada.

Resultado público registra somente resumo e graphicRenderEvidenceApplied, com
correspondência exata ao resumo da revisão. O fluxo de confirmação recusa resumo
diferente daquele aplicado; a página informa quadros comprovados sem anunciar
prontidão de transmissão. A cópia continua arquivada/parada, sem saídas,
nativePrepared=false, authorityTransferred=false e publicationAuthorized=false.

Falta decisão/aprovação visual real, recursos/fontes/CSS locais, composição de
camadas/transições, mixes/cortes/trilhas e automação/saídas locais; habilitação
segura do canal/autoridade, retorno/rejoin, recuperação de pedidos e homologação
física. Estes recibos isolados não substituem esses contratos.

R55 preservada, não inclui este lote. Totais: 10 grupos (1 concluído, 9 abertos);
53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
