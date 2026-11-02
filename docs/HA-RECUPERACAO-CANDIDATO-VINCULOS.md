# Recuperação de candidato e aplicação de vínculos interrompidos

11/10 — fonte implementada, NOT_RUN. Sem testes/build; fora R55.

O contrato de encerramento/listagem agora cobre quatro tipos:
CANDIDATE (ACCEPTED/MATERIALIZING), BINDING_APPLICATION (ACCEPTED/APPLYING),
MEDIA_REVIEW (ACCEPTED/CHECKING) e MEDIA_APPLICATION (ACCEPTED/APPLYING).
Contrato anterior continua válido; fase de outro tipo é recusada.

Novos tipos conectados ao Store, transação/diário de recuperação, API,
listagem paginada por canal, seletor de etapa e consulta fresca da página.
Os painéis de candidato e de vínculos também oferecem encerramento explícito
quando o pedido consultado não tem confirmação final.

O encerramento valida fase/data exatas e ausência comprovada de trabalho/
processo, preservando request, owner, quota e parciais. Não converte STAGED
em falha, não adota confirmação estrangeira, não retoma worker e não libera
saídas. Mudança de alvo impede confirmação; histórico permanece criptografado.

As restrições de unicidade anteriores permanecem: um candidato por seleção,
uma aplicação por candidato/plano de vínculos. Encerrar não remove esses
registros. Uma nova tentativa exige nova preparação/decisão explícita, nunca
substituir UUID, reaproveitar parcial ou liberar quota por suposição.

Fixtures NOT_RUN adicionadas para fases cruzadas, alteração de estado/data,
callback de processo ainda ativo, preservação de owner/request/quota e IDs
corretos na listagem de cada etapa. Não houve execução nem homologação.

Restam recuperação das revisões/reproteção e outras etapas, resolução
explícita de intenções não registradas, qualificação/QC/contingência/grafismos,
retomada efetiva com engine/autoridade e homologação física entre nós.
Este lote não comprova recuperação operacional completa.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.
