# Comparação de edição e cursor no retorno — NOT_RUN

Implementação em lote, sem executar testes/typecheck/build/browser/hardware.
Fora R55; não fecha 8.5/8.6 nem autoriza adotar a cópia.

Revisão da derivada reprotegida agora inclui comparação do payload publicado
com a fotografia atual do principal. Antes a análise distinguia apenas IDs:
mesmo ID com conteúdo diferente podia não aparecer como divergência de edição.
Agora percorre payloads decifrados, confere identidade da grade/canal e unicidade/
vínculo dos itens, compara conteúdo JSON canônico (inclusive campos extras) e
registra quantidades iguais/alteradas/exclusivas e detalhes limitados a 1.000.
Inventário cobre o conjunto completo; excesso de limites recusa, não aprova truncado.

Comparações usam HMAC no cofre LOCAL, não SHA público de segredos decifrados.
Não retorna payloads, caminhos, credenciais ou URLs. Label de campos alterados
vem de lista conhecida; payload alterado em campo extra ainda conta como diferente.
Limites de profundidade 40, 100 mil edições/itens, 8 MiB por representação e
128 MiB de orçamento acumulado. É diagnóstico estrutural/comparativo, não validação
completa de todos os codecs, QC, grafismos, timing ou políticas de execução.

Checkpoint recebido é JSON e é validado pelo parser existente. Fotografia do
principal contém envelope {value,savedAt}; compara value, não o envelope com
JSON bruto. Ordem de chaves e savedAt não produzem falsa diferença. Conteúdo
completo, inclusive proveniência estrangeira, não é descartado na comparação.
Confere existência da edição e pertencimento à grade e presença do item nela.
Referências incompatíveis geram CHECKPOINT_REFERENCE_INVALID; nenhuma referência
é automaticamente corrigida, cursor selecionado ou comando repetido.

Relatório de conteúdo fica dentro de protectedFields.contentComparison.
Página mostra contagens e igualdade/referências do cursor. Os bloqueios de edição/
mídia/cursor/comandos/autoridade permanecem; equality não significa prontidão.
payloadsApproved/contentApproved/publicationAuthorized/authorityTransferred=false.
Leitura de todas as revisões do recebido versus subconjunto relevante do snapshot
principal pode mostrar histórico exclusivo sem que seja conflito editorial atual:
operador/plano ainda precisam decidir o que compõe a edição de retorno.

Faltam seleção e plano revisados, reconciliação dos registros abertos/incertos,
mídia local/QC/mixes/trims/grafismos/eventos, autoridade nativa e retorno/rejoin.
Fixtures de igualdade, mudança sob mesmo ID e item ausente preparadas NOT_RUN.
Consolidar validação após o lote, sem repetir provas por mudança de status.

10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em andamento/
12 pendentes). Código novo não incrementa totais de fechamento.
