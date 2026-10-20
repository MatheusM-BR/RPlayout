# Retorno HA — construtor de derivada com vínculos de entrada

11/10/2026 — implementação em lote, NOT_RUN; fora do pacote R55.

`materializeBoundReturnCandidate` está ligado ao auxiliar privado existente por
`runBoundReturnCandidate`. Recebe candidato próprio selado e plano privado já
conferido. Não existe ainda chamada no Store/API/UI para criar essa derivada:
diário, quota, decisão e confirmação externa da aplicação são a próxima integração.

O construtor copia candidate.db para bound.db novo/vazio em diretório privado de
outro UUID. Confirma SHA/tamanho/identidade da fonte, preserva ancestralidade sem
links/junções, limita a 256 MiB e lê proveniência dos próprios bytes copiados.
Nunca altera candidato/recebimento/revisão originais. Falha conserva parcial.

Na derivada aplica as referências locais escolhidas a sourceRef/liveEndpoint/
liveConfig e configuredSourceId. Recusa protocolo incompatível, fontes duplicadas,
entradas fora da seleção e referências conflitantes. Live sem referência é
recusada. Cria IDs de revisão novos e checkpoint vazio/parado, sem extrapolar
cursor nem importar confirmação nativa.

Mídia continua sem caminho, ignorada e BLOCKED: arquivo/QC/decode/mixes ainda
precisam de comprovação local. Grafismos e eventos secundários não são habilitados;
originais e plano de saídas ficam só na proveniência cifrada. Nenhuma saída,
execution owner, distribution owner ou as-run é instalada. Canal continua arquivado.
Relatório distingue `inputBindingsApplied:true` de `mediaValidated:false`,
`outputsApplied:false`, `nativePrepared:false`, `authorityTransferred:false` e
`publicationAuthorized:false`. Aplicar uma referência não prova sinal real.

Marcador `ha_return_bound_origin` também bloqueia bootstrap genérico mesmo sem
marcador anterior. Não apagar marcador para liberar canal. Entrada operacional
continua dependendo do fluxo explícito de mídia, principal atual, cursor,
autoridade/retorno/rejoin e homologação física.

Fixtures adicionadas, não executadas: mapeamento em clone/original preservado,
protocolo/conflito/duplicata/live sem referência, contrato interno e bloqueio do
bootstrap pela nova proveniência. Sem testes/build nesta fase.

Totais: 10 grupos (1 concluído/9 abertos); 53 verificações
(5 concluídas/36 em andamento/12 pendentes).
