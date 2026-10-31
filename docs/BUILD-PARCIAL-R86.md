# RPlayout r86 — parcial instalável interna

## Resultado posterior à geração (ZIP original preservado)

540525930bytes/SHA256
21FFBA9B3929C039D94945E978F4ED716BD19BE3F987D69BEB11DE04EF91150C.
Instalação integral no D: PASS (7.100 arquivos, recibo VERIFIED, perfil isolado,
sete destinos de atalhos). Ensaio6NN6PM preparou/exportou histórico completo,
mas destino r83 recusou checkpoint: FAIL preservado, sem PGM/saídas liberadas.
Conferência independente da recusa segura PASS, não do retorno. Detalhes em
RETORNO-COMPATIVEL-R86-2026-10-16.md; correção de retenção da prova de parada na
r87. Não alterar nem recomendar este ZIP como retorno homologado.

## Registro pré-geração

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r86-instalador.zip`.

Inclui retorno compatível usando o snapshot completo mais recente, comparação
do histórico anterior, contrato exato de schema, manifesto integral e ferramentas
da edição de destino. Preparação em pasta nova/quarentena não inicia canal nem
troca perfil. Ativação explícita mantém os gates nativos da edição de destino.
Não mistura bancos nem descarta histórico, colunas ou marcadores de migração.

Corrige a exportação de NOVOS backups: a cópia criada por esta operação é
finalizada como SQLite autocontido antes de publicar seu resultado. O banco de
origem mantém seu modo de journal; seus WAL/SHM não são apagados. Para arquivos
históricos em WAL, `prepare-rplayout-rollback.ps1 -ExportSnapshots` permite
exportar explicitamente novas cópias consistentes, preservando os originais e
seus auxiliares. Sem essa opção, entradas com WAL/SHM continuam recusadas.

31 casos distintos de domínio/integridade/backup PASS; quatro casos de bootstrap
PowerShell e dois de manifesto Unicode PASS. Tipos/build serão conferidos antes
da geração. Engine610E03E8, launcher101A28C9 e interface8B0D3FCB inalterados;
servidor recompilado pela correção de backup. R84/R85 e seus FAILs preservados:
Unicode no manifesto r84 e snapshot com auxiliares r85, antes de ativar destino.

Registro pré-geração: instalação e fluxo deste ZIP NOT_RUN neste README.
Resultados/hash posteriores serão registrados externamente, sem reempacotar
apenas para mudar status. A qualificação prevista usa dados nativos r83 e retorno
à própria r83 através do novo controlador; não prova downgrade de schema nem
operação PGM de uma edição nova seguida de retorno.

Não homologa Windows limpo, energia, hardware, fontes externas ou longa duração.
Redistribuição REVIEW_REQUIRED; acordo original NDI ausente. DeckLink adiada;
grupo8v3. Sem limpeza/movimentação do projeto, alteração de firewall/serviços
operacionais ou publicação pública.

Matriz:10grupos/53verificações;8concluídas/34andamento/4pendentes/7v3.
9.3 e10.4 permanecem abertas para seus cenários restantes.
