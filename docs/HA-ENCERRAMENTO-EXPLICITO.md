# Encerramento explícito da reserva — NOT_RUN

Conferir encerramento é read-only. O operador/admin autorizado no canal precisa
marcar confirmação de interrupção e enviar intenção com UUID/token. Isso encerra
somente os handles próprios rastreados, não adota PID informado nem busca/derruba
outro processo. Não compete com promoção/CUE/TAKE/monitor ainda em execução.

Diário cifrado registra ACCEPTED/STOPPING/CONFIRMED/UNCERTAIN. UUID duplicado apenas
consulta. A partir do registro, novos controles/monitor da execução são recusados.
UI salva intenção antes do envio; erro/reload não repetem encerramento. Consultas
GET não emitem comandos. Token exige mesma execução/geração/conferência atual.

Só confirmar após adapter (engine+mídia), decoder cercado e warmup confirmarem
parada, backend próprio drenar e reserva de storage ser liberada. Timeout,
handle perdido, falha de accounting ou cleanup/liberação inconclusiva preservam
UNCERTAIN e reservas. Nunca confirmar uma transferência/CUE/TAKE antigo porque
os recursos foram encerrados; diário original permanece intacto.

Não exige concessão de publicação renovável para parar processos próprios que
já perderam sinal: exige posse local, host e autoridade do operador para cleanup.
Isso não retorna autoridade ao principal, não inicia outra geração, não apaga
histórico/arquivos nem habilita promoção nova implicitamente. Falta workflow
para handles perdidos após restart, revisão de parada incerta/liberação offline,
devolução de autoridade, replicação reversa/rejoin e retomada.

Engine/diário/API/painel integrados em fonte. Fixtures NOT_RUN; nenhum processo
real encerrado, teste, build ou homologação executados neste lote.
