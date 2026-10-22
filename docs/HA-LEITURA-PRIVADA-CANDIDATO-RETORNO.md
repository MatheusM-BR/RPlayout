# Retorno HA — origem privada do candidato

Estado em 11/10/2026: implementação em lote, NOT_RUN; fora do pacote R55.

O Store dispõe de `candidateOrigin` interno, serializado e cancelável, para
alimentar o planejamento de vínculos locais. Não existe endpoint que devolva
essa origem: ela inclui caminhos/endpoints estrangeiros e deve permanecer no
servidor. Não foi criada autorização de publicação, preparação nativa ou PGM.

- Exige candidato STAGED e seleção/recebimento pertencentes ao backend atual.
- Usa exclusivamente o diretório recebido registrado, UUID próprio e candidate.db.
- Reconfere SHA completo, tamanho, identidade, ausência de sidecars, ancestralidade
  sem links/junções, diário e fingerprint antes/depois do worker readonly.
- O worker verifica envelope local, IDs/canal/seleção, edições e mapeamentos locais
  determinísticos; o Store compara o pedido inteiro com a seleção registrada.
- Limita envelope a 48 MiB, conteúdo claro a 40 MiB, 128 revisões e 100 mil itens
  por revisão. Mantém limites de memória/cancelamento e exige saída limpa do worker.
- Não abre candidato pelo bootstrap operacional, não migra, não apaga marcador,
  não altera originais e não revalida como pronta uma confirmação histórica.

Continuação necessária: construir visão sanitizada de requisitos, associar
HaBindings ao candidato e às entradas realmente descobertas/saídas atuais do
principal, invalidar revisão ao mudar configuração local e persistir decisão
explícita. Depois materializar outra derivada com mídia local/QC/mixes/grafismos
e resolver autoridade/retorno/rejoin. Igualdade de proveniência não prova sinal,
arquivos locais ou prontidão nativa. KEEP_PRIMARY/híbrido continua pendente.

Fixtures adicionadas, não executadas: contrato somente IDs, recusa de origem
ausente e recusa de intenção não materializada sem liberar quota.

Totais inalterados: 10 grupos (1 concluído/9 abertos); 53 verificações
(5 concluídas/36 em andamento/12 pendentes).
