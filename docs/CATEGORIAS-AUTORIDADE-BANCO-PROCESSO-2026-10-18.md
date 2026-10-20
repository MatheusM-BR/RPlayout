# 6.1 /7.2 — Categoria real, autoridade fresca e banco PROCESS

## Falha real corrigida

A rota de conferência de categoria estava explicitamente na lista de leituras
compartilhadas como `/api/categories/:id/review`, e o domínio devolve canEdit=false
para conta limitada a canais. Porém, o filtro comparava a lista apenas com a
URL concreta; a entrada parametrizada nunca casava. O usuário recebia403 antes
da conferência, embora o editor já previsse consulta sem edição.

`apps/server/src/routes.ts` agora também confere o identificador de rota
registrada. A exceção continua limitada a GET/HEAD, ausência de canal resolvido
e entrada EXPLÍCITA na lista. Verificações de identidade/canal ocorrem antes;
PUT/DELETE globais de conta restrita continuam recusados. Não há permissão por
prefixo genérico, fallback anônimo ou liberação de recursos globais do host.

O CategoryEditor já desabilita salvar/remover com canEdit=false e informa que
a conta só pode conferir; não foi necessário mudar/recompilar frontend neste lote.
Isso é inspeção do código, não homologação visual/interativa.

## Rodada com domínio/rotas/ORM reais e PROCESS

`verify-storage-category-routes.mts` PASS,7,86s/código0,Wc3h3s. Duas instâncias
de App no MESMO processo Node, cada uma com serviçoSQLite compilado distinto,
sessões de dois usuáriosQA e banco/cofre novos. Chamadas por Fastify.inject
executam hooks/autoridade/rotas/domínio/Drizzle reais, sem listener de rede.
Não são HTTP/WS, backends instalados independentes ou dois computadores.
Não se usou esse caminho para declarar aprovados os ensaios HTTP negados.

Cobertura da rodada:

1. Conferência original privada/no-store/ETag sem gravação; sem If-Match428.
2. Dois usuários enviam a mesma revisão: respostas200/409, uma alteração e um
   CATEGORY_COLOR_CHANGED real, com ator vencedor correto.
3. Limitar usuárioB a canais produz conferência canEdit=false e recusa403 da
   alteração global, sem mudar categoria/revisão/auditoria de categoria.
4. Revogar a sessãoA faz a próxima leitura e gravação serem recusadas401.
5. Falha deliberada no INSERT da auditoriaCATEGORY_REMOVED reverte remoção,
   vínculo e revisão; não sobra auditoria de sucesso. Removida a falha QA, a
   mesma conferência continua válida e remoção real grava uma única decisão.
6. Arquivo de catálogo original, declaradamente NÃO reproduzível, preservado
   por hash; vínculo de categoria é liberado, sem apagar mídia nem executar TAKE.
7. Nova App após fechar as duas anteriores conserva revisão e categoria removida.
   É reconstrução da aplicação no mesmo pai, NÃO restart do backend/Node.

As sessões foram fixtures de autenticação válidas na tabela (digest de token),
não login por senha nem contas de operadores reais. Política/sessão foram
reconsultadas pelos componentes de produção; nenhuma autoridade foi mockada.
O código de teste muda só dados do seu próprio banco para injetar revogação/
restrição/falha. Não edita logs históricos, registros de posse ou checkpoints.

## Falha anterior preservada

`scratch/storage-category-routes-REsXT2/result.json` FAIL: disputa de revisão
passou, mas GET de conferência do usuário restrito retornou403. Diagnóstico do
filtro e do contrato do domínio comprovou a divergência de produto acima.
Corrigiu-se o produto, não a expectativa para aceitar o bloqueio indevido.
Os dois serviços próprios encerraram sem erros. Não reclassificar esse FAIL.

## Regressão e compilações

66 testes/6arquivos PASS, sessão33880/código0: category-edit10,
category-edit-routes3, scoped-edit-review13, access20, permissions18 e métricas
operacionais2. Regressão nova cobre GET/HEAD privado sem vazamento dos marcadores
de caminho/hash/título, PUT/DELETE403, host global403, rundown de canal negado403,
anônimo401, revisão/vínculos/auditoria de categoria intactos. Não são66 requisitos
novos. Tipos completos do servidor PASS10091; tipos dos dois roteiros tambémPASS.

Build do servidor PASS em NOVO destino `scratch/host-history-r88-category-20261018`:
SHA256server.cjs `3bbac965f4d6b90e7f90854281073430e0934a28babded33925930f93e7b431d`.
É o servidor atual para a futura r88; o6A94FA68 anterior permanece preservado.
Dist convencional, ZIPs/instalações r87 e frontend isolado E15DBFFB não alterados.
Os helpersSQLite continuam byte a byte a7be733d/9eb4d10d; não se repetiram por
status os testes anteriores de timeout, crash pós-commit, backup ou CAS de fixture.

O caso de seleção dos builds agora aponta para esta pasta/hash novos; permanece
NOT_VALIDATED sob a recusa de scriptPS5 já observada. Alterar a expectativa de
origem não é aprovação do empacotador nem geração do instalador.

## Conferência independente

`verify-storage-category-evidence.mts` PASS,1,44s/código0. Leitura do banco/cofre
existentes: integridade/FKs, duas decisões de categoria descriptografadas, revisão
final, vínculo removido, sessãoA revogada, usuárioB ainda com sessão e arquivo
de catálogo preservado. Auditoria de requisição contém as sete tentativas de
mutação esperadas: PUT428/200/409/403/401 e DELETE409/200. Três registros de
instância têm assinatura válida e phase=STORAGE_CLOSED, todos do mesmo pai.
Isso NÃO declara parada nativa de engine nem promoção de canal.

Três processosSQLite próprios permaneceram ausentes, sem sinais por PID; arquivo
principal não mudou durante a leitura. Relatório em
`scratch/storage-category-routes-Wc3h3s/assertions-storage-category.json`.
Não reproduz requisições, muda sessão, concede acesso, reconstrói a ordem de
agendamento ou converte a auditoria de rota em prova de tráfego HTTP.

## Ainda falta

6.1: demais mutadores/fluxos e aprovação visual/operacional integrada.
7.2: backends independentes, concorrência/autoridade nos demais mutadores e
conflitos com PGM. O caso de categorias está qualificado nesse escopo interno,
não todos os contratos multiusuário da aplicação. 7.1/7.3/7.4 mantêm pacote,
impacto de falhas/espera síncrona, PGM/as-run, carga e migração pendentes.

9.1 HTTP/browser,9.3 HELD,seleçãoPS5 e engine atualizado/instalador r88 continuam
aguardando suas provas/permissões. R88 NOT_BUILT, r87 preservada. Nada escrito
emD:, nenhuma política alterada, sem cleanup/movimentação/publicação. DeckLink
física adiada, grupo8v3 e homologações externas/licenças mantidas.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
