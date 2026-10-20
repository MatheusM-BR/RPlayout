# Montagens de áudio selecionadas no retorno HA

11/10/2026 — fonte e fixtures NOT_RUN. Sem testes, typecheck, build, arquivo,
medidor nativo, navegador ou hardware executados nesta etapa.

O planejador privado usa edições congeladas e versões de mídia analisadas
localmente, nunca um caminho estrangeiro. Calcula cada corte por cadência
racional, trilha selecionada, roteamento master, modo/ganho editorial e pares
auxiliares. O master e cada par auxiliar recebem identidades distintas por
edição/item/papel/par/SHA/trilha/roteamento/corte/ganho/modo. Contingência live
usa corte/áudio padrão próprios, não os parâmetros da entrada live.

Pares auxiliares geram matrizes exatas para os canais de entrada, sem adotar
o downmix do master como evidência do par. Ausência de áudio explícita não vira
áudio medido; canal/trilha/mídia não comprovados são problemas do plano. Cortes
menores que 400ms ficam pendentes de qualificação específica, pois o medidor
existente não os qualifica. Limites não truncam o plano como completo.

O executor reutiliza rplayout-audio-analysis com o corte/trilha/roteamento
selecionados. Exige PCM de 48kHz estéreo com cobertura integral do intervalo
semiaberto, até uma amostra de arredondamento, e leitura finita de loudness/LRA/
true peak. JSON ok/exit zero ou loudness do arquivo inteiro não bastam.

Verifica SHA/identidade do arquivo antes/depois, identidade/SHA do helper,
cancelamento e posse; processo sem shell/janela, baixa prioridade, limite de
resposta/tempo e pipe do pai aberto para abortar em crash do servidor. A resposta
não repassa erros nativos que podem conter caminhos privados.

Esta prova é de entrada pré-ganho. NÃO qualifica ganho final, limitador,
barramento 8/16 canais, sincronia audiovisual, saída física ou decisão editorial.
Ainda NÃO conectada à revisão/diário/Store/API/UI nem aplicada à derivada.
Nenhuma medição histórica é substituída e nenhum AUTO ou PGM é habilitado.

Próximo: integração serial no pedido de revisão, evidência cifrada por montagem,
resumo público, reconferência e aplicação exata à derivada; decisão AUTO e
qualificação de ganho/limiter/barramento separadas. Recursos/grafismos/automação/
saídas, engine/autoridade, retorno/rejoin, recuperação e homologação continuam.

R55 intacta, não inclui este lote. Totais: 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
