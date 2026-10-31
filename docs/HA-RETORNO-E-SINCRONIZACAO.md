# Retorno ao principal — conferência NOT_RUN

11/10: receptor reverso e painel de quarentena integrados em fonte (ver
HA-RECEBIMENTO-REVERSO.md). Remetente e reconciliação ainda ausentes; nenhum
recibo no reserva remove automaticamente os bloqueios de retorno.

Painel/API agora conferem retorno usando diário de parada e assignment assinado
da testemunha. Apontam parada incompleta, concessão vigente, mudança de instância,
mudança de autoridade e resultados de controle não reconciliados.

Não há comando de devolução habilitado nesta etapa. Exportação selada local da
execução integrada em fonte (NOT_RUN; ver HA-EXPORTACAO-EXECUCAO.md); transferência
reversa e reconciliação no principal continuam requisitos ausentes,
nunca substituídos por checkbox, heartbeat ou arquivo encontrado. A conferência
é read-only, exige administrador no canal e não inicia engine nem devolve posse.

Continuar: selar cópia encerrada com cursor/edições/as-run/diários; transferir para
área de quarentena do principal com SHA e recibo assinado; revisar divergências,
material e resultados incertos; só então habilitar transferência explícita por
UUID e retomada admitida. Nenhum desses passos pode inferir morte remota por PID
local ou apagar histórico executado. Fixtures NOT_RUN; sem testes/build.
