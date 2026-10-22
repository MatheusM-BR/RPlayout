# Revisão da derivada reprotegida — NOT_RUN

Implementação em lote, sem testes/typecheck/build/browser/hardware nesta etapa.
Mudanças fora R55. Não conclui 8.5/8.6 nem autoriza instalação/PGM.

POST /api/ha/returns/review admite rekeyId opcional, além de reviewId, transferId
e channelId. Sem rekeyId mantém análise original. Com rekeyId exige recebimento
completo e derivada REKEYED_STAGED próprios do backend atual, mesmo canal/transfer.
Nenhum caminho ou chave pode ser fornecido pelo navegador. Repetir UUID consulta
a mesma intenção; mudar origem sob UUID existente é recusado.

Quota registrada antes do trabalho reserva tamanho da fonte selecionada mais
64 MiB; falhas e cópias anteriores seguem reservadas. Diários antigos sem quota
explícita mantêm contabilização anterior, não ganham espaço por suposição.

Cria NOVA inspection.db privada para SQLite readonly. Recebido, rekeyed.db e
banco ativo não são abertos pelo worker em escrita. Fonte deve ser local, regular,
um único link, sem junção/WAL/SHM/journal pendente. SHA/tamanho da derivada confirmada
orientam a cópia e releituras antes/depois; não comparar erroneamente contra SHA
bruto do recebimento. Recebimento original e intenção de reproteção reconferidos.

Worker exige inspection.db em diretório privado UUID. Confere cofre efetivamente
usado e legibilidade de todos os campos não nulos em protectedColumns, com limites
100 mil campos/128 MiB e 8 MiB por campo. Plaintext não sai do worker. Resultado
encodingValidated=true NÃO significa contentApproved: este permanece false.

Evidência estrangeira reprotegida é decifrada pelo cofre local e comparada ao
atestado/recibo/exportId e aos inventários assinados originais. Não executa
validadores locais contra assinaturas estrangeiras como se fossem autorização;
não reassina payloads ou apaga cercas/slots/histórico. localExecutionAuthorized e
authorityTransferred continuam false. Parent exige contagem/fingerprint/provas
correspondentes antes de registrar relatório.

Relatório identifica sourceKind, rekeyId, SHA analisado e SHA do recebimento.
UI tem intenções separadas por recebimento/rekeyId, consulta sem retry e botão
específico dentro da reproteção confirmada. Revisões reprotegidas não habilitam
append/variantes de histórico: essas ações continuam exigindo revisão original.
Guard no servidor também recusa usar nova revisão como autorização de importação.

Colisão encontrada no cliente entre consulta do plano de retorno e criação de
revisão SQLite corrigida: haReturnPlanReview e haReturnReview são chamadas distintas.

Faltam validação semântica de conteúdo/edição/mídia/cursor/comandos/abertos,
origens restauradas/contextos adicionais, retenção e recuperação de geração,
concessão explícita de autoridade e operação completa de retorno/rejoin. Fixtures
de contrato/legibilidade/adulteração preparadas, não executadas. Não declarar
revisão operacional completa pela simples leitura de envelopes.

10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em andamento/
12 pendentes). Totais de fechamento não aumentam sem validação.
