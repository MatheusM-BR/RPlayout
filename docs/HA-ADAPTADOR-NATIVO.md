# Adaptador nativo de promoção — NOT_RUN

`nativeHaPromotionAdapter` implementa a interface interna HaPromotionAdapter.
Preparo valida cópia/backend/edição/composição/montagem e devolve handle sem
abrir segunda geração. activate usa exclusivamente createFencedDecoder privado
do orquestrador, que exige transferência/admissão atuais e warmup parado.
Arma decoder, prepara composição, retoma PGM interno e devolve transporte
cercado com saídas AINDA RETIDAS. Orquestrador é quem libera saídas e inicia
accounting/manutenção; adaptador não oferece transferência nem release.

Activation e stop deduplicados, inclusive falha; handle fechado não reabre.
Resultado perdido na criação é incerto, sem inferência por PID ou timeout.
Abort/admissão são verificados antes/depois das etapas. Fixtures mockados
NOT_RUN, posteriores à R55, sem build/hardware.

Implementação disponível para injeção interna, ainda NÃO escolhida como padrão
no serviço HA: faltam integração operacional (novas edições/contingência/painel/
Preview), tratamento explícito de incertezas e validação do lote. Não tornar
default removendo as guardas de quarentena. Não anunciar redundância pronta.
