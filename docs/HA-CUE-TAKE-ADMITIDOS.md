# CUE/TAKE da reserva — implementação NOT_RUN

Controles usam apenas itens da edição operacional congelada no handle promovido.
CUE é seleção/preparo no PVW: ACK de abertura não é SIGNAL_OK, primeiro quadro ou
confirmação de publicação. TAKE exige exatamente o CUE informado, sem escolha
automática de próximo item, outro destino ou edição editorial.

Comandos serializados com preroll/EOS exigem mesmo processo/owner/term, posse da
cópia, concessão assinada e autorização de operador/admin no canal. TAKE de live
aguarda identidade nativa/decoder após primeiro quadro; ACK inicial não confirma.
Timeout cancela a abertura pendente e mantém resultado incerto, sem replay.

Diário cifrado registra UUID/intenção/fases/prova/ator. UUID duplicado apenas
consulta; intenção diferente é recusada. Qualquer controle pendente/incerto no
canal impede outro comando. GET não executa nada. Confirmação é histórica e
não prova saída física. Revisão de TAKE incerto não usa o contrato idempotente
de monitor: precisa de reconciliação operacional própria, ainda pendente.

Engine, handle, HTTP e painel integrados. Interface seleciona somente itens
publicados, exibe CUE atual e oferece TAKE do CUE, sem usar a seleção da lista
como substituto de CUE. Guarda UUID/intenção antes do envio em sessionStorage;
reload ou erro de rede apenas preservam pedido para consulta GET. Resposta TAKE
sem prova nativa exata não habilita novo comando. CUE recém-confirmado atualiza
seleção local até chegar observação posterior; consulta histórica não faz isso.
Dados desatualizados, diário inválido e pedido pendente/incerto bloqueiam ações.

## Revisão sem replay — NOT_RUN

O transporte agora retém até 256 recibos locais correlacionados ao UUID, ação,
edição e owner/term. CUE grava após preparo/ACK; TAKE grava somente no callback
de confirmação nativa do item e de um decoder novo, não apenas por encontrar o
mesmo item previamente no ar. Perda da geração não permite usar esse cache como
autorização de execução, e o browser não pode fornecer sua própria prova.

Consulta pode oferecer token de revisão quando há recibo correspondente e o
comando já não está em execução. POST de revisão reconfirma host/posse/concessão,
token e recibo, sem emitir comando de engine. Acrescenta registro cifrado de
revisão, preservando a fase original; query projeta resultado reconciliado com
prova e origem. Novo comando só deixa de ser bloqueado após essa prova.

Painel oferece revisão somente depois da consulta. Revisão histórica de CUE não
altera a seleção atual. Sem recibo, após restart/perda de geração, ou quando o
pedido sequer foi registrado, a incerteza continua bloqueada: falta workflow
operacional de encerramento/reconciliação dessas situações. Não usar reset de
monitor para reexecutar TAKE incerto.

Faltam revisão de geração perdida, fronteiras/contingência/habilitação/replicação/
validação. Nenhum teste, build ou TAKE real foi executado neste lote.
