# Grupo4 — compensação guiada por segundos/minutos

## Auditoria da alteração de âncora

OPERATIONAL_COMPENSATION agora persiste anchorChange da conferência junto
com revisão/durações/conflitos na mesma transação imediata. SOFT registra
alvo original/resolvido; WINDOW registra os dois limites e mantém largura.
Não reconstrói horários antigos nem altera decisões já gravadas, que podem
não ter esse campo. As versões originais continuam preservadas.
20 testes afetados PASS, incluindo WINDOW e rollback de revisão por falha
de auditoria; build servidor group04-anchor-audit-server-20261012 PASS.
Não é novo ensaio visual/nativo do registro; mudança posterior àr53.

## Duas contas/sessões distintas e RTT local

verify-priority-playout.mts --compensation-actors PASS/exit0, fixturekgXhpD.
Duas contasADMIN deQA com sessões distintas conferiram a mesma revisão.
POSTs simultâneos:200/revisão2 em581,71ms;409/duração alterada em578,40ms.
Tempos de round-trip incluem backend/refresh/serialização em localhost, não
browser, percentis, rede externa ou garantia de latência sob carga.
Uma auditoria/duas revisões; filler75frames/editorial50. GET da vencedora
RECORDED para seu ator, NOT_RECORDED para o outro ator. Replay pela vencedora
deduplicado. ModeNATIVE explicitamente conferido; PGMvt/startedAt2021052 iguais
antes/depois e elapsed sem retrocesso. Saída null; cleanup próprio confirmado.
4.4 ainda precisa estação remota/rede/carga prolongada; contas locais não
equivalem a duas máquinas. Nenhuma contagem geral alterada.

## Gaveta sem sobreposição e resumo de alvo validado

Causa reproduzida localizada: App passava onOpenConflicts ligado à distribuição,
enquanto Master já abria sua gaveta. Removido callback indevido/prop sem uso;
Conflitos só muda estado da gaveta. Browser confirmou ausência do painel
Saídas do Canal & Distribuição em duas aberturas (antes/depois do reload).
Fixture MY1yml: novo resumo mostrou SOFT23:28:14→23:30:14/atraso2min. A grade
calculada iniciava antes pelo tolerance5000frames. Rótulo ajustado para
Horário-alvo flexível, tolerância03:20 explícita e advertência de início
executável diferente. WINDOW permanece janela com ambos os limites.
Browser confirmou texto após buildBYIu12gM.4 testes afetados/tipos/build PASS.
Captura scratch/group04-anchor-target-tolerance-browser-20261012.jpg.
SQLreadonly confirmou zero compensações: só conferências, nenhum commit.
Engine saída null e servidor exclusivo encerrados/owncleanup confirmado;
abaQA fechada. Servidor2C1141950C6E4F7FCD580F54B67DFF77D5CC50A275C134EDB9A030A992C7BA49.
Não fecha operação remota/hardware; ajustes posteriores àr53.

## Horário explícito antes/depois

Revisão ACCEPT_DELAY agora fornece anchorChange com âncora original/resolvida
do servidor. UI mostra SOFT antes→depois ou ambos os limites de WINDOW,
mais duração do atraso; não calcula horário a partir do relógio do navegador.
Campo opcional mantém clientes/servidores legados legíveis: ausente informa
que não há horário fornecido, sem inventar valor. Para outras ações não mostra
deslocamento de âncora.19 testes afetados PASS; tipos web PASS. Não é novo
replay visual do resumo nem homologação remota; posterior àr53.

## Demais ações no navegador — lote único

Fixture vigeY5, servidorB5D9FA16/engine real null, sem saídas físicas:
TRIM -1s mostrou5→4s e gravou revisão2; DROP_OPTIONAL mostrou3→0s e gravou
revisão3; ACCEPT_DELAY+120s deslocouSOFT23:16:14→23:18:14/revisão4, mantendo
FIXED23:26:14. Conferir filler em zona protegida recusou, confirmação desativada.
SQL/Drizzle readonly com cofre da própria fixture conferiu125→100frames,
opcional removido somente da publicação,SOFT+3000frames,âncora FIXED intacta
e item protegido idêntico exceto renumeração normal6→5 após remover opcional.
Primeira asserção comparava também order e falhou; corrigida expectativa para
exigir precisamente-1, mantendo comparação integral dos demais campos.
Três compensações/quatro revisões; editorial preservado. Resultado persistido
visual-actions-persisted.json, script verify-compensation-visual-result.mts.
Captura scratch/group04-other-actions-protection-browser-20261012.jpg.
Processos próprios encerrados/abaQA fechada. Não demonstra duração executada
dos futurosVT/opcional/âncoras nesta rodada, nem host remoto ou sinal externo.
4.4 segue aberto por latência/operadores distintos e clareza do resumo de
ACCEPT_DELAY:hoje destaca duração inalterada, horário aparece nos conflitos;
adicionar horário antes/depois explícito em revisão sem inferir do cliente.

