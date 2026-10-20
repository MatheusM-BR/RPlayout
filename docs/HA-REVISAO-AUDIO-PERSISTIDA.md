# Áudio selecionado na revisão persistida de retorno

11/10/2026 — implementação/fixtures NOT_RUN; sem testes, typecheck, build,
medidor, arquivo ou navegador executados.

Planos de corte/trilha/master/auxiliares são executados em série dentro do pedido
durável de revisão de mídia. A configuração usa o medidor local do pacote.
Cada recibo guarda identidade exata da montagem, cobertura PCM, runtime e leitura
pré-ganho. MEASURED/FAILED/UNAVAILABLE são distintos; problemas do plano e cortes
curtos aparecem separadamente. Falha nativa bloqueia a montagem, ausência do
medidor permanece pendência. Não usa caminhos estrangeiros ou escolhas HTTP.

Recibos completos ficam no envelope cifrado/MAC, sem caminhos do plano. A API
mostra só totais e códigos; a página separa medição pré-ganho de qualificação
final. Runtime é reconferido no fim da revisão e antes da confirmação persistida,
junto da aplicação selada, acervo, QC, planos e grafismos. Leitura do recibo
verifica resumo e associação à montagem publicada.

Históricos sem campos de áudio continuam históricos, sem prova adicionada ou
aprovação presumida. A revisão não altera áudio/AUTO de itens, não substitui
medições editoriais e ainda NÃO aplica estes recibos à derivada. Os avisos de
mix/render e a necessidade de ganho/limitador/barramento permanecem.

Próximo: associação semântica ao plano original e à derivada, reconferência
atual e aplicação explícita de medições correspondentes; AUTO/QC selecionado,
ganho/limitador/barramento/sincronia, grafismos/recursos/automação/saídas,
engine/autoridade, retorno/rejoin/recuperação e homologação física.

R55 intacta e sem o lote. Totais 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
