# Preparação nativa com PGM retido — lote NOT_RUN

Integração das pendências 8.3/8.4, posterior à R55. Código e fixtures adicionados;
sem compilação, execução, homologação física ou novo instalador nesta etapa.

## Contrato implementado

`holdProgramOutputs:true` chega por bootstrap privado. O engine monta o canal
com consumidores nulos; não constrói os destinos configurados de PGM nessa
fase. Preview/QC são barramentos separados, não autorização para publicar PGM.
O Ready declara suporte ao contrato e retenção efetiva. O backend exige ainda
o canal correto e identidade de decoder; binário antigo/incompatível é recusado.
Cada nova geração volta a iniciar retida.

Prova de cursor nativa: evento inclui elapsed, firstVideoConfirmed e corte real
do ItemSpec executado (ou null para live/idle). A posição vem da consulta do
pipeline, não de relógio extrapolado no backend. TAKE live pendente recusa
admissão do PGM anterior/idle. VT exige quadro entregue recentemente, roteamento
e posição dentro do corte; live exige prontidão recente e offset retomado.
As condições são conferidas antes e depois da montagem. Falha após abrir os
destinos encerra imediatamente essa geração, sem esperar reação de Node.
Backend exige estrutura estrita, posição não anterior ao cursor salvo, corte
exato e primeiro quadro para material ativo. Método interno retorna essa prova
observada; não pode ser fabricada por HTTP. SHA é associado à versão verificada
pelo backend/candidato, não anunciado como hash calculado pelo decoder.

`releaseProgramOutputs` vincula owner UUID, termo, item e decoder atuais.
Sem cerca nativa vigente, ou com cursor diferente, o engine recusa. Material
ativo exige primeiro buffer; live exige também prontidão recente e roteamento.
Após construir os destinos, aplica guards, sincroniza os elementos novos e
reconfere a concessão antes de emitir o evento com o mesmo cursor.
Montagem parcial ou montagem travada por 12 segundos encerra somente esse
processo. O watchdog de concessão permanece independente da montagem/Node.

O backend aceita o evento somente durante o pedido correspondente, com
owner/termo/cursor ainda atuais. ACK sem evento não basta. Autorização e posse
são conferidas antes e depois; alteração posterior ao envio, timeout ou prova
divergente encerram o filho próprio e impedem replay/restart desse transporte.
O diário de promoção deve conservar UNCERTAIN, inclusive quando a parada
subsequente for confirmada: parar não desfaz uma transferência já realizada.

## Limites e integração restante

Cleanup interno agora dispõe de `EngineTransport.closeConfirmed()`. Cada handle
de processo retornado por spawn é rastreado, inclusive gerações anteriores
substituídas pelo watchdog sem exit observado. Encerramento confirmado exige
exit de todos esses handles, ou erro de spawn sem PID. Erro com PID, pipe fechado,
retorno de kill e timeout não comprovam morte. Fecha o transporte antes da
espera e só encerra handles próprios; não pesquisa nem reconstrói PIDs de outro
backend. Timeout devolve `ownedNativeProcessesStopped:false`, deduplicado para
esse cleanup, preservando a incerteza no diário. Relays ou outros recursos
iniciados pelo adaptador ainda exigem confirmação própria, não coberta por esse
resultado. Fixtures de exit, erro, timeout e gerações múltiplas: NOT_RUN.

Esse contrato não é o adaptador completo de promoção. O produto continua com
adaptador nulo e recusa promoção antes de transferir autoridade. Não há botão
ou endpoint de promoção habilitado por este lote. Ainda falta criar a execução
local admitida, vincular posse host/storage, preparar cursor/corte/mixes/grafismos,
abrir a geração cercada, usar a liberação interna e registrar a prova final.
O workspace preparado deve continuar imutável; não reutilizá-lo para execução.

Preparação sem concessão não pode liberar saídas. Após transferência, é
necessária uma geração com concessão do próprio owner admitido; não promover
um decoder sem cerca nem interpretar um recibo histórico como posse atual.

Evento de liberação prova a transição interna, não entrega ao destinatário,
qualidade de imagem/áudio ou exclusividade física do roteamento SDI/rede.
Guard nativo não elimina pacotes já em trânsito. A promoção completa precisa
reconferir engineLeaseActive e owner/nó/termo na testemunha, além da prova de
vídeo e cursor da edição exata.

## Revisão consolidada posterior

Fixtures de transporte: retenção incompatível, confirmação válida, ACK isolado,
revogação antes/depois do envio, evento espontâneo e decoder divergente.
Fixtures Rust: flag privada tipada e vínculo serializado owner/termo/item/decoder.
Todas NOT_RUN. Acrescentar à rodada nativa a ausência de abertura SDI/rede no
preparo, liberação dinâmica GStreamer, falha parcial, bloqueio de driver,
expiração durante montagem e ausência de replay após perda de ACK.
Fixtures adicionais: posição anterior, final do corte, corte divergente,
prova ausente/extra/adulterada, live com corte de arquivo e idle com material
inesperado. Ainda NOT_RUN; prova de decoder não comprova o primeiro quadro
recebido no destino externo ou fidelidade da composição.
