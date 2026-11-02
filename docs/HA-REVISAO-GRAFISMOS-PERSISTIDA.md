# Grafismos na revisão persistida do retorno

11/10/2026 — NOT_RUN. Implementação em lote, sem testes, typecheck, build,
sonda executada, navegador ou homologação física.

A sonda separada está conectada à fila da revisão de mídia do retorno via
Store/Replication/configuração. O inventário compartilhado captura a composição
após preencher valores; cada referência mantém sua edição, item e identidade
por digest, inclusive quando duas referências reutilizam pixels idênticos.
Composições iguais são renderizadas uma vez dentro do pedido, nunca adotadas
de outro pedido/runtime. Falhas iguais não repetem o processo neste pedido.

Estados: BLOCKED (dependência/template inválidos), UNAVAILABLE (helper ausente),
FAILED (render não confirmado), RENDERED (quadro exato confirmado). Falha de
render bloqueia a montagem; ausência de runtime mantém pendência explícita.
Evidência de composição/pixels/runtime fica no envelope cifrado/MAC da revisão.
Nenhum SVG, pixel, caminho ou recibo detalhado é acrescentado à resposta pública.
Ela mostra apenas totais, além dos códigos de pendência por item já existentes.

O executável é reconferido no término da análise e antes da gravação final,
junto da aplicação selada, plano, acervo e QC. Decodificação do recibo privado
confere totais/status e associação de cada composição à montagem publicada.
As interfaces apresentam renderização e aprovação visual como fatos distintos.

As colunas novas do recibo são opcionais para leitura dos históricos: recibos
antigos continuam sem evidência gráfica, não são regravados nem considerados
aprovados. A página explica explicitamente essa ausência.

RENDERED não significa aprovação visual, composição completa multicamada,
transição, font/DLL qualification ou autorização de PGM. Os avisos de render
pendente na derivada continuam: ela ainda NÃO aplica os recibos gráficos como
evidência atual de execução. `nativePrepared` e autoridade continuam falsos.

Próximos passos: reconferir/aplicar esses recibos à derivada, decisão visual,
recursos/fontes/CSS locais, montagem multicamada/transições e automação;
mixes/cortes/trilhas, saídas, ativação e autoridade, retorno/rejoin, recuperação
de pedidos interrompidos e homologação real. Não declarar 8.5/8.6 fechados.

Fixtures adicionadas NOT_RUN. R55 intacta e sem estas alterações.
10 grupos (1 concluído/9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes).
