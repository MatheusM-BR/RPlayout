# Contas e sessões — consultas limitadas na interface

Fixture CEQ0LU, backend compilado atual e web index-BJ2Vvwm5.js; banco próprio,
conta sintética, engine/MediaMTX desativados. Gateway loopback atrasou somente
primeiro GET /api/users/review e /api/users/qa-admin/sessions, sem mutações.

Browser: contas inicialmente bloqueadas durante consulta; timeout mostrou
mensagem de leitura falha, não catálogo vazio, e reabertura habilitada.
Reabertura explícita carregou1 conta. Conferência de sessões atrasada mostrou
mensagem de que nenhuma sessão fora encerrada, conservou lista e bloqueou
edição. Reabrir contas e consultar novamente mostrou1 sessão com datas,
sem token/senha. Cancelar fechou apenas a conferência, não a sessão.

Gateway confirma cancelamento cliente em10,056s e9,997s; não é medição de
latência real de rede/servidor. Resultado FIXTURE_COMPLETED, zero alterações
de conta/acesso/revogação, servidor encerrado/aba fechada. browserValidated:false
do JSON permanece conservador: prova visual está neste documento.
Capturas em scratch/account-read-browser-CEQ0LU/catalog-timeout.png,
session-timeout.png e sessions-recovered.png. Resultado na mesma pasta.

Não homologa mutação de contas/senhas, revogação real, estação remota ou
implantação. Lote posterior àr64, ainda sem pacote.6.3 segue em andamento.
