# Decisão e preservação de variantes de histórico — NOT_RUN

Fonte/worker/banco operacional/API/página integrados, sem testes ou build.
Fora de R55. Complementa append de registros novos, NÃO conclui reconciliação
operacional ou comprova execução física.

Revisão identifica CHANGED e PRIMARY_ONLY. Operador seleciona até 100 IDs,
ambos os hashes e justificativa. Política implementada: KEEP_PRIMARY_WITH_VARIANT.
Preserva o as-run do principal e arquiva ambas as versões no diário cifrado,
ou registra a ausência da versão recebida. Não duplica registros de faturamento.
Não há overwrite, fechamento artificial ou confirmação de comando perdido.

HaReturnStore confere revisão/schema atuais, recebimento completo próprio,
SHA de origem/derivada antes/depois, hashes de cada conflito e extração readonly
em worker. Null recebido exige ID realmente ausente. Commit confere novamente
hash atual do principal na transação; alteração concorrente recusa TODO o lote.
Variantes/justificativas/receipt/ator/horário gravados atomicamente em
HA_HISTORY_VARIANT_REVIEW. Limite durável 1 MiB; excedente recusa sem truncar.

UUID confirmado consulta mesma intenção; resposta perdida consulta diário.
UI salva intenção antes de POST e preserva corrupção/falha. Consulta administrativa
por canal retorna receipt, NÃO variantes privadas. Diários entram no snapshot HA.
Canal arquivado pode receber decisão histórica sem reativar o canal.

asRunModified/nativeUncertaintyResolved/historyFullyReconciled/publicationAuthorized/
authorityTransferred permanecem false. Uma decisão de política não altera verdade
nativa; registros abertos/incertos continuam visíveis como tais. Nenhuma concessão,
cursor, mídia ou publicação muda. Geração perdida não adota cópia para novas decisões.

Faltam adoção/revisão durável de verdade operacional para conflitos/abertos sem
inventar evidência, campos protegidos/chaves, edição/mídia/cursor/comandos,
retenção/geração perdida, retorno/rejoin, testes de transação/concorrência/crash/
permissões/bytes/idempotência/limites, homologação, build e publicação.
