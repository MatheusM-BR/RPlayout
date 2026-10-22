# Reconciliação de histórico — append explícito NOT_RUN

Implementação em lote, fonte/worker/banco operacional/API/página integrados.
Não executada/compilada/homologada, fora do pacote R55. Não conclui toda a
reconciliação e não autoriza retorno ao ar.

Revisão técnica agora sinaliza elegibilidade de registros RECEIVED_ONLY: novos,
encerrados, NATIVE e ENGINE_POSITION, com datas/cadência/posições válidas. Página
permite seleção explícita de IDs/hashes, até 1000 identificados nos detalhes.
Detalhes truncados não autorizam importar registros não identificados; nova revisão
após cada lote expõe os restantes. Intenção é salva antes de POST; consulta não
repete importação. Local corrompido não é sobrescrito.

HaReturnStore exige revisão completa/schema atual, recebimento próprio da mesma
instância e ID/hash RECEIVED_ONLY. Relê SHA do recebimento e derivada privada;
worker readonly extrai somente IDs selecionados com hash de TODOS os campos.
Confere bytes novamente antes da transação. Arquivo recebido nunca é aberto por
SQLite; derivada pode ter sidecars isolados. Auxiliar é o mesmo 12º bundle de revisão.

Banco operacional usa INSERT-only: ID já existente em qualquer canal, linha alterada,
schema/colunas diferentes, duração estimada, registro aberto ou simulado recusam
TODO o lote. Não fecha/atualiza/apaga histórico existente. Autorizações/sessão
reconferidas e registros mais auditoria HA_HISTORY_IMPORT cifrada são gravados
na MESMA transação. Receipt preserva IDs/hash/revisão/transferência/ator/horário.
UUID já confirmado somente consulta mesma intenção; resposta perdida pode ser
recuperada do próprio diário operacional após reinício, sem reimportar.

Histórico importado preserva evidência original, não é homologação física.
Auditoria entra no snapshot HA. Canal arquivado pode receber histórico revisto
sem reativação. Callback de commit real ligado em App; sem banco operacional
próprio/adapter, caminho recusa, sem simulador ou confirmação do cliente.

historyFullyReconciled/primaryApproved/publicationAuthorized/authorityTransferred
continuam false. Registros CHANGED/PRIMARY_ONLY/abertos, comandos incertos e
apuração de diferenças exigem outro fluxo explícito; nenhum overwrite automático.
Importação não cria edição/mídia, não resolve chaves, não seleciona cursor/PGM.

Faltam política/revisão durável de conflitos existentes e registros sem evidência,
campos protegidos/chaves, publicação/mídia/cursor, geração perdida, retenção,
retorno/rejoin, testes reais de transação/crash/idempotência/conflito/cancelamento/
bytes/permissões, homologação, build e publicação. Fixtures de contrato: NOT_RUN.