## Concorrência HTTP com engine ativo

verify-priority-playout.mts --compensation-race encerrou exit0, fixture
RPlayout-priority-playout-WVxRUQ. Duas conferências sobre filler50frames e
mesma revisão, deltas25/50; confirmações via Promise.all HTTP. Resultado200
gravou revisão2/filler75; outro409 recusou duração exibida alterada.
Uma auditoria de compensação e duas revisões totais. Consulta vencedora
RECORDED/revisão2, perdedora NOT_RECORDED; reenvio vencedor deduplicated=true.
Filler editorial50 mantido; PGMitemvt e startedAt1995802 iguais antes/depois,
elapsed não retrocedeu. Saída null, mídia sintética e contaQA, sem físico.
ownedCleanupConfirmed=true/historicalPidKills=false. Não mede concorrência
entre hosts/atores distintos nem latência remota.4.4 permanece em andamento.

## Recibo perdido/truncado — navegador e relay reais

Fixture x8f8Lo: relay encerrou conexão após commit antes de headers; navegador
repetiu POST automaticamente. Segundo POST confirmou deduplicação na revisão2,
não exercitou estado desconhecido/GET. Log persistido registra os doisPOSTs;
não anunciado como validação da consulta. Nesse ensaio checkpoint já estava
em LIVE ao conferir (fixture local por arquivo); não comprova VT contínuo.

Fixture iYphji: falha corrigida para entregar200 com JSON truncado depois do
commit. Browser mostrou resultado não confirmado, manteve operation e ações
Consultar/Reenviar distintas. Consultar encontrou revisão2, advertiu recibo
histórico sem prometer sincronismo atual. Log de relay tem exatamente umPOST
compensation e umGET compensation/c6fcd37a-0b95-43fb-81b6-d6f71749555e200,
além doPOST review; nenhum segundoPOST para consultar.
SQLreadonly:uma OPERATIONAL_COMPENSATION,duas revisões,editorial filler50frames.
Servidor B5D9FA16B75D81A4BDD164A76518258D9357E265D41FBC87468E14578569545B;
engine real saída null, sem MediaMTX/saídas físicas. Comportamento de PGM não
homologado além do teste local: leitura de recibo não o observa.
Captura scratch/group04-receipt-query-browser-20261012.jpg.
Ambos terminaram exit0/ownedCleanupConfirmed=true; relay/socket/processos
próprios encerrados e abaQA fechada. Recibos automatizados mantêm
browserValidated=false; evidência visual registrada separadamente aqui.
4.4 permanece em andamento por concorrência/demais ações/latência remota.

## Consulta histórica sem reenvio

GET /api/channels/:id/compensation/:requestId consulta registro durável por
UUID. Exige sessão/papel/canal e retorna apenas recibo do mesmo ator/canal;
ausente/inacessível aparece NOT_RECORDED, não prova rejeição nem ausência de
transação em curso. RECORDED traz revisão/data e currentExecutionObserved=false.
Não chama runtimeFor/refresh/mutatePlaylist, não emite TAKE/onChange.
HTTP private,no-store; token de conferência não vai na URL.
UI separa Consultar solicitação (GET) de Reenviar mesma solicitação (POST
explícito com o mesmo requestId). Recibo registrado limpa operação local e
avisa que é histórico, não confirmação do sincronismo PGM atual.
31 casos distintos web/domínio/HTTP PASS, tipos web e builds servidor/web PASS.
Primeiro typecheck detectou nome get inexistente no cliente; corrigido para
send (GET padrão) e replay tipos PASS. Sem novo ensaio visual da resposta perdida.
Mudança posterior àr53;4.4 continua em andamento, totais não alterados.

