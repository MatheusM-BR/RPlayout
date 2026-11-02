# Conferência compartilhada de grafismos no retorno HA

11/10/2026 — implementação em lote, NOT_RUN. Sem teste, build ou engine executado.

A revisão de mídia local e a construção da derivada agora usam o mesmo inventário
de grafismos e automação. Antes, a revisão não contava esses bloqueios, enquanto
a construção posterior os encontrava. A revisão persistida passa a incluir essas
montagens, seus bloqueios e a revisão original, com os limites existentes.

Os campos das deixas e eventos secundários são preenchidos com `renderTemplate`,
como no fluxo operacional. O inventário verifica o SVG resultante, não somente
o template: valores ou padrões que introduzem caminhos externos exigem decisão
local explícita. Referências codificadas/escapadas não são admitidas como prova
de recurso local. Templates duplicados e respostas excessivas são recusados.
Eventos externos habilitados continuam bloqueados; desabilitados não são ativados.

Isso é análise de dependências, não parser XML/CSS, sanitização completa ou prova
de pixels. `LOCAL_GRAPHIC_RENDER_PENDING` permanece até renderização nativa real.
Nenhum caminho resolvido é acrescentado ao relatório público. A fonte publicada
continua congelada; não houve substituição de recursos, ativação de saída ou
transferência de autoridade.

Revisões históricas não são alteradas nem reinterpretadas. Pedidos novos usam
a conferência compartilhada; aplicação posterior reconfere as dependências.

Próximos passos: render nativo por composição, evidência de mixes/cortes/trilhas,
vínculos explícitos de recursos e automação, saídas locais, ativação e autoridade,
retorno/rejoin e homologação em duas máquinas. Fixtures adicionadas, NOT_RUN.
Totais: 10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). Fora da build R55.
