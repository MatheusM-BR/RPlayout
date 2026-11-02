# Retomada explícita e limite de rede — NOT_RUN

Implementação em lote: fonte/diários/API/página integrados, sem testes/build.
Não incluída em R55. Não equivale à retomada de PGM ou à aprovação do principal.

Todos os envios reversos deste remetente compartilham orçamento de tráfego,
incluindo custo conservador de base64/cifra/JSON/cabeçalhos. Usa
RPLAYOUT_HA_MEDIA_MBIT (padrão 8 Mbit/s, intervalo 1–1000), também usado nas
cópias de mídia. Retorno e cópia de mídia são orçamentos separados; não anunciar
limite agregado global do host. Espera assíncrona é cancelada no encerramento;
posse/sessão/origem são reconferidas DEPOIS da espera e ANTES de transmitir.

Envio inicial repetido continua somente consulta. Retomada é outra intenção
explícita com resumeId/requestId/channelId/reviewToken/expectedOffset.
Diário cifrado de retomada é registrado antes dos bytes e preserva ações anteriores.
GET do pedido de retomada não reenvia nada. UUID repetido só consulta mesma intenção.

Token vincula versão atual do diário, dono, recibo e offset. Exige mesmo backend,
origem encerrada própria, envio incerto, principal em RECEIVING, nenhuma operação
ativa. Reabre fonte própria em leitura, confere SHA completo atual; consulta
STATUS autenticado fresco e exige offset exato antes de continuar a partir dali.
Não envia BEGIN, não reinicia/trunca destino, não adota parcial após reinício do
receptor/remetente. Principal ainda reconfere dono/identidade/tamanho antes de WRITE.
Completar bytes sem VERIFY não prova recebimento: retomada pode executar VERIFY
quando offset já corresponde ao tamanho selado.

Página salva todas as intenções de retomada antes do POST. Pedido local desconhecido
exige consulta antes de outra tentativa; intentos corruptos são preservados.
Novas tentativas são ações explícitas, limitadas pelo token e conferência fresca.
Timeout/falha conserva diário/evidência; nenhuma retomada automática.

Faltam: recuperação de gerações perdidas/arquivo à frente do diário após crash;
retenção/arquivamento explícito de quarentenas; reconciliação durável SQLite/schema/
chaves/mídia/edição/cursor/as-run no principal; retorno/rejoin; testes de concorrência,
cancelamento/limite de rede/bytes/offset/token/crash/TOCTOU, homologação entre hosts,
build e publicação. Fixtures adicionadas: NOT_RUN.
