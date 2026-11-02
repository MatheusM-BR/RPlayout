# Recibos privados da medição isolada pós-ganho

11/10 — implementação em fonte, NOT_RUN. Sem testes, compilação ou nova build.

Runner agora retorna evidência estrita e resumo separado. Cada entrada conserva
identidade sem path: revisão/item/master ou auxiliar/par/hash/trilha/mix/corte,
ganho editorial, ganho efetivo/teto, perfil, MAC e decisão AUTO. Recalcula chave
da montagem e chave pós-ganho; o vínculo recompõe o plano confiável atual e exige
ordem, quantidade, issues e identidade semântica exatas. Não basta um hash solto.

Recibo nativo exige SHA do runtime, PCM cobrindo corte exato, parâmetros DSP,
data, medição isolada e flags de não qualificação. MEASURED exige recibo; FAILED
proíbe recibo. Duplicação, omissão, runtime divergente, mudança de corte/mix/par,
ganho/teto, cauda descarregada ou aprovação presumida são recusados. Resumo não
contém mídia/path nem recibos individuais. required = measured + failed; bloqueios
do planejamento são contados separadamente, nunca disfarçados como medidos.

Não é workflow durável ainda: falta intenção/diário/quota/Store/API/UI ligados
à aplicação de mídia, captura/reconferência do perfil local e decisão AUTO
registrada. Nenhum dado é publicado pela API nesta etapa. Persistência cifrada
terá de preservar identidades e aceitar só resumo no retorno público.

DSP continua estéreo isolado, reset e cauda não descarregada. Não qualifica
barramento 2/8/16, soma de auxiliares, transições, A/V, QC, promoção ou PGM.
Fixtures preparadas NOT_RUN para identidade/paths/parâmetros/PCM/runtime,
duplicação/omissão/falhas e flags. Não são evidência de validação.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes). 8.5/8.6 permanecem em andamento.
