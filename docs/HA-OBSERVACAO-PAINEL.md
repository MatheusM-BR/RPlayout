# Observação da execução promovida — NOT_RUN

Consulta GET /api/ha/executions?channelId=... ligada ao diário/promotor local,
backend HA e painel da reserva. OUTPUT_CONTROL + ADMIN + autorização no canal,
sem cache, sem promoção/TAKE/alteração de destino. Canais do seletor vêm da
lista filtrada já existente; sem paths/URLs/credenciais no payload observado.

No máximo 20 pedidos daquele canal, fase/horário/UUID e confirmação HISTÓRICA
separados do handle da geração cercada rastreada neste processo. Mostra engine
marcado como pronto, saídas retidas, item/decoder e posição nativa recente
quando disponíveis; não inventa zero nem usa engine de outro backend por PID.
Autoridade atual e saída física NÃO são comprovadas por essa consulta. Processo
pronto não equivale a entrega de sinal; esses avisos estão no painel.

Refresh a cada 5 s, sem sobrepor solicitações, ignora resposta após troca de
canal/desmontagem e informa dados possivelmente antigos em falha. Ainda não é
MasterControl da execução promovida: comandos/monitor/MediaMTX/roteamento e
habilitação do adaptador continuam pendentes. Fixture de distinção entre
histórico/handle NOT_RUN. Sem teste HTTP/render/browser/build nesta etapa.
