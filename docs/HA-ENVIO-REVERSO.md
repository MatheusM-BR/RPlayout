# Envio explícito da execução — NOT_RUN

Atualização: retomada explícita de parciais e limite de tráfego integrados
em HA-RETOMADA-TRANSFERENCIA.md (NOT_RUN). Não há retomada automática ou
adoção de geração perdida. Notas de ausência abaixo são histórico desta etapa.

Reserva configurada com endereço do principal, promoção/testemunha e cópia
encerrada própria agora integra remetente, diário cifrado, API e painel.
Implementação em lote sem testes/build; não incluída no pacote R55.

Pedido estrito: UUID/canal/promoção/exportação; sem caminho/destino do navegador.
HaPromotions fornece somente exportação selada de cópia cuja parada foi confirmada
neste backend. Não adota execução após perda da instância. Selo/diário/parada/
host/owner/recursos encerrados e sessão são reconferidos antes e entre blocos.

Diário registra intenção antes do envio e sequência antes de cada operação.
Um envio por exportação; UUID repetido apenas consulta. SHA atual da origem é
conferido antes de BEGIN. Fonte fica aberta, com identidade/tamanho/tempos
reconferidos; WRITE limitado a 256 KiB, offsets confirmados exatos. Destino
é o peer configurado, redirects recusados, envelope/recibo RETURN autenticados.
Recibo deve corresponder ao UUID, exportação, promoção, canal, parada,
manifesto, SHA executado, tamanho e envelope da operação. VERIFY confirma
recebimento em quarentena somente após SHA completo no principal.

Resposta perdida/perda de geração/SHA alterado/recibo divergente deixa resultado
incerto; não há retry de bloco/resume automático. Consulta remota explícita envia
somente STATUS, jamais BEGIN/WRITE/VERIFY. Pode recuperar recibo final perdido
quando a mesma execução encerrada ainda pertence ao backend; parcial permanece
incerto. Consulta local preserva evidência histórica após reinício. Instância
perdida não autoriza retomada de transferência. Encerramento drena envios.

Página persiste intenção antes de POST e oferece diário local e consulta remota.
Intenção corrupta não é sobrescrita. Permissões de administrador, canal, controle
de transporte e identidade estável são reconferidas; caminhos/bytes privados
não são expostos ao navegador.

Ainda NÃO há incorporação/sincronização do banco operacional do principal,
aprovação SQLite/schema/chaves/mídia/edição/cursor/as-run, devolução de autoridade
ou retomada. RECEIVED_QUARANTINE não remove esses bloqueios.

Faltam recuperação explícita de parciais/geração perdida, limites de rede do
envio reverso e retenção de quarentena, reconciliação durável no principal,
retorno/rejoin, testes de bytes/recibo/timeout/crash/TOCTOU/pareamento, homologação
entre hosts, build e publicação. Fixtures de contrato adicionadas: NOT_RUN.
