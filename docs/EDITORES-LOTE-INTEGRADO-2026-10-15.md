# 6.1 / 6.2 — lote integrado de editores e painel de grafismo

## Implementação

Metadados, impacto de remoção, cadastro de artes, regras de pauta e painel de
grafismo usam consultas GET limitadas a 10 segundos. Desmontagem/troca de
arquivo, canal ou escopo cancela leituras; geração/identidade original impede
resposta antiga de substituir a edição atual. POST/PATCH/DELETE não recebem
AbortSignal nem repetição automática. Histórico de comandos não sobrepõe
consultas. Erro de consulta não significa catálogo/histórico vazio.

Descarte, reabertura, troca de rascunho/escopo e remoção têm confirmação na
página nos cinco componentes. Consentimento pertence ao alvo/revisão/ação;
trocar seleção, ação ou conferência revoga o consentimento anterior. Campos
ficam congelados durante confirmação. Remoção de ativo exige consentimento
próprio, além do reconhecimento de impactos em itens/fallbacks quando houver.
Nenhuma revisão mais recente é buscada para autorizar campos de um draft antigo.

Callbacks de atualização após confirmação de gravação foram separados do
resultado do comando: falha de atualização não simula rollback do commit.
Recibos de artes/faixas/slate precisam confirmar identidade e aplicação.

Integração encontrada durante a conferência: SettingsView recebia onOpenGraphics,
mas não oferecia o acesso na tela atual. Adicionado botão Grafismo & Artes.
AutoFill não pode propor/aplicar uma pauta enquanto a faixa tem rascunho,
conferência bloqueada, consulta em curso ou consentimento pendente. A lista
persistida não passa silenciosamente por uma edição local ainda não gravada.

Pendências de grafismo têm consentimento por comando/estado/token/observação,
não um checkbox global reutilizável. Reconsultar histórico cancela a intenção
local. SHOW/HIDE distinguem ACCEPTED, SENDING, UNCERTAIN, REJECTED, REVIEWED,
CONFIRMED e SIMULATED; um estado não confirmado não é chamado de simulação.
Callbacks tardios não atualizam outro canal. Isso não homologa pixels no ar.

## Software e hashes

234 casos distintos / 17 arquivos cobertos. Lote inicial:232 PASS/1 FAIL;
teste novo esperava POST em removeAssets, mas o contrato correto é DELETE.
Corrigida somente a expectativa; replay do arquivo2 PASS. Acrescentado um
caso de prontidão da pauta: replay dirigido22 PASS (casos sobrepostos não
somados). Tipos web PASS e builds web/servidor/engine release locked PASS.
Avisos preexistentes de bundle grande e Rust deprecated/dead_code preservados.

Web final: index-DRFaiZfx.js, SHA256
B10A5AF6C69EADAF5A990BD0919C7AE712AC5E76DE4232B9FAA2A62BA5AFB3F2.
Servidor:5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607.
Engine:3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.

## QA de navegador — escopos distintos

Todas as instâncias usam servidor/Node instalados r68 intactos com override
WEB explicitamente registrado. Controlador usa tsx local, fixtures e banco
próprio; não é requisito para iniciar o produto. Mídia sintética copiada de
QA anterior, SHA256 ec95a8a728c7e83fb89d841983fe29e4818c52ff3387a441bcb467fe792721a2.
Registro técnico de fixture, QC PENDING; não houve novo probe, aprovação QC,
engine, broker, saída física ou dados/contas operacionais. A habilidade de
navegação ficou restrita a esse QA, sem exclusões ou mudanças de segurança.

### zdTFwK — mídia, faixas e impacto

Web TNzDIusg/857b08e0f61785c16100505feadaa712041334bd922c356a50cc4400109ce85e.
METADATA_REVIEW10002ms, RULES_REVIEW10000ms, REMOVAL_REVIEW10000ms,
GETs abortados sem504. Recuperação explícita exibiu os dados, não lista vazia.
Draft de título foi preservado; trocar fechar→reabrir limpou consentimento.

