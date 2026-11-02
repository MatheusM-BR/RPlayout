# Decisão explícita de medição AUTO no retorno

11/10/2026 — código/fixtures NOT_RUN, sem testes, typecheck, build, medidor,
navegador ou hardware executados.

Contrato novo recebe somente decisionId, mediaReviewId, channelId, evidenceMac,
chaves das montagens e justificativa. Não aceita loudness/caminho/ganho arbitrário
do navegador. O construtor privado liga seleção às edições e aos recibos
MEASURED. Só pode propor medição para um master editorial já AUTO; MANUAL/OFF
nunca são convertidos. Reconfere conteúdo/corte/trilha/roteamento por contrato
compartilhado e produz scope TRIM com identidade nova de análise local.

A proposta mantém ganho, roteamento, pares e modo; não modifica publicação,
acervo ou QC. A decisão fica em diário cifrado imutável, com ator/justificativa,
hash da revisão e MAC da evidência. Mesmo UUID apenas consulta a intenção exata.
Um novo UUID não substitui a decisão da mesma revisão. Boot estrangeiro não
ganha autoridade por consultar o histórico.

Ainda NÃO instanciado no Store, incluído na quota/namespace de replicação,
ligado a API/UI ou aplicado ao worker da derivada. A revisão ainda não pode
ignorar SELECTED_AUDIO_MEASUREMENT_MISSING. Faltam revisão sanitizada de opções,
reconferência atual/ator estável, gravação/aplicação e recuperação guiada.

AUTO de contingência live exige contrato separado por versão/montagem: o
construtor recusa atualizar defaultAudio global que poderia afetar outros itens.
Não confundir esta limitação explícita com conclusão do suporte de contingência.
Ganho/limiter/barramento/sincronia/QC/saídas/engine/autoridade permanecem pendentes.

Próximo: completar orquestração/consulta/API/UI e aplicação em nova derivada;
decisão de contingência sem alterar outros usos, perfil de QC da montagem e
qualificação pós-ganho/barramento; grafismos/automação/saídas, retorno/rejoin,
recuperação e homologação real. Históricos e R55 preservados.

Totais: 10 grupos (1 concluído, 9 abertos); 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes).
