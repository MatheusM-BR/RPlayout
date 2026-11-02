# Áudio: corte declarado com duração alterada

11/10/2026 — implementado em fonte, NOT_RUN. Sem testes/typecheck/build.
Não está no pacote R55; não conclui nenhuma das 53 verificações.

Divergência encontrada por leitura de fonte: a admissão de publicação usava
durationOverride, mas a análise de mix local e o planejamento/admissão de
medições do retorno usavam apenas resolveTrim. Assim, o recibo poderia medir
outro trecho e depois não corresponder à execução real.

declaredFileTrim centraliza o corte declarado de arquivos: resolve primeiro
mark-in/defaultTrim e sua cadência; quando durationOverride não é null nem
undefined, o out é in + durationOverride. Valores vazios, fracionários,
inválidos ou além dos quadros disponíveis são recusados, sem clamp, loop ou
fallback silencioso para o corte nominal.

Consumidores integrados: análise de mix local (consulta, fila e reconferência
antes/depois), admissão de publicação, cálculo nominal de áudio da visão,
inspeção local de mídia no HA, planejamento master/auxiliar do retorno e
recomposição da decisão AUTO. A duração participa do corte em ns, portanto
altera a chave da montagem e invalida recibos do trecho anterior. Fallback
permanece sem duração editorial herdada do item live; imagem parada mantém
contrato próprio e não entra no planejamento de medição de arquivo.

Isso NÃO comprova o corte dinamicamente ajustado pelo timing. executionTrim
continua resolvendo-o na montagem; assertTrimAudio continua recusando AUTO
TRIM que não corresponda ao corte realmente montado, preservando PGM. Nova
medição correspondente ou decisão manual explícita ainda é necessária nesse
caso, sem converter AUTO silenciosamente. Qualificação de ganho final,
limitador/barramento/A-V e homologação física permanecem pendentes.

Fixtures NOT_RUN acrescentadas: equivalência com execução sem ajuste dinâmico,
duração curta/estendida, cadência do trim padrão, duração inválida/fora do
arquivo, novas chaves master/auxiliar e rejeição de recibo anterior após mudar
duração. A validação conjunta deverá também cobrir análise local/QC, grade e
montagem dinâmica no engine.

Totais: 10 grupos (1 concluído, 9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes).
