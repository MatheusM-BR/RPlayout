# Recuperação da revisão técnica e reproteção

11/10 — implementado em fonte, NOT_RUN. Sem testes/build; fora R55.

Encerramento/listagem agora cobrem seis etapas: DATABASE_REVIEW (revisão
técnica do SQLite), REKEY (reproteção), CANDIDATE, BINDING_APPLICATION,
MEDIA_REVIEW e MEDIA_APPLICATION. Estados ativos específicos daquelas duas
novas etapas são REVIEWING e REKEYING, além de ACCEPTED. Estados confirmados
REVIEWED/REKEYED_STAGED jamais são convertidos em falha.

Store, contratos estritos, API de listagem/encerramento, seletor paginado e
painéis próprios conectados. Antes de enviar, a página consulta o endpoint
correto e valida ID/canal/fase/data/resultados. A intenção continua guardada
antes do POST; erros permitem consulta do mesmo UUID, não replay.

Reproteção já possuía owner privado. Novas revisões técnicas também registram
owner no diário criptografado; a consulta pública remove owner e expõe somente
ownedHere/ownerRecorded e flags históricas. Não publica hostname/PID/boot.
Históricos antigos sem owner permanecem legíveis, mas ownerRecorded=false:
UI desabilita encerramento e servidor recusa. Não inferir owner do recebimento
nem fabricar comprovação do fim do processo.

As alterações para FAILED preservam request/owner/baseline/quota e ocorrem na
mesma transação imediata do diário imutável de recuperação. Aplicam os mesmos
gates: sem trabalho ativo, fase/data exatas, ausência comprovada do PID local
anterior. Parciais/credenciais/cópias originais não são apagados, reabertos,
reprotegidos novamente, adotados ou ativados por esta ação.

Reproteção continua única por transferência; encerrar não relaxa unicidade.
Nova preparação deve manter consentimento, ponte autenticada e versões próprias.
Revisão técnica não se torna aprovação operacional por encerrar tentativa.

Fixtures NOT_RUN acrescentadas para fases cruzadas/confirmadas, IDs por etapa
e owner histórico ausente na listagem. Não comprovam funcionamento físico.
Restam tratamento das intenções não registradas, etapas de histórico/variantes
e outros jobs, qualificação de áudio/QC/contingência/grafismos e retomada real
com engine/autoridade/sinal, homologação entre nós e pacote atualizado.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.
