# Backup HELD — lacuna de admissão local

Atualização13/10:integração fonte implementada e ensaio completo PASS em
scratch/restored-held-activation-69Hm8Y/result.json. Backup capturado por
worker próprio em HELD; sourceNode/engine encerrados observados antes de
restaurar a cópia. activateRestoredApp confirmou cursor8/corte25..400/SHA/
executionId,liberou saídas em modo pausado e arquivou origem após admissão.
SaídaNull,não publicação física. Ainda faltam falhas/crash/multicanal parcial,
build/instalador e homologação externa. O diagnóstico original abaixo explica
a integração,mas suas afirmações de ausência de implementação foram superadas.

Inspeção13/10: reviewRestoredExecution recusa checkpoint programHold antes
de alocar backend; activateRestoredApp também recusa cursor real pausado.
ChannelRuntime não passa holdProgramOutputs ao EngineTransport. Assim,
remover somente essas recusas não cria preparação de saídas retidas.

releaseProgramOutputs(authorize,true) tem contrato de quadro pausado,
cursor/corte/decoder e recibo nativo. Porém exige fenceBinding owner/term,
gerado atualmente apenas quando há fenceLease. O runtime local restaurado
sem authority não fornece essa concessão. HA usa caminho separado; grupo8
está adiado e não deve ser ativado para contornar esta falta.

Integração necessária, ainda não implementada:

1. Admissão local nativa vinculada à posse real de host/distribuição/canal,
   processo e geração; nunca fabricar concessão só para obter ACK.
2. ChannelRuntime de restauração inicia com saídas retidas; prontidão é
   preparação, não autorização de publicação.
3. Recuperar HELD exato via restoreProgramHold, sem TAKE/desmutar áudio,
   e registrar as-run/checkpoint/posse atomicamente.
4. Liberar saídas em modo pausado somente com confirmação do mesmo cursor,
   corte, decoder e concessão local ainda válida. Preview permanece separado.
5. Falhas antes/depois do recibo preservam quarentena/incerteza e origem;
   não anunciar rollback de uma publicação já confirmada.
6. Ensaiar backup real/copiar/restaurar/ativar pausado, perda de concessão,
   crash em cada fronteira e encerramento observado de todos os processos.

Os testes de recuperação HELD local já existentes não comprovam ativação de
uma cópia de backup nem liberação das suas saídas. Não retirar os guards até
esses contratos e ensaios existirem. Sem nova execução HA/engine neste exame.