## Comunicação de commit versus falha de observação

Resposta applied com refreshError agora mantém mensagem de compensação gravada
e revisão, seguida do aviso de atualização operacional. Não oculta o commit
atrás de erro nem promete sincronismo PGM/CUE nessa condição. Reenvio confirmado
é descrito como já aplicado. Erro após envio é resultado não confirmado na
tela; estado operation e requestId permanecem para conferir a mesma solicitação.
Erro local anterior ao envio não é apresentado como comando desconhecido.
29 testes do lote web/backend PASS; tipos web PASS. Sem nova injeção de falha
no navegador ou ensaio de rede nesta rodada. Alteração posterior àr53.

## Conferência visual posterior

Modo --browser-compensation separado da suíte automática em
scripts/verify-priority-playout.mts, servidor compilado explícito/hash observado
DF6EA30B792E1D603A044D3EDFC4BB5A9D52098AD07DF6E69FD4B0AE46384BC7.
Fixture RPlayout-priority-playout-iwbh4i: mídia sintética60s, VT nativo em
loop, saída null, nenhuma publicação física/MediaMTX. ContaQA exclusiva.
Operações anteriores de prioridade/crash não reexecutadas por status.

Navegador Master abriu Conflitos. Um painel de distribuição sobreposto
interceptou os primeiros cliques; fechado antes de repetir, sem presumir
efeito. Preset+5s mudou campo30→5; Conferir exibiu nominal/executável2→7s;
Confirmar mostrou revisão2 gravada/PGM-CUE preservados. SQL readonly confirmou
uma OPERATIONAL_COMPENSATION, filler editorial ainda50frames, checkpoint PGM
itemvt/executionId1453f743-eb20-418d-a39c-2a70f149a9f5. Não demonstra duração
nativa do filler nesta rodada, pois permaneceu futuro.
Troca de ação paraTRIM mudou sinal5→-5, mostrou só presets negativos e
orientou escolher VT trimmable, sem aplicar outra compensação.
Captura scratch/group04-compensation-browser-20261012.jpg.
Stop file exclusivo: fixture terminou exit0/ownedCleanupConfirmed=true;
abaQA fechada. browserValidated=false do recibo automatizado é mantido:
evidência visual é este registro separado, não inferida pela fixture.
4.4 continua em andamento por demais ações/concorrência/latência remota.

Orientações prévias adicionadas por ação: protegido, filler finito/elástico,
VT com corte permitido, opcional sem horário obrigatório e atraso SOFT/WINDOW.
São indicações dos metadados da grade exibida, não autorização: não escondem
itens nem substituem a conferência da revisão congelada pelo servidor. Texto
explica proteção de PGM/CUE/zonas e limites reais da mídia.
26 casos distintos PASS no lote web/backend (25 iniciais +1 novo de hints,
replay do helper não somado duas vezes); tipos web PASS. Proteções backend
mantidas: futuro/CUE/zona, duração mínima, revisão/ocorrência e deduplicação.
Sem validação visual ou ganho de latência remoto presumido.

Painel operacional oferece presets ±5/15/30/120/180s para filler, somente
negativos para reduzir VT e somente positivos para aceitar atraso flexível.
Trocar para TRIM ajusta o sinal; ACCEPT_DELAY usa magnitude positiva.
Escolher preset só preenche o campo e invalida revisão anterior; não aplica
alteração, não publica rascunho nem executa TAKE. Conferir/confirmar permanecem
separados, backend mantém revisão/token/requestId e proteção PGM/CUE/zonas.

Validação local recusa campo vazio, zero, não finito, além600s, sinal errado,
cadência inválida ou ajuste inferior a um quadro. Conversão respeita taxa
racional do canal (120s em30000/1001 →3596frames), não presume25fps.
11 testes de helper/markup PASS; tipos web PASS. Não é homologação visual,
medição de resposta remota ou novo ensaio nativo da compensação.
4.4 permanece em andamento; totais10grupos/53verificações:6concluídas,
32em andamento,8pendentes,7adiadasv3. Alteração posterior àr53, ainda não
incluída no ZIP r53. Integrar ao próximo lote, sem repetir transmissão por status.
