# Monitor da execução promovida — lote NOT_RUN

PVW/MON podem ser ligados/desligados somente no transporte nativo rastreado da
promoção confirmada. Não criam runtime, não fazem CUE/TAKE e não alteram PGM.
HTTP exige administrador autorizado no canal, identidade estável e auditoria.
A origem arquivada não é reativada: o alvo é a cópia já admitida, não o runtime
normal do servidor. A configuração de reserva continua bloqueando outros comandos.

Cada intenção recebe UUID e diário cifrado ACCEPTED → SENDING → CONFIRMED,
REFUSED ou UNCERTAIN. A operação confirma concessão assinada, posse da cópia,
prova de host, mesma geração e ACK nativo. Mesmo UUID nunca reenvia. Comando
pendente/incerto bloqueia nova intenção no mesmo canal/bus. Confirmação é histórica,
não medição de vídeo, funcionamento do browser ou entrega física.

O navegador guarda o pedido em sessionStorage antes do envio. Resposta perdida
fica UNKNOWN; consultar usa GET e jamais dispara um novo comando. Reload preserva
pedido na mesma sessão; corrupção ou armazenamento indisponível bloqueiam envio.
Não há revisão automática de incerteza nem presunção de que ausência de registro
signifique que o comando não aconteceu.

## Revisão explícita — NOT_RUN

Após consultar, o operador autorizado pode escolher **Redefinir ligado** ou
**Redefinir desligado**. Isso cria novo UUID e um comando de estado do monitor,
com referência ao pedido incerto e token assinado da conferência atual. O servidor
recusa token antigo, cadeia de outro canal/bus/promoção, pedido ainda executando
neste processo ou qualquer outra pendência não abrangida pela revisão.

Somente ACK nativo com concessão/geração novamente verificadas produz CONFIRMED
no novo pedido. O antigo permanece ACCEPTED/SENDING/UNCERTAIN no diário; consulta
apresenta `resolvedBy` sem confirmar sua entrega antiga. Nova falha incerta também
permanece bloqueada e pode ser objeto de revisão explícita seguinte, abrangendo a
cadeia. REFUSED não resolve ancestrais. Consultas, reload e reconhecimento visual
nunca reenviam o comando. Histórico não habilita nova geração após reinício.

Esta revisão é restrita a PVW/MON, comandos de definição de estado. Não autoriza
reexecutar TAKE, SCTE, eventos secundários ou transferências HA incertas. Essas
reconciliações exigem seus próprios contratos de execução e continuam pendentes.

Sem testes, build ou homologação neste lote. Adaptador de promoção ainda não está
habilitado por padrão; esta integração não anuncia HA completa em produção.
