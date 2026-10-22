# Encerramento explícito de pedidos interrompidos

11/10/2026 — servidor implementado em fonte, NOT_RUN. Sem testes/build,
fora R55. Não encerra 8.5/8.6 nem comprova recuperação completa do canal.

API /api/ha/returns/job-recovery: POST registra encerramento, GET consulta
o mesmo recoveryId/canal sem replay. Requer admin/canal, permissão de
transporte, identidade estável e auditoria do canal. Body estrito: recoveryId,
kind MEDIA_REVIEW ou MEDIA_APPLICATION, targetId, channelId, expectedPhase,
expectedUpdatedAt e justificativa. Sem path/force/valores de mídia.

Só encerra ACCEPTED/CHECKING da revisão ou ACCEPTED/APPLYING da cópia sem
resultado confirmado, com fase/data exatamente iguais. REVIEWED/STAGED nunca
são convertidos em falha. Pedidos ativos são recusados pelo contador de
trabalho do Store. Para owner anterior, somente host local e probe do PID com
ESRCH comprovam ausência; EPERM, PID vivo/reutilizado, host remoto ou owner
inválido recusam. Não se deduz encerramento por timeout, intenção ou lock.

Em transação imediata, o alvo passa a FAILED e o diário criptografado imutável
registra ator/justificativa/pedido. Falha no diário reverte alteração do alvo.
Consulta preserva confirmação histórica e não autoriza PGM. UUID reutilizado
com intenção diferente é recusado; consulta idêntica não reaplica alteração.

Arquivos parciais, originais, resultados e quota original permanecem. Não há
delete, cancelamento de processo, reaproveitamento de base parcial, retomada
automática, transferência de owner ou liberação de saída. Diário adicional
reserva 64 KiB por recuperação, com limite de 1024 registros.

Encerrar a revisão remove seu estado ativo do bloqueio de novas análises; não
adota automaticamente aplicação/recibos estrangeiros de execução anterior.
Nova preparação deve cumprir os mesmos contratos de ownership/evidência.
Uma tentativa de cópia continua única por revisão: criar outra requer nova
revisão explícita, nunca substituir o parcial ou repetir UUID.

Pendentes neste fluxo: UI com intenção persistida/consulta antes do POST,
descoberta/listagem de pedidos interrompidos, recuperação das outras fases de
retorno e tratamento explícito de pedido AUTO não registrado. Também falta a
recuperação operacional com engine/autoridade/sinal e homologação entre nós.

Fixtures NOT_RUN: PID/host/EPERM, contrato estrito, transação/reversão,
imutabilidade, consulta sem replay e quota preservada. Sem execução física.

Totais: 10 grupos (1 concluído/9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes).