Uma gravação de título `Vídeo QA revisado Çãó` e uma gravação de nome da faixa
`Faixa QA revisada Çãó`, ambas PATCH200, confirmadas no banco e nas auditorias.
Remoção ficou desabilitada sem consentimento; reabrir impacto pediu nova
autorização. Nenhuma remoção executada. A primeira tentativa de salvar a faixa
encontrou o modal já fechado após interação de manutenção; não foi repetida
gravação incerta. Nova abertura/edição teve um PATCH confirmado, não dois.

Read-only assertions-editors-media.json PASS: asset/hash/QC/ignored preservados,
uma ASSET_METADATA_CHANGED, uma SCHEDULE_RULE_EDITED, API_MUTATION2; scan0,
as-run0, conta mutada0, POST receptor0. Abas próprias fechadas, processo exit0.
Screenshots metadata-timeout, faixas-timeout, faixa-gravada,
remocao-timeout, remocao-sem-autorizacao.

### lmwR7A — ensaio intermediário encerrado pelo prazo

Web final DRFaiZfx. Confirmou acesso pelo botão e prazo de artes10007ms.
Instância terminou automaticamente após30min; handle observado terminalexit0.
Interações posteriores encontraram Failed to fetch porque servidor já havia
encerrado, não por falha nova do produto. Sem mutações do operador. Evidência
preservada; não usada para afirmar que cadastro/histórico foram recuperados.

### i9LzXE — conclusão de artes/histórico e prontidão da pauta

Mesmo web final DRFaiZfx, servidor5F33C58E. Nova instância somente após confirmar
encerramento da anterior. Artes do painel, histórico e cadastro tiveram prazo
recuperável; retiro da falha e reconsulta recuperaram lista/dados sem envio.
Trocar descarte→exclusão mostrou consentimento novo/desmarcado; exclusão não
foi confirmada. Manter edição preservou o rascunho. PATCH200 mudou somente o
nome de qa-art para `Arte QA revisada Çãó`; o painel pai invalidou sua lista
antiga e bloqueou seu uso até reabertura explícita.

Pendência qa-command é fixture sintética UNCERTAIN (duas linhas sem envio de
engine, ator fixture-only). A tela selecionou esse comando, manteve o botão
de encerramento bloqueado sem consentimento e reconsulta descartou a intenção
local. Não foi declarado ter conferido engine/imagem inexistentes; nenhum
encerramento de pendência ou SHOW/HIDE foi executado.

AutoFill aberto no Master: rascunho `Rascunho local não salvo` deixou Conferir
o Dia Inteiro e Aplicar Dia Conferido desabilitados. Nenhuma proposta ou
publicação enviada. Assertions-editors-graphics.json PASS: PATCHarte1,
hash/QC/ignored preservados, scan/as-run/conta/POSTreceptor0, nenhuma exclusão.
Aba fechada e processo próprio observado exit0. Screenshots
artes-historico-timeout, arte-consentimento-limpo,
arte-gravada-painel-bloqueado e autofill-rascunho-bloqueado.

## Limites e próximo passo

Não qualifica instalação r70, Windows limpo, cliente remoto, fontes físicas,
renderização nativa das artes, slate no ar ou recuperação de incidente real.
Capturas em viewport limitado não homologam todo o layout responsivo.
Gravações que removem dados pela interface e mudanças de segurança continuam
dependentes da autorização adequada; não foram automatizadas neste lote.
Matrizes de revisão concorrente/backend estão nos testes, não em nova corrida
entre operadores de navegador. Não fechar6.1/6.2 só por esses ensaios.

Scanner e este lote consolidados na r70 parcial:540192664bytes, SHA256
4C4D638DD387245BCF67BF453AA789396D7D312CEF4A8DE259F87A1A5AA2F985;
7094hashes/7095entradas PASS. Instalação/startup r70 NOT_RUN.
Qualificação instalada, cenários restantes
dos grupos, fontes externas/licenças/publicação continuam abertos. A r69 não
foi modificada. Grupo8 continua v3. Sem limpeza/migração.
Totais10grupos/53verificações:6 concluídas/36 em andamento/4 pendentes/7 v3.
