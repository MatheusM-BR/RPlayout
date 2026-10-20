# Assinaturas estrangeiras no retorno HA — NOT_RUN

Implementação em lote, sem executar testes, typecheck, build ou homologação.
Mudanças fora R55. Não conclui os grupos 8.5/8.6.

Correção do diagnóstico anterior: channel_checkpoints.payload é JSON simples,
não ciphertext de um cofre especial. Journals gráficos/secundários/ocorrências HA
em operator_decisions.payload usam o contexto protegido padrão e já fazem parte
da ponte de protectedColumns. Ainda exigem revisão semântica; decifrar não comprova
que comandos executaram, nem autoriza replay.

Os registros de execução e distribuição, instâncias do servidor, admissão de
armazenamento, recibos de restauração e ativações restauradas têm assinaturas
vinculadas ao cofre da instalação. Recifrar protectedColumns não torna essas
assinaturas válidas no principal. Reassiná-las como locais seria incorreto: poderia
converter posse/processos/manutenção estrangeiros em autorização local.

## Implementado em fonte

Na transação da NOVA derivada exportada, inventaria as linhas originais ordenadas,
incluindo assinaturas, slots e vínculos com as-run. Verificadores existentes da
origem conferem assinaturas/schema/cercas/referências antes de produzir atestado.
Contagens, SHA de inventário e fingerprint não secreto da origem vão no selo e
em envelope autenticado pelo pareamento/exportId na tabela privada
ha_foreign_execution_evidence. Nenhuma chave de instalação é enviada.

Na transação da NOVA derivada reprotegida, confirma envelope/selo/exportId e
recalcula inventários das mesmas linhas. Reprotege somente o atestado para o cofre
do principal. Assinaturas/payloads/slots originais permanecem intactos, inclusive
recibos imutáveis. Resultado informa authorityTransferred=false e atestado local
localExecutionAuthorized=false. Worker/parent confirmam a mesma evidência; API e
página mostram que é histórico estrangeiro, não licença para abrir engine.

Inventários limitados por linhas e bytes; excesso não é truncado como válido.
Legado sem atestado permanece explicitamente sem essa confirmação. Tabela presente
sem prova no selo é recusada. Derivada com evidência estrangeira não pode voltar
a ser exportada como se fosse execução local. Validadores operacionais não foram
alterados para aceitar assinatura estrangeira ou ignorar cercas.

## Ainda falta

Conteúdo das tabelas restored_origin_* e contextos não registrados não são
atestado de operação; cobertura nominal não equivale a validação universal.
Faltam revisão da derivada reprotegida, reconciliação semântica de checkpoints,
edição/mídia/cursor/comandos, decisão explícita sobre registros abertos/incertos,
retenção/geração perdida, novo protocolo de autoridade local e retorno/rejoin.
Também faltam verificações posteriores de transação/adulteração/chaves/limites/
crash/cancelamento, integração e hardware real. Fixtures novas: NOT_RUN.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações de fechamento
(5 concluídas/36 em andamento/12 pendentes). Não incrementar conclusão por código
novo sem validação.
