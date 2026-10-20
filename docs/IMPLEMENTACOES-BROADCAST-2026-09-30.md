# Implementações broadcast — controle de escopo

12/10 — usuário adiou TODO grupo8 para v3, explicitamente não fazer agora.
Código e provas parciais preservados; sem conclusão/qualificação implícita.
Escopo atual9 grupos/46 verificações:5 concluídas/31 em andamento/10 pendentes;
mais1 grupo/7 verificações adiadas, registro original10/53 preservado.
Movimentação de IA e instalação RPlayout de C: para D: autorizada;
ver ESCOPO-ATUAL-E-V3-2026-10-12.md e checkpoint de continuação.

12/10 — grupo2: NDI/recuperação produto e fixtures finalizados neste lote,
Rust94 PASS/3 ignored; NDI3 ciclos PASS, OMT retorno final PASS. Ver
GRUPO-02-NDI-RECUPERACAO-2026-10-12.md, incluindo FAILs anteriores e limites
de prova. Adicional22998 PASS comprovou retry após timeout/EOS NDI real local,
decoder2→3 sem avanço da grade; engine release PASS. Externos ainda abertos.
Não fechar2 nem alterar contagens;
DeckLinkadiada,10(1/9),53(5/36/12),sem instalador novo.

12/10 — 8.5/8.6 NOT_RUN: plano sequência respeita edição inteira/ordem/timing/
corte com provas, recusa lacunas/contratos ausentes sem omitir itens.
Ver HA-AUDIO-BUS-CONTINUO.md. Recibos/workflow/contratos/seletor/AV pendentes;
sem testes/build,10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: executor/leitor de sequência servidor adicionados,
SHA/stamp/ordem/config/cortes/total exatos, pipe/cancelamento/limites.
Ver HA-AUDIO-BUS-CONTINUO.md. Plano/workflow/AV operacional ainda pendentes;
sem testes/build,10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: helper renderiza sequência de cortes pelos ramos reais
com DSP contínuo/coverage por origem, resultado sem paths e qualificação
operacional falsa. Ver HA-AUDIO-BUS-CONTINUO.md. Runner/workflow/fronteiras/AV
e regressão do isolado pendentes;sem testes/build,10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: continuous_bus_meter atribui PCM ao corte original
após atraso, mede pares/item/sequência sem reset DSP. Apenas módulo, ainda
sem renderer real invocando. Ver HA-AUDIO-BUS-CONTINUO.md. Integração e
qualificação pendentes;sem testes/build,10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: base DSP contínua compartilha BusLimiter sem RESET
entre cortes, cobertura/ordem/startup/cauda estritos; ainda não chamada pelo
renderer. Ver HA-AUDIO-BUS-CONTINUO.md. Render sequência/recibos/UI/AV e
qualificação pendentes;sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: contratos de avaliação e UI ampliados, incluindo
falha/vazio/política inválida/revisão divergente; leitor UI protege contra
falha declarada dentro do perfil. Ver HA-SONDA-BUS-COMPLETO.md.
Validação/contínuo/transições/AV pendentes;sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: política/revisão local reconferidas Store, avaliação
persistida no diário e exibida UI, legados sem aprovação retroativa.
Ver HA-SONDA-BUS-COMPLETO.md. Validação integrada/transições/AV pendentes;
sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: preservação dos novos critérios QC no schema HA,
compartilhando schema dos pares com edição/projeto; também requireProbe e
liveSignalPolicy deixam de ser descartados. Fixtures ampliados, não rodados.
Ver HA-SONDA-BUS-COMPLETO.md; restauração integrada e avaliação persistida
pendentes, sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: perfil QC inclui política explícita de pares,
configurável na tela e capturável do canal local sem defaults. Ainda falta
vínculo Store/diário/avaliação UI e auditoria backup/retorno; transições/AV.
Ver HA-SONDA-BUS-COMPLETO.md;sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: domínio de avaliação bus por política explícita
peak/loudness de cada par, com bloqueios e fingerprint/revisão; não autoriza
QC/PGM. Falta captura/configuração local/persistência/UI, transições/AV.
Ver HA-SONDA-BUS-COMPLETO.md;sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: UI/API client da revisão bus completa ligados,
intenção guardada/consulta sem replay/proveniência estrita; BUS_REVIEW incluído
em listagem/recuperação servidor/UI. Ver HA-SONDA-BUS-COMPLETO.md.
Qualificação/política/transições/AV pendentes;sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: fluxo bus iniciado/consultado Store/Replication/API,
cópia STAGED e perfil/decisão reconferidos, intenção antes da medição, quota,
sessão/auditoria/IDs sem parâmetros de áudio externos. Ver
HA-SONDA-BUS-COMPLETO.md. UI/recuperação/listagem/qualificação pendentes;
sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: diário de revisão bus criado/contabilizado no Store,
ID-only/histórico imutável/captura cifrada/owner/quota/prova privada e resumo.
Ver HA-SONDA-BUS-COMPLETO.md. Falta iniciar via cópia STAGED/Store/API/UI e
ligar recuperação/listagem; qualificação contínua/AV ainda pendente.
Sem testes/build;10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: plano e recibos de bus completo implementados, ganho
efetivo/provas existentes e auxiliares explícitos, bind exato sem paths.
Ver HA-SONDA-BUS-COMPLETO.md. Falta workflow durável/cópia STAGED/Store/API/UI,
política e qualificação contínua/AV. Sem testes/build;10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: runner/leitor bus servidor e descoberta do binário
implementados, com cobertura/config/pares estritos e executor isolado existente.
Ver HA-SONDA-BUS-COMPLETO.md. Fluxo persistido/plano/provas/UI/política e
qualificação contínua/AV pendentes; sem testes/build,10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: helper audio-bus-probe renderiza ramos compartilhados,
mede por par e exige cobertura da trilha original, com cauda/contagem exatas.
Receitas Windows incluem/exigem helper. Ver HA-SONDA-BUS-COMPLETO.md.
Runner/plano/provas/diário/UI e qualificação contínua/AV ainda pendentes.
Sem testes/compilação/build; R55 inalterada; totais10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: ramos reais master/auxiliares construídos/ligados
por funções compartilhadas audio_bus, engine conectado sem mover limiter da
saída para itens. Resample8/matrix/volume/mixer/caps preservados; fixtures NOT_RUN.
Ver HA-RAMOS-AUDIO-BUS-COMPARTILHADOS.md. Sonda bus/recibos/transições/A-V/
qualificação/retorno pendentes. Sem testes/build, fora R55;10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: BusLimiter extraído e ligado elemento streaming e
helper, pares independentes/estado persistente, scratch reutilizado e medição de
redução/atraso comuns. Ver HA-KERNEL-LIMITER-BUS.md. Exige regressão consolidada;
pipeline bus real/transições/A-V/QC/retorno ainda pendentes. Sem testes/build,
fora R55; totais 10 grupos(1/9),53 verificações(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: cauda pós-ganho offline no helper, política explícita
na configuração/key, startup removido/cauda descarregada com cobertura exata;
recibo novo distinto do legado. Limiter atraso compartilhado/finish único.
Ver HA-CAUDA-AUDIO-POS-GANHO.md. Não altera PGM/timing/A-V; política/bus/
transições/qualificação/retorno permanecem. Sem testes/build; fora R55,
totais 10 grupos(1/9),53 verificações(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: UI pós-ganho integrada cópia STAGED e lista central,
intenção antes de POST/consulta sem replay, resumo com proveniência/flags exatos.
Encerramento POSTGAIN_REVIEW ligado Store/contrato/listagem/painel com fases
ACCEPTED/MEASURING, estado/data frescos e processo parado. Ver
HA-UI-AUDIO-POS-GANHO.md. Política/contingência/bus/cauda/transições/A-V/QC e
retorno permanecem. Sem testes/build, fora R55; 10 grupos(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: orquestração pós-ganho Store/fila/Replication/API,
intenção antes do runner e perfil local/decisão AUTO/cópia STAGED vinculados.
Conferência selada SHA/stamp/cofre/sidecars, acervo/QC/runtime/perfil antes/depois;
consulta sem replay, autorização/auditoria/quota. Ver
HA-ORQUESTRACAO-AUDIO-POS-GANHO.md. UI/recuperação/política/bus/cauda/transições/
A-V/QC/retorno continuam pendentes. Sem testes/build, fora R55; 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: diário pós-ganho cifrado implementado, intenção antes
do runner, captura interna/owner/fases, prova privada/resumo/MAC e reserva.
Store contabiliza quota/cria/consulta, namespace atualizado; ainda sem início
orquestrado/captura de perfil da cópia/API/UI/recuperação. Ver
HA-DIARIO-AUDIO-POS-GANHO.md. Política/bus/cauda/transições/A-V/QC e operação de
retorno continuam pendentes. Sem testes/build, fora R55; totais 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: recibos pós-ganho estritos sem paths, identidade de
montagem/job recalculada, PCM/DSP/runtime e plano completo correlacionados;
runner retorna evidência privada e resumo separado. Ver
HA-RECIBOS-AUDIO-POS-GANHO.md. Persistência/Store/API/UI/perfil local reconferido,
política/bus/cauda/transições/A-V/QC/retorno continuam pendentes. Sem testes/
build, fora R55. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — plano/runner pós-ganho ligados ao ganho efetivo e perfil explícito,
NOT_RUN; auxiliares separados, AUTO exato, fingerprint por contexto e qualidade
de resampling alinhada ao ramo do item. Não qualifica bus/transições/A-V/PGM.
Ver HA-PLANO-AUDIO-POS-GANHO.md. Persistência/UI/política e homologação pendentes.
Sem testes/build, fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — sonda isolada pós-ganho/limiter implementada engine/servidor, NOT_RUN,
DSP e parâmetros compartilhados. Não qualifica bus/transições/A-V/PGM, nem
converte recibo em AUTO pre-gain. Ver HA-SONDA-AUDIO-POS-GANHO.md. Próximo
workflow/perfil/ganho efetivo e qualificação completa. Sem testes/build,
fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — intenções de histórico ligadas listagem/recuperação UI/API/Store,
NOT_RUN; adapter operacional obrigatório, encerramento só pré-commit e
COMMITTING somente consulta. Preserva quota/histórico/PGM. Ver
HA-RECUPERACAO-INTENCOES-HISTORICO.md. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — diário durável de importação/variantes integrado Store/quota/namespace,
NOT_RUN; pedido não replayado, estado incerto pós-commit, recibo operacional
como prova. UI recebe estados explícitos. Ver HA-HISTORICO-TRABALHOS-DURAVEIS.md.
Sem testes/build, fora R55; totais 10 (1/9), 53 (5/36/12). Listagem/recuperação
dessas intenções e retorno operacional continuam pendentes.

11/10 — revisão técnica/reproteção ligadas à recuperação/listagem, NOT_RUN;
owner privado em novas revisões, legados sem owner bloqueados para encerramento,
sem alterar confirmação/quota/parciais/PGM. Ver
HA-RECUPERACAO-REVISAO-REPROTECAO.md. Sem testes/build, fora R55; totais 10 (1/9),
53 verificações (5/36/12). Recuperação operacional ainda não concluída.

11/10 — recuperação de candidato/vínculos ligada UI/API/Store/listagem,
NOT_RUN. Gates de fase/data/processo, owner e parciais/quota mantidos; não
retoma nem libera PGM. Ver HA-RECUPERACAO-CANDIDATO-VINCULOS.md. Sem testes/build,
fora R55; totais 10 (1/9), 53 (5/36/12), recuperação completa pendente.

11/10 — listagem de pedidos sem conclusão ligada API/Store/UI, NOT_RUN:
canal/tipo/cursor, até 25 históricos, outra execução, encerramento explícito
sem replay; não presume snapshot/PID encerrado/PGM. Ver
HA-LISTAGEM-PEDIDOS-PENDENTES.md. Sem testes/build, fora R55; totais 10 (1/9),
53 verificações (5/36/12). Recuperação completa permanece pendente.

11/10 — UI de encerramento de revisão/cópia integrada, NOT_RUN: confirmação,
justificativa, consulta fresca, pedido guardado antes do envio e consulta sem
replay. Não autoriza PGM; listagem e recuperação completa ainda pendentes.
Ver HA-UI-ENCERRAMENTO-PEDIDOS.md. Sem testes/build, fora R55; 10 (1/9),
53 verificações (5/36/12).

11/10 — encerramento explícito de revisão/cópia interrompida implementado no
servidor, NOT_RUN: PID/host, bloqueio de trabalho ativo, fase/data exatas,
transação/diário imutável, quota/parciais preservados. API consulta sem replay;
UI e recuperação completa ainda pendentes. Ver
HA-ENCERRAMENTO-PEDIDOS-INTERROMPIDOS.md. Sem testes/build; totais 10 (1/9),
53 (5/36/12), fora R55.

11/10 — divergência de durationOverride na análise/retorno corrigida em fonte,
NOT_RUN. Corte declarado compartilhado, recibo AUTO invalidado por duração
alterada; montagem dinâmica permanece com bloqueio de medição incompatível.
Ver AUDIO-CORTE-DECLARADO-UNIFICADO.md. Sem testes/build, fora R55.
Totais 10 grupos (1/9), 53 (5/36/12), sem encerrar verificações.

11/10 — adoção explícita da decisão AUTO na cópia conectada em fonte, NOT_RUN:
UI/pedido/Store/worker, UUID/count confirmados, medição exata, identidade da
derivada e outros bloqueios preservados. Não libera QC/PGM; ver
HA-ADOTAR-AUTO-NA-COPIA.md. Sem testes/build, fora R55. Totais 10 grupos (1/9),
53 verificações (5/36/12); 8.5/8.6 em andamento.

11/10 — UI de decisão AUTO integrada à revisão local, NOT_RUN: seleção de
master já AUTO, valores medidos/justificativa, intenção persistida e consulta
sem replay. Não aplica medição à derivada/QC/ganho/PGM. Ver
HA-UI-DECISAO-AUTO.md. Sem testes/build, fora R55. Totais mantidos:
10 grupos (1/9), 53 verificações (5/36/12).

11/10 — decisão AUTO Store/quota/fila/Replication/API NOT_RUN, consulta sem
replay e reconferência; não aplicada à derivada/UI/contingência/qualificação.
Ver HA-ORQUESTRACAO-DECISAO-AUTO.md. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — proposta/diário AUTO explícito NOT_RUN: master já AUTO com medição local,
sem alterar MANUAL/OFF/QC. Ainda NÃO ligado Store/quota/API/UI/worker, contingência
pendente. Ver HA-DECISAO-AUTO-RETORNO.md. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — áudio pré-ganho aplicado à derivada/diário/API/UI NOT_RUN, plano e
conteúdos das chaves/runtime reconferidos. Sem AUTO/qualificação pós-ganho,
limiter/barramento/autoridade. Ver HA-APLICACAO-EVIDENCIA-AUDIO.md.
Sem testes/build, fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — medição selecionada ligada revisão durável/fila/Store/Replication/API/UI
NOT_RUN; recibos privados e resumo público, runtime atual, sem AUTO/derivada/
ganho/limiter/barramento qualificados. Ver HA-REVISAO-AUDIO-PERSISTIDA.md.
Sem testes/build, fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — planos/executor de áudio selecionado por corte/trilha/master/auxiliares
NOT_RUN. Cobertura PCM/SHA/runtime/cancelamento, sem ganho/limiter/barramento
qualificados. Ainda NÃO conectados ao diário/Store/API/UI/derivada. Ver
HA-MONTAGENS-AUDIO-RETORNO.md. Sem testes/build, fora R55; totais 10 grupos
(1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — recibos gráficos aplicados à derivada/fila/diário/API/UI NOT_RUN.
Identidades/digests/runtime reconferidos; aprovação visual e qualificação da
composição continuam pendentes. Sem saídas/nativo/autoridade. Ver
HA-APLICACAO-EVIDENCIA-GRAFISMOS.md. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — revisão gráfica persistida ligada fila/Store/Replication/API/UI NOT_RUN:
evidência privada por composição, resumo público e reconferência do runtime,
aprovação visual distinta. Históricos preservados; ainda NÃO aplicada à derivada,
nem autoriza PGM. Ver HA-REVISAO-GRAFISMOS-PERSISTIDA.md. Sem testes/build,
fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — sonda de grafismos + leitor privado RGBA/viewport compartilhado e receitas
Windows implementados NOT_RUN; quick-xml resolvido offline, sem testes/build.
Ainda NÃO ligados ao diário/Store/API/UI; sem aprovação visual, montagem completa
ou autoridade. Ver HA-SONDA-GRAFISMOS-LOCAL.md. R55 preservada; totais 10 grupos
(1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6: grafismos na revisão de mídia (NOT_RUN). Revisão e derivada
usam o mesmo inventário de grafismos/automação, analisando SVG preenchido por
valores/padrões e registrando bloqueios sem paths públicos. Duplicidades/limites
recusados; render nativo pendente, históricos preservados, sem autoridade.
Ver HA-CONFERENCIA-GRAFISMOS-RETORNO.md. Sem testes/build, fora R55;
10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — media.db ligada Store/diário/quota512MiB/fila/worker/API/UI NOT_RUN.
Mídia/QC/runtime e source/destSHA/provas reconferidos; geração de edições só no
worker. Parada/quarentenada, sem outputs/nativo/autoridade. Ver HA-ORQUESTRACAO-
DERIVADA-MIDIA-RETORNO.md. Sem testes/build; R55 inalterado. Totais 10 (1/9),
53 verificações (5/36/12).

11/10 — construtor/worker de media.db com mídia revisada NOT_RUN: cópia selada,
MAC exato, novos IDs e cursor parado; markers bloqueiam bootstrap. Sem Store/API/
UI da criação ainda. Ver HA-CONSTRUTOR-DERIVADA-MIDIA-RETORNO.md. Sem testes/build;
R55 inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — preparação privada de variantes com mídia revisada NOT_RUN ligada ao
Store/fila, evidência/MAC próprios e bytes/QC/runtime/plano reconferidos. Sem nova
DB/API de materialização ou autoridade. Ver HA-PREPARACAO-EVIDENCIA-MIDIA-
RETORNO.md. Sem testes/build; R55 inalterado. Totais 10 grupos (1/9), 53 (5/36/12).

11/10 — seleção de ativo local por SHA/tipo para duplicidades integrada NOT_RUN
ao Store/API/UI e diário de revisão. MAC do inventário/QC vinculado à aplicação,
sem path na resposta. Ver HA-ESCOLHA-MIDIA-LOCAL-RETORNO.md. Aplicação da mídia,
mixes/grafismos/saídas/nativo/autoridade e homologação ainda faltam. Sem testes/
build; R55 inalterado. Totais 10 grupos (1/9), 53 (5/36/12).

11/10 — revisão local durável ligada Store/Replication/App/API/UI NOT_RUN,
diário cifrado/64MiB reservado/fila/cancelamento, aplicação selada e plano/acervo/
QC atuais conferidos; resposta sanitizada e consulta sem repetir. Não habilita
mídia/nativo/PGM. Ver HA-REVISAO-DURAVEL-MIDIA-RETORNO.md. Sem testes/build;
R55 inalterado. Totais 10 grupos (1/9), 53 (5/36/12).

11/10 — análise privada de mídia do retorno implementada NOT_RUN: consulta por
SHA no acervo inteiro + QC explícito, verificação de bytes/decode/cortes/trilhas/
mixes/contingência. Resultado privado, sem readiness/pub. Falta ligação ao diário/
Store/API/UI. Ver HA-ANALISE-MIDIA-LOCAL-RETORNO.md. Sem testes/build; R55
inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — aplicação a nova bound.db conectada Store/diário/quota/fila/worker/API/UI
NOT_RUN. Confere plano/fonte e registra entradas aplicadas; mídia/saídas/nativo/
autoridade permanecem false. Ver HA-ORQUESTRACAO-APLICACAO-RETORNO.md. Sem testes/
build; R55 inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — aplicação de referências locais em derivada bound.db implementada no
construtor/worker NOT_RUN, com novas revisões e cursor parado, fonte preservada,
mídia BLOCKED e bootstrap recusado. Orquestração Store/API/UI da aplicação ainda
pendente. Ver HA-CONSTRUTOR-VINCULOS-RETORNO.md. Sem testes/build; R55
inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — vínculos de retorno NOT_RUN: identidade explícita candidato/seleção no
plano cifrado e consulta por UUID para decisões substituídas, com resposta
sanitizada ligada à página. Sem adotar legados ou reenviar pedido ausente. Ver
HA-VINCULOS-CANDIDATO-RETORNO.md. Sem testes/build; R55 inalterado. Totais
10 grupos (1/9), 53 verificações (5/36/12).

11/10 — vínculos do candidato ligados Store/Replication/API/UI NOT_RUN, com
histórico cifrado imutável separado e saídas do principal atual. Token inclui
candidato/seleção/configuração/inventário/plano. Nenhum vínculo aplicado à derivada
ou saída aberta. Ver HA-VINCULOS-CANDIDATO-RETORNO.md. Sem testes/build; R55
inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — origem privada de candidato implementada NOT_RUN: Store serializado e
worker readonly, validação da seleção/mapeamento/cofre e SHA/identidade antes/
depois. Preparação interna para HaBindings, ainda sem integração de vínculos na
página e sem prontidão/publicação. Ver HA-LEITURA-PRIVADA-CANDIDATO-RETORNO.md.
Sem testes/build; R55 inalterado. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — orquestração do candidato de retorno integrada NOT_RUN: Store/diário/
quota256MiB/fila/worker/API/UI, SHA e identidade antes/depois, resultado STAGED
privado/arquivado/parado. Bootstrap comum bloqueado; preparação não é publicação.
Faltam bindings/mídia/QC/mixes/grafismos/comandos/atualização do principal, nativo/
autoridade/retorno/rejoin, KEEP_PRIMARY/híbrido e retenção/geração perdida.
Sem testes/build; fora R55. 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — auxiliar/runner de candidato de retorno implementados NOT_RUN, ainda
sem orquestração Store/API/UI. Banco novo local, canal arquivado e cursor parado;
originais cifrados separados de variantes bloqueadas sem endpoints/paths/eventos
estrangeiros executáveis. Faltam diary/quota/SHA/bloqueio durável de ativação e
bindings reais/mídia/nativo/autoridade/retorno/rejoin. Sem testes/build; fora R55.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — seleção explícita do retorno registrada com conjunto/edição/cursor/motivo,
ligada a revisão/MAC/SHA e preservação de futuras ativas. Diário cifrado imutável,
API/UI, UUID consulta sem replay; NÃO materializa candidato ou autoriza operação.
NOT_RUN, fora R55, sem testes/build. Faltam candidato/mídia/vínculos/nativo e
autoridade/retorno/rejoin; KEEP_PRIMARY/híbrido ainda exigem fluxo próprio.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — pré-requisitos de mídia no retorno ligados à comparação de conteúdo/UI
(NOT_RUN). Versão id/SHA, última decisão QC canal/global, montagem compartilhada
de trim/track/mix/pares/medição e live local obrigatório. Não comprova arquivo ou
decodificação. Plano de seleção ainda falta, seguido por autoridade/retorno/rejoin.
Sem testes/build; fora R55. 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — comparação edição/cursor integrada à revisão reprotegida (NOT_RUN).
Payload completo/HMAC local distingue mudança sob mesmo ID; checkpoint value
normalizado e referência edição/grade/item conferida. Contagens/diagnóstico na
página, sem seleção automática/aprovação/autoridade. Próximo plano revisado/mídia/
QC/comandos/abertos e retorno/rejoin. Fora R55; sem testes/build. 10 grupos
(1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — revisão de derivada reprotegida integrada (NOT_RUN): IDs próprios,
quota, SHA de fonte correto, nova inspection.db, worker readonly com cofre/
legibilidade/atestado estrangeiro e página separada da revisão original. Sem
aprovação operacional/importação automática. Colisão haReturnReview no cliente
corrigida separando consulta de plano. Faltam semântica/autoridade/retorno/rejoin.
Sem testes/typecheck/build; fora R55. 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — assinaturas estrangeiras preservadas com atestado autenticado por
exportação/pareamento, verificação original e digest reconferido na reproteção.
Inclui posse/as-run/distribuição/servidor/manutenção/restauração/ativação; sem
reassinar como autoridade local. Checkpoint JSON e journals em contexto padrão,
não cofres especiais como suposto anteriormente. NOT_RUN; sem testes/build,
fora R55. Faltam revisão semântica/derivada e restante do retorno/rejoin.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — prepareRekeyedCopy + diário/quota + APIs e HaReturnRekeyPanel integrados
em fonte no principal. Nova derivada, SHA bruto/final, confirmação de cofre usado,
sem alterar recebido/banco ativo/PGM. REKEYED_STAGED ainda não é operacional.
NOT_RUN, sem testes/build, fora R55. Faltam contextos especiais/revisão da derivada/
edição/mídia/cursor/comandos/plano/retorno/rejoin/homologação.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — ponte cifrada de protectedColumns integrada à exportação em fonte:
derivada nova, key derivada por exportId/pareamento, PK/contextos e inventário
autenticados, SHA da origem bruta e destino transportável. Importador worker
implementado, ainda sem habilitação/orquestração no principal. Nenhuma chave
privada copiada nem aprovação operacional. NOT_RUN, sem testes/build, fora R55.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — variantes de conflitos de as-run preservadas por política explícita:
seleção/hash/justificativa, worker readonly, hash principal reconferido na transação,
diário cifrado/API/página. Sem overwrite/faturamento duplicado/certeza artificial.
NOT_RUN, sem testes/build, fora R55. Reconciliação operacional/chaves/edição/mídia/
cursor/comandos/retorno/rejoin permanecem incompletos. Ver HA-VARIANTES-HISTORICO.md.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — reconciliação parcial efetiva: as-run RECEIVED_ONLY selecionado por ID/hash,
encerrado/nativo, append real com auditoria cifrada na mesma transação, worker/API/
página. Não overwrite/confirmação artificial/retorno; conflitos e demais dimensões
permanecem abertos. NOT_RUN, sem testes/build, fora R55. Ver HA-IMPORTACAO-HISTORICO.md.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — diagnóstico do banco retornado integrado em fonte: worker separado,
derivada privada/SHA/quota, SQLite/schema e diferenças de histórico/edições,
diário cifrado/API/painel. Não instala/rekey/merge/autoriza retorno. NOT_RUN;
build apenas atualizada em fonte com 12º auxiliar, sem execução; fora R55.
Falta reconciliação efetiva/retenção/geração perdida/retorno/rejoin/homologação.
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — retomada parcial explícita + orçamento de tráfego reverso integrados
em fonte: diário/UUID/token, SHA atual/STATUS fresco/offset exato, API/página
com intenções preservadas. Não reinicia/instala banco nem devolve autoridade.
NOT_RUN, sem testes/build, fora R55. Faltam geração perdida/retenção/reconciliação/
retorno/rejoin e homologação. Totais 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 em andamento/12 pendentes).

11/10 — envio reverso integrado em fonte (HA-ENVIO-REVERSO.md): cópia encerrada
própria, pedido persistido, SHA atual, blocos/recibo autenticados e correspondentes,
consulta remota somente STATUS, painel com intenção preservada. Não instala banco
nem devolve autoridade. NOT_RUN, sem testes/build; fora R55. Faltam parciais/
geração perdida, rede/retenção, reconciliação no principal e retorno/rejoin.
Totais inalterados: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes).

11/10 — recebimento reverso implementado em fonte: domínio RETURN separado,
AES-GCM/MAC/recibo, arquivo privado de quarentena, diário antes da alocação,
quota/parciais, blocos sem sobrescrita e verificação SHA. API/painel somente
consulta administrativa; sem instalação/merge/aprovação/autoridade. Falta envio
no reserva e reconciliação/retorno/rejoin. NOT_RUN; sem testes/build; fora R55.
Totais 10 grupos/53 verificações: 1 grupo e 5 verificações concluídos;
9 grupos abertos, 36 verificações em andamento, 12 pendentes.

11/10 — exportação encerrada integrada em fonte: arquivo privado novo, origem
fechada/preservada, hashes origem/destino, manifesto cifrado/assinado e diário
idempotente, API/painel sem caminhos externos/replay. Plano distingue selo local
de sincronização reversa/aprovação no principal. NOT_RUN, sem testes/build/R55.
Escopo geral permanece 10 grupos/53 verificações: 1 grupo e 5 verificações concluídos;
9 grupos abertos, 36 verificações em andamento e 12 pendentes. Ver HA-EXPORTACAO-EXECUCAO.md.

11/10 — lote 8.5/8.6, NOT_RUN: conferência de retorno ligada à parada e
testemunha, API/painel, sem transferência ou novo engine. Exportação selada,
transferência reversa e revisão no principal ainda ausentes e bloqueiam retorno.
Não considerar parada local como dados sincronizados. Sem testes/build.

11/10 — lote 8.3, NOT_RUN: parar execução própria com confirmação explícita,
UUID/conferência/diário/API/painel. Só liberar após parada de todos os recursos
e drenagem/posse; sem adotar PID/retornar ao principal/apagar incertezas antigas.
Faltam parada perdida/offline, autoridade/rejoin/continuidade e validação.

11/10 — lote 8.3, NOT_RUN: revisão de controle sem replay via recibo UUID/edição/
owner/term, confirmação TAKE exige decoder novo. Registro original preservado
e revisão cifrada separada; HTTP/painel ligados, token+posse+concessão atuais.
Sem recibo/geração perdida não libera bloqueio. Sem testes/build nesta etapa.

11/10 — lote 8.3, NOT_RUN: HaControlPanel integrado: CUE publicado/TAKE do CUE,
intenção durável na sessão antes do envio, consulta sem replay e validação da
prova nativa da resposta. Fresh ACK CUE atualiza visão imediata até próxima
observação; histórico não é seleção atual. Diário inválido/stale/pending bloqueiam.
Sem testes/build; faltam revisão/fronteiras/contingência/habilitação/replicação.

11/10 — lote 8.3, NOT_RUN: CUE/TAKE admitidos da reserva em fila única, edição
congelada e mesmo CUE, com prova nativa/diário/UUID sem replay e HTTP autorizado.
ACK de live/CUE não vira prova PGM. Faltam interface/reconciliação/fronteiras/
contingência/habilitação/replicação; sem testes/build.

11/10 — lote 8.3, NOT_RUN: monitoramento de readiness da mídia HA e painel
integrados; dependência PGM separada de monitor-only. Não adotar/reiniciar
processo por timeout; encerramento próprio registrado, cleanup independente
engine+mídia com confirmação conjunta. Recuperação/controle/validação pendentes.

11/10 — lote 8.3, NOT_RUN: observação de execução expõe somente PVW/MON/porta
do media handle próprio pronto e da geração confirmada. Painel WHEP integrado
com host da interface remota, sem nova execução; controles de monitor explícitos.
Ainda não validado com browser/sinal real e adapter não é default. Sem testes/build.

11/10 — lote 8.3, NOT_RUN: mídia própria ligada ao adaptador após controle
transferido e warmup parado, com distribuição reservada antes do novo engine.
Paths apenas dos sinks locais revisados; readiness antes da geração e encerramento
conjunto engine+mídia. Guard genérico permanece fechado. Faltam WHEP/saúde/controles/
fronteiras/contingência/habilitação/replicação e validação. Sem testes/build.

11/10 — lote 8.3, NOT_RUN: servidor de mídia com admissão confirmada antes de
spawn/config e readiness da geração própria; encerramento confirmado dos filhos
da instância. Staged app continua sem abertura automática. Faltam adaptador,
reserva de distribuição e conexão paths/WHEP. Sem testes/build.

11/10 — lote 8.3, NOT_RUN: TAKE interno confirmado admite novo decoder/item/
executionId no compositor e accounting; eventos da edição congelada, sem fases
estrangeiras na nova ocorrência. Checkpoint bloqueado até correspondência com
accounting. Manutenção gráfica drenada na mudança. Ainda não é operação HA
completa; fronteiras/contingência/controle/replicação e homologação pendentes.

11/10 — lote 8.3, NOT_RUN: revisão de monitor incerto por novo comando explícito,
token assinado da conferência, cadeia íntegra e bloqueio de execução concorrente.
ACK novo resolve ancestrais sem reescrever entrega histórica. API e painel
integrados; intenção/cadeia preservadas na sessão. Não habilita replay de TAKE,
grafismos, SCTE ou transferência incerta. Sem testes/build nesta etapa.

11/10 — lote 8.3, NOT_RUN: monitor admitido integrado HTTP/interface/transporte/
Rust, UUID cifrado e ACK com cerca de geração. Consulta read-only; UNKNOWN não
gera repetição automática. Sessão do navegador preserva intenção antes do envio.
Sem alteração de PGM, CUE, TAKE ou abertura de runtime. Restam operação completa
da reserva, revisão de incerteza e habilitação; sem testes ou build neste lote.

10/10 — lote 8.3, NOT_RUN: diário/observação local/GET autorizado por canal/
painel da reserva integrados, sem confundir ACK histórico e PGM atual. Sem
paths/destinos privados no payload. Fixture mockado NOT_RUN; HTTP/render ainda
não verificados, comandos/monitor/canal promovido completo pendentes.

10/10 — lote 8.3, NOT_RUN: Preview HA local retido no startup e comando nativo
de liberação owner/term sem novo destino, conectado após admissão/accounting.
Publicador leve/on-demand, sem restart/replay em falha. Fixtures wire/order
adicionados, não executados. Monitor/painel/MediaMTX ainda não integrados.

10/10 — lote 8.3, NOT_RUN: nativeHaPromotionAdapter implementado para injeção
interna; factory privada, saídas retidas, activation/stop deduplicados, criação
incerta sem replay. Ainda não default, operação de canal completa pendente.
Fixtures mockados adicionados sem execução, sem build/hardware.

10/10 — lote 8.3/8.4, NOT_RUN: concessão frequente sem SHA completo do acervo,
com posse local/assignment assinado exato antes/depois e nonce/termo/TTL nativos.
Prova completa continua antes de ações de programa; sem duplicação no mesmo
passo da geração cercada. Latência/estabilidade não medidas nesta etapa.

10/10 — lote 8.3, NOT_RUN: projeção do diário secundário HA no snapshot e
consulta pelo fluxo comum após restart; sem novos sends/linhas importadas.
Cronologia/contexto/SHA validam confirmado, incerteza preserva FIRING,
SUPERSEDED não é sucesso físico. Fixtures preparados, sem testes/build.

10/10 — lote 8.3, NOT_RUN: ponte de composição HA local ao checkpoint/restore/
snapshot com namespace/SHA/cronologia e bloqueio de alterações posteriores
incertas ou já confirmadas. Novo recibo normal na recuperação, não importado;
UUID gráfico alinhado ao operacional. Fixtures mockados NOT_RUN. Sem build.

10/10 — lote 8.3, NOT_RUN: checkpoints locais ligados ao accounting após release,
posição periódica com decoderId nativo/recência, sem reaproveitar dono gráfico
estrangeiro. Falha fecha transporte, exit preserva cursor. Fixtures wire/decoder
adicionados, não executados. Não fecha recuperação gráfica/restante do runtime.

10/10 — lote 8.3, NOT_RUN: as-run próprio NATIVE após prova de release, edição/
posse e proveniência explícitas; TAKE retido não abre linha. Callbacks em fila,
fechamento local após parada, falha fecha transporte. Não altera histórico do
primário nem completa runtime/checkpoint/fronteiras/Preview/replicação reversa.
Sem testes/build, contrato em HA-ASRUN-LOCAL.md. Adaptador padrão ainda null.

10/10 — lote 8.3, NOT_RUN: eventos gráficos futuros da ocorrência retomada
executam com novo UUID/recibos próprios e dono de camada local. Seed preserva
supressão do passado; hasDue sem I/O ocioso; descarte superseded não apaga nova
camada. Fixture scheduler NOT_RUN. Não equivale à admissão operacional de novos
itens/edições, equipamento/SCTE, as-run, Preview ou adaptador de produto pronto.

10/10 — lote 8.3, NOT_RUN: classificação/seed secundários por canal, ocorrência,
item e revisão original, sem replay de fases passadas/FAILED; FIRING bloqueia
compositor. Eventos futuros/manuais separados, descarte relativo ao fim exige
duração confirmada. Fixtures adicionados sem executar. Dispatch/donos locais
e continuidade ainda não implementados completamente; não fechar grupo.

10/10 — lote 8.3, NOT_RUN: compositor preservado para expiração pós-admissão,
cadência sem I/O ocioso, recebimentos locais novos e encerramento do transporte
próprio em incerteza. Início/cleanup ligados ao orquestrador e decoder;
fixtures preparados, não executados. Não fecha homologação física/operacional.

10/10 — lote 8.3, NOT_RUN: snapshot gráfico confirmado/vazio/bloqueado, ponte
para candidato autenticado e compositor nativo retido com recibo próprio/SHA.
Deduplicação, vínculo do checkpoint, recursos externos recusados e donos de
eventos estrangeiros removidos. Fixtures de tradução preparados, não executados.
Não homologa aparência/saída nem completa operação/expiração/eventos/Preview.
Contrato detalhado em HA-COMPOSICAO-GRAFICA.md; alterações não estão na R55.

10/10 — lote 8.3, NOT_RUN: factory da geração cercada conectada ao contexto
interno do adaptador, apenas após transferência e parada do warmup. Retomada
explícita de cursor/corte no PGM interno retido, live aguarda confirmação de
decoder, saídas locais sem Preview precoce, limpeza de ambas as gerações.
Fixtures adicionados sem executar. Não há adaptador de produto completo nem
composição/continuidade/Preview pós-admissão homologados; R55 não contém isto.

10/10 — lote 8.3, NOT_RUN: tradução de saídas locais integrada ao candidato HA,
sem usar destino original/variável de ambiente/default gerenciado. Conferência
exata de IDs/protocolos, motivo obrigatório para desativação, formato preservado
e Preview/monitor leves. Digest inclui perfis completos: mudança de bitrate ou
geometria invalida seleção anterior. Fixtures de preparo adicionados sem execução.
Não equivale a publisher ativo, sinal físico ou adaptação nativa completa.

10/10 — continuação 8.3, NOT_RUN: decoder de preparo real ligado após backend
copiado, posse/callbacks próprios, LOAD de edição/corte/offset congelados,
consumidores nulos. Sem TAKE/concessão/PGM externo/as-run importado. Live LOAD
não é vídeo confirmado. Stop por exit+retirada da posse, sem restart/replay.
Ativação cercada/cursor/composição/mixes/destinos/operação ainda faltam;
adaptador real não habilitado. Fixtures preparados, sem testes/build/hardware.
Totais 10(1/9),53(5/36/12). Contrato HA-DECODER-DE-PREPARO.md.

10/10 — continuação 8.3, NOT_RUN: backend copiado admitido/registrado/auditado
na mesma reserva e entregue ao adaptador. Fingerprint de linhas/schema antes
da abertura, handoff da conexão sem release; sem novo serviço HA herdado.
Runtime/distribuição/MediaMTX/import de raiz/descoberta inicial bloqueados em
quarentena. Close drena backend conhecido mas reserva/broker só são liberados
pelo orquestrador após confirmação. Falta execução nativa/cursor/destinos/
mixes/grafismos, adaptador real não habilitado. Sem testes/build/prova física;
totais 10(1/9),53(5/36/12). Contrato HA-POSSE-DA-COPIA.md.

10/10 — continuação 8.3, NOT_RUN: capacidade interna da cópia com broker/prova
host e reserva assinada de storage ligada ao preparo/promoção/cleanup. Só banco
distinto corrente/arquivado/sem saídas; sem migração nem desarquivar original.
Transferência de conexão mantém reserva; handle perdido/parada incerta não a
liberam. Factory/registro/destinos/cursor/mixes/grafismos ainda faltam, adaptador
real não habilitado. Fixtures preparados, sem testes/build/prova física.
Totais preservados: 10(1/9),53(5/36/12). Contrato HA-POSSE-DA-COPIA.md.

10/10 — continuação 8.3/10.3, NOT_RUN: proteção de diretório HA novo/vazio no
auxiliar Windows, DACL usuário/SYSTEM protegida e herdável, sem recursão ou
alterar raiz. Backend verifica origem cifrada, UUID/canal/preparação e SHA da
cópia antes do adaptador, recusa cópia aberta/alterada. Fixtures TS/Rust
preparados, não executados. Novo auxiliar requer build conjunta; promoção/factory
admitida ainda não habilitadas. Totais 10(1/9),53(5/36/12), sem homologação/build.

10/10 — continuação 8.3, NOT_RUN: cópia de execução distinta ligada ao diário/
adaptador, preservando preparação original. UUID antes dos efeitos, destino
novo protegido antes dos bytes, handles/hash/fsync/espaço/candidato rechecados,
origem cifrada. Sem desarquivamento, posse ou PGM. Parcial preservado/repetição
recusada. Factory admitida/diretório/sidecars/destinos/cursor/mixes/grafismos
ainda faltam; produto continua sem adaptador real. Fixtures preparados,
não executados; totais 10 grupos (1/9),53 verificações (5/36/12), sem build.

10/10 — ligação 8.3, NOT_RUN: promoção solicita liberação diretamente ao
EngineTransport admitido/retido do adaptador; não aceita callback com prova
pronta. Confere edição/cursor/concessão viva antes e depois, persiste decoder
da prova nativa. Histórico sem decoder continua consultável, explicitamente
incompleto, sem replay. Fixtures de recusa antes de liberar preparadas, não
executadas. Factory/workspace/host/storage/grafismos/mixes/API/UI ainda faltam;
adaptador nulo continua recusando antes de transferir. Totais 10(1/9),53(5/36/12),
sem build ou homologação física.

10/10 — continuação 8.3/8.4, NOT_RUN: evento de liberação inclui posição/corte
do pipeline nativo e quadro recente. Verifica antes/depois de montar saídas;
TAKE pendente/VT terminado/sinal perdido não confirmam PGM anterior/idle. Falha
posterior encerra nativamente a geração própria. Backend valida prova estrita e
retorna cursor observado; SHA continua responsabilidade do servidor/candidato.
Fixtures preparadas, sem testes/build/prova física. Adaptador completo ainda
falta, promoção permanece desabilitada. Totais 10 (1/9), 53 (5/36/12).

10/10 — continuação 8.3, NOT_RUN: cleanup confirmado do EngineTransport rastreia
todos os handles próprios, inclusive geração antiga sem morte observada.
Somente exit/erro de spawn sem PID comprovam término; kill/erro com PID/timeout
não. Fecha transporte sem replay; resultado negativo persiste para o diário.
Fixtures preparadas, sem testes/build. Adaptador completo e confirmação de
outros recursos ainda faltam. Totais inalterados: 10 grupos (1/9), 53 (5/36/12).

10/10 — lote 8.3/8.4, NOT_RUN: retenção de destinos PGM no engine via bootstrap
privado e liberação interna owner/termo/item/decoder. Ready compatível obrigatório;
evento sem pedido, ACK isolado e cursor divergente não confirmam admissão.
Revogação/erro após envio encerra somente a geração própria sem replay. Cerca
nativa reconferida antes/depois da montagem, guards nos sinks e limite de montagem
independente de Node/driver. Contrato em HA-PREPARACAO-NATIVA-PGM.md; fixtures
TS/Rust preparados, não executados. Adaptador completo/local execution admission
e prova final/rota/UI continuam faltando; promoção não habilitada. Sem build ou
homologação física. Totais preservados: 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 em andamento/12 pendentes).

10/10 — lote 8.3, NOT_RUN: orquestrador de promoção cifrado/ator/UUID ligado ao
HA e ao fechamento do backend. Fases anteriores a efeitos, preparo sem PGM,
admissão atual/termo/cursor/crop/primeiro quadro verificados e prova persistida.
Consulta não reexecuta; falha de resposta/preparo/parada preserva incerteza,
novo UUID não a limpa. Stop deduplicado, storage só fecha após drenagem. Sem
adaptador real recusa antes de transferir. Fixtures apenas mockadas preparadas,
não executadas. Native adapter/reconciliação/API/UI ainda faltam; nenhum engine/
TAKE/build neste lote. Totais inalterados: 10 grupos (1/9), 53 (5/36/12).

10/10 — lote 8.3/8.5/8.6, NOT_RUN: nó admitido persiste por canal na testemunha;
expiração não toma posse nem devolve primário antigo. Transferência explícita
com chave separada, UUID/termo/revisão, expiração+margem e transação de histórico/
admissão; recusa terminal, consulta sem replay, ausência não terminal. Restart
preserva último nó/transferência e autentica registros. Cliente/rotas limitados,
segredos fora dos helpers/UI, diagnóstico no painel, script de witness atual no
próximo pacote. Sem engine/TAKE/testes/build; adaptador nativo/diário/UI, reverse
replication e rejoin continuam incompletos. Totais: 10 grupos (1/9), 53 (5/36/12).

10/10 — lote 8.2/8.3, NOT_RUN: corrigido preparo de cursor nativo com crop/
owner estrangeiros. Cursor operacional parado remove campos de PGM ativo;
intenção cifrada separada conserva offset/crop/cadência/bus/contingência com
edições remapeadas. Recibo gráfico estrangeiro continua como proveniência,
não ACK local. Ponte privada lê workspace do próprio ledger, autentica origem/
cursor/plano, reproduz variantes, confere mídia/runtime SHA e nova descoberta
local. Não extrapola cursor por relógio nem altera origem. FILE legado sem crop,
simulado/pausado incompleto e alteração de artefato/plano recusam candidato.
8.3 iniciado; faltam admissão nativa/ativação/diário/API/UI e provas entre hosts.
Sem engine/TAKE/build/testes neste lote. Totais: 10 grupos (1/9), 53 (5/34/14).

10/10 — lote 10.4: conferência offline de retorno compara as-run por ID/colunas
entre dois snapshots fechados e validados, com diferenças/contagens/hash completos
e relatório privado cifrado. Sem merge/cursor/perfil/TAKE; compatibilidade do
binário antigo NOT_VERIFIED e rollbackReady=false. Integrado a ambos os
empacotadores e inventário (onze bundles), fixtures NOT_RUN. Conciliação e
ativação compatível ainda abertas. Totais: 10 grupos (1/9), 53 (5/33/15).

10/10 — lote 10.4: RecoverMaintenance explícito liga reserva interrompida à
reconciliação de adoção. Autentica origem antes de liberar, reutiliza prova
local de detentor/instâncias mortos e predecessor liberado sob mesma posse.
Consulta não muta; liberação parcial auditada não limpa intenção de perfil.
Sem timeout/TAKE/replay. Fonte NOT_RUN, sem testes/build; energia/Windows e
rollback/as-run em aberto. Totais: 10 grupos (1/9), 53 (5/33/15).

10/10 — lote 10.4: reconciliação offline de adoção por ID/contexto completo,
perfil observado/hash, anterior preservado, ativação autenticada e posse/
manutenção/predecessor liberado. Fecha intenção sem trocar perfil/TAKE/replay,
sem inventar ACK histórico. Consulta e confirmação separadas, dez bundles.
Fonte/fixtures NOT_RUN; manutenção pós-energia, rollback/as-run e provas Windows
continuam faltantes. Totais: 10 grupos (1/9), 53 (5/33/15).

10/10 — lote 10.4: adoção permanente opcional após confirmação nativa atual,
com frase ATIVAR E ADOTAR, perfis/caminhos capturados antes da ativação, posse
mantida, anterior privado e publicação por rename. Diário cifrado; incerteza
bloqueia partida, sem replay. Erro encerra candidato, não reinicia predecessor.
Fixtures NOT_RUN; sem troca real/build/testes. Reconciliação explícita, Windows
e rollback/as-run seguem faltantes. Totais: 10 grupos (1/9), 53 (5/33/15).

10/10 — lote 10.4: migrate-restored.cjs/opção MigrateSchema conecta migrações
transacionais à cópia autenticada em quarentena sob host/storage admission.
Diário cifrado de fase/origem impede replay de migração interrompida; revisão
posterior é fresca. Nenhum engine/saída é aberto; predecessor vivo não é parado.
Nove bundles exigidos pelo pacote. Fonte/fixtures NOT_RUN; migração entre versões,
perfil permanente e rollback continuam faltantes. Totais: 10 grupos (1/9),
53 verificações (5 concluídas/33 em andamento/15 pendentes).

10/10 — lote 10.4: start-rplayout-upgrade.ps1 integra candidato ao launcher:
STAGE por padrão, ACTIVATE com confirmação textual explícita, revisão fresca,
perfil/manifesto absolutos e backend com admissão/ativação nativas existentes.
Recusa misturar modos/reutilizar porta ocupada, propaga erro do backend; não
troca perfil permanente, para predecessor ou autoriza replay de incerteza.
Fixtures CLI preparadas NOT_RUN, sem build/testes/execução de canais. Faltam
adoção de perfil, migração isolada e rollback/as-run. Totais mantidos: 10 grupos
(1/9), 53 verificações (5 concluídas/33 em andamento/15 pendentes).

10/10 — lote 10.4: contrato explícito de schema 1–50 por ID/nome, preflight
antes de journal/DDL/admissão e conferência completa após migração. Backup e
review offline usam o guard; pedidos de backup recebem migração formal50.
Fixtures preparadas NOT_RUN, sem build/testes. Não protege retroativamente
binários antigos, nem comprova downgrade/ABI/rollback. Fluxo de ativação/retorno
continua faltante. Totais mantidos: 10 grupos (1/9), 53 verificações (5/33/15).

10/10 — lote 10.4: review-rplayout-upgrade.ps1 conecta candidato à revisão
operacional offline existente. Confere pacote/candidato/origem, posse nativa,
predecessor, grade/mídia/QC/cursores e registra fatos sem ativar/trocar perfil.
Recibo não vira autorização serializável. Empacotadores/painel incluem a etapa.
Código novo NOT_RUN, sem testes/build/instalador; ativação, compatibilidade e
rollback completos permanecem faltantes. Totais mantidos: 10 grupos (1/9),
53 verificações (5 concluídas/33 em andamento/15 pendentes).

10/10 — lote 10.4: backup online guiado no HOST/API com intenção UUID durável,
relatório cifrado, cópia fora da rotação, validação SQLite/cofre e SHA. Sessão
fresca/administração global, consulta sem replay, reconciliação só de criador
local morto e encerramento aguardando builder. Fixtures preparadas NOT_RUN;
não transfere PASS históricos ao serviço novo/processo separado/UI. Sem nova
build/testes/instalador. Totais mantidos: 10 grupos (1/9), 53 (5/33/15).

10/10 — lote 10.4: ferramenta prepare-rplayout-upgrade.ps1 integrada ao pacote
com verificação do manifesto, restore de backup/cofre em pasta nova e perfil
candidato/recibo exclusivos. Mídia original solicitada explicitamente;
launcher aceita databaseFile direto sob dataRoot. Nada ativa/troca perfil ou
para/inicia PGM. Falta backup guiado online, revisão/ativação e rollback com
compatibilidade/as-run. Fonte nova NOT_RUN; sem build/testes/novo instalador.
Totais mantidos: 10 grupos (1/9), 53 verificações (5/33/15).

10/10 — continuação do lote sem testes em 10.4: instalador confere catálogo ZIP
inteiro antes da extração, recusa caminhos/links/duplicatas/arquivos extras,
separa dados por perfil local e grava recibo de integridade sem homologação.
Launcher lê perfil estrito, recusa env conflitante e Node global em pacote;
empacotador recebe LauncherBinary externo. Fixtures Rust preparadas, NOT_RUN.
Upgrade/rollback guiado e provas reais permanecem faltantes; contrato em
INSTALACAO-DADOS-E-INTEGRIDADE.md. Totais atuais: 10 grupos (1/9),
53 verificações (5 concluídas/33 em andamento/15 pendentes). Números abaixo
são históricos; nenhum instalador posterior à R55 produzido nesta etapa.

10/10 — continuação da implementação agregada em 8.2: montagem de fallback
de live com defaults próprios, troca/remoção da identidade configurada do
primário, tracks de áudio local, inventário de templates/recursos SVG externos
e relatório por item/revisão com nomes e motivos no painel. Render de grafismo
e mix, sinal e promoção continuam gates separados. Fixtures acrescentadas,
NOT_RUN; nenhuma validação/build por mudança de status. Totais inalterados:
10 grupos (1 concluído/9 abertos), 53 verificações (5/32/16).

10/10 — lote sem validação incremental: 8.2 conecta plano local à recuperação
isolada via POST /api/ha/prepare e painel. Snapshot consistente congelado,
edições derivadas com proveniência, mídia/probe local, revisão de trims/tracks/
routing/medição e relatório de blockers. Eventos externos permanecem bloqueados;
plano privado/destinos cifrados, canal arquivado/parado. Pedido armazenado antes
do envio; consulta de resultado não repete preparação. Sem promoção/PGM.
Fixtures de materialização preparadas, NOT_RUN; sem build/typecheck/instalador.
Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/32 em andamento/16 pendentes). PASS antigos não validam este lote.

10/10 — continuação do lote sem testes: 8.2 ganha conferência de vínculos locais
no API/painel de reserva. Descoberta distingue entrada/saída, revisão semântica
não expira apenas por telemetria, plano cifrado/imutável e autorização fresca.
Não instalado em runtime, sem sinal/mídia/QC/mixes/trims homologados, sem promoção.
HA-VINCULOS-LOCAIS.md registra o contrato e limites; fixtures não executados.
Totais atuais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/32 em andamento/16 pendentes). Demais números abaixo são históricos.

10/10 — lote posterior à R55, por pedido de implementar antes da revisão:
6.2/9.2: contexto de ocorrência nas confirmações gráficas e resolução auditada
de alerta; 7.1–7.4: adapter de banco em processo privado, transações/cursors,
falha sem replay e diagnóstico HOST; 8.4: concessão subordinada de relay,
sink guard/expiry nativos e binding fresco ao engine/testemunha. Código e
fixtures integrados; **build/testes deste lote ainda não executados**. Não
transferir os PASS históricos abaixo a estas alterações novas. Não há novo
instalador contendo este lote, nem qualificação de partição/hardware/destino.
Contratos: BANCO-OPERACIONAL-SEPARADO.md e HA-CERCA-DE-RETRANSMISSOES.md.
Totais atuais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/31 em andamento/17 pendentes). Totais anteriores abaixo são históricos.

10/10 — cC7MZ0 PASS nativo: falha de persistência após SHOW/ACK real deixa SENDING
durável; crash e REVIEWED não restauram composição antiga. Nova intervenção
CONFIRMED estabelece checkpoint; cursor83→181, identidade/revisão/as-run único,
história2→3. Efeito/receiver comprovados, cleanup próprio confirmado. Não prova
wire ACK loss, áudio, hardware/browser/instalação nem observabilidade completa
(aviso de recuperação pode continuar histórico até reconciliação específica).
21 testes afetados/types/build PASS; server9ED3338E/engine28916DE9 da parcial r55,
já gerada antes do ensaio, instalação sem teste: 535651285 bytes SHA256
C4FD7BB7951D20E4FA8AC8B67384285BA04BD16DCF20B4EC30530227CE107538.
6.2/10.1 abertos, escopo integral/totais10grupos1/9;53checks5/26/22.
scratch/group06-reviewed-uncertainty-native-20261010.json; README anterior ao PASS.

10/10 — lote r55 integrado: confirmação REVIEWED não autoriza recuperar snapshot
anterior a envio nativo incerto; nova composição explicitamente confirmada pode
estabelecer novo head/checkpoint. Recusa definitiva não cria gap. Leitura preserva
codec criptografado e ordem de inserção. 21 testes afetados/types/build PASS,
server9ED3338E/engine28916DE9. Criar parcial antes do ensaio nativo específico,
sem testar instalação. Ensaio injeta durabilidade perdida após efeito/ACK nativo,
NÃO perda do ACK de protocolo. 6.2/10.1 abertos; 10grupos1/9,53checks5/26/22.

10/10 — RipsqZ PASS nativo limitado: crash backend próprio, vídeo/SRT e gráfico
secundário voltaram, cursor62/execução/revisão preservados, as-run único, uma
ocorrência/uma reconciliação/dois recibos; segundo é reconstrução de composição,
não replay de evento. Checkpoint→recibo confirmado assertado antes da queda.
Cleanup próprio confirmado, sem PIDs históricos. Mesmos server2A9512D5 e engine
28916DE9 da parcial r54, já gerada antes do ensaio, sem instalação testada.
535650454 bytes SHA256590BCA8ECCBC0DF5D230B4D02CED8B4E252AC8999259DA5A7EDAD4444D0BEE95.
60 testes/types/build PASS. Não prova ACK loss, estado incerto REVIEWED, áudio
pós-queda, crash nativo multilayer/substituição/emergência, legado sem snapshot,
NDI/OMT/DeckLink/browser/HA/soak/instalação. Próximo lote preserva esses requisitos;
REVIEWED não prova imagem restaurada. 6.2/10.1 abertos; 10grupos1/9,53checks5/26/22.
scratch/group06-composition-native-recovery-20261010.json; README da r54 antecede PASS.

10/10 — lote r54 integrado, server 2A9512D5/engine 28916DE9: composição completa
persistida atomicamente com recibo confirmado, ponteiro no checkpoint e captura
isolada por comando assíncrono. Restauro de camadas/ownership/prazos absolutos,
substituições manuais e emergência; sem reexecutar SCTE/equipamento/deixa legada
já confirmada. Comando incerto/composição alterada/registro antigo sem snapshot
bloqueiam histórico. Consulta de cabeça gráfica indexada; payload permanece
criptografado, deixa legada lida pelo codec oficial uma vez por item/execução.
60 testes afetados/types/build PASS; native engine/cursor 2 PASS anteriores.
Parcial antes do ensaio nativo integrado; instalação não testada. 6.2/10.1 ainda
abertos. Totais 10 grupos 1/9; 53 5/26/22. Prova nativa completa ainda pendente.

10/10 — FsekVy FAIL completo com engine novo 28916DE9/server EFF62925: imagem live
comprovada no receptor próprio após crash e cursor salvo60→89, sem regressão a
zero. Engine soma startOffsetFrames somente na posição live; arquivos não duplicam
seek. Dois testes nativos/oito dirigidos/types/compilações PASS. Gráfico secundário
EXECUTED não foi reconstruído; composição durável e ownership ainda faltam.
Evidência scratch/group06-live-cursor-engine-20261010.json. Novo engine somente em
native-target D:, server r54-server-dist; nenhum instalador r54. R53 é último e
não contém esses binários. Empacotador EngineBinary explícito preparado para
próxima integração, sem prova de pacote. 6.2/10.1 abertos; 10 grupos 1/9; 53 5/26/22.

10/10 — r53 parcial criada antes do ensaio WMDaeE; instalação sem teste solicitado.
535646717 bytes SHA256 319BA026069DF73808FF8918926D12C52603BA30F04FAB34403066FF3B30144B.
WMDaeE FAIL: live em estado PGM após recusa tardia/retry e secundário reconciliado
FIRING→EXECUTED, porém sem display; cursor 0 vs salvo 84, raster preto luma16/desvio0.
Estado/recibo não homologam imagem ou tempo. Próximo lote: offset live, raster
do sinal após crash e composição gráfica persistida/ownership (MANUAL pulado).
Não replay de external effects/históricos arbitrários. 6.2/10.1 abertos; totais
10 grupos 1/9; 53 5/26/22. scratch/group06-live-recovery-r53-20261010.json.

10/10 — r53 integrada: recusa de live após ACK só autoriza retry com decoder nativo
da tentativa e checkpoint/contexto/posse inalterados. Timeout/PVW/decoder antigo
não autorizam TAKE. 25 testes dirigidos/types/build PASS, server 97C072BB. Ensaios
nativos completos anteriores qm2i5F/JE25xA/VddK8F FAIL na recuperação PGM; nova
integração ainda sem prova nativa completa ou reconstrução. 6.2 aberto. Parcial
antes do ensaio, instalação sem teste solicitada. Totais: 10 grupos 1/9; 53 5/26/22.

10/10 — mxilhz PASS nativo emergência com imagem e áudio PCM decodificado no
receptor local: estéreo 48k nas três fases, zero seq/timestampgap/SSRCchange/
silêncio medido, RMS ~0.03531. PGM/origem/as-run preservados, replay não reativa.
Mesmos binários r52, sem novo build. Quatro testes do tooling/types PASS; não
qualifica reprodução audível/DAC/latência/hardware/browser/crash completo/soak.
Scopes do produto não alterados por este medidor. 6.2 aberto; 10 grupos 1/9,
53 checks 5/26/22. Evidência scratch/group06-native-emergency-audio-20261010.json.

10/10 — parcial r52 efetivamente gerada, 449805495 bytes, SHA256
8387ADFE0A8B2154CEA5732F9DB77A7CE5DDEB8D6379EC79299FAB511E26BEEF.
Server EEAFE7B6/engine AEBDED62/auxiliar ACL novo F2EA9F86. OcTLPd nativo PASS
emergência sobre raster SRT próprio em PGM, RESET retorna vídeo sem reiniciar
ocorrência/as-run; replay após RESET não reativa. Sem prova de áudio contínuo/
hardware/navegador/crash backend completo. Auxiliar ACL corrigido para novo arquivo
próprio em pasta Modify, sem WRITE_OWNER quando dono já é TokenUser; DACL exata
usuário/SYSTEM ainda verificada. 4 testes nativos e probe real PASS. Instalação
r52 NÃO testada; pacotes/evidências anteriores preservados. 10 grupos 1/9,
53 checks 5/26/22. Evidências scratch/group06-native-emergency-program-20261010.json
e scratch/build-r52-partial-20261010.json.

10/10 — novos recibos gráficos secundários vinculados a FIRING exato, reconciliação
transacional/auditada somente por terminal CONFIRMED/SIMULATED. Sem reenvio e sem
confundir falha de gravação com recusa do destino. 53 testes/types/build PASS;
ensaio mdcUFz de morte/reabertura de processo próprio simulado PASS, UNCERTAIN
continua protegido após revisão. Sem engine/crash backend completo/físico.
Legado sem vínculo/liberação auditada seguem pendentes. Compilado EEAFE7B6 no D:
em r52-server-dist; r52 instalador não gerado, último pacote r51 anterior ao lote.
10 grupos 1/9, 53 verificações 5/26/22. Evidência
scratch/group06-secondary-bound-reconciliation-20261010.json.

10/10 — r51 efetivamente gerada no D:/RPlayout-builds, servidor atual A1CFB1E1
compilado externamente (dist workspace anterior). 449803457 bytes, SHA256
6C0762FFF8B1C0ABF577A171C4E6C6326620B9B5D53D5E971857B48AD62AB273.
Proteção compartilhada agora também inclui FIRING secundário fora do trabalho
ativo na mesma conexão e revalidação antes do envio. 47 testes/types/build PASS;
liberação de órfãos/recuperação completa não implementadas por esse bloqueio.
Build parcial SEM instalação/ensaio funcional, edição/hash/estrutura conferidos;
hardware/UI remota/soak pendentes. Nenhum material apagado. 10 grupos 1/9,
53 checks 5/26/22. Evidência scratch/build-r51-partial-20261010.json e
scratch/group06-secondary-uncertainty-fence-20261010.json. Histórico abaixo.

10/10 — backend atual 720B8BFC: admissão reconstitui diagnóstico CRITICAL
deduplicado por evento FIRING/canal antes de engine; preserva reconhecimento,
não altera execução/não reenvia/não declara destino recuperado. 33 testes/types/
build PASS. Inclui fontes contexto/template anteriores, sem ensaio nativo novo.
Controle global/resolução de órfãos e recuperação completa não concluídos.
10 grupos 1/9; 53 checks 5/26/22. R51 não gerada por disco. Evidência
scratch/group06-secondary-unconfirmed-admission-20261010.json.

10/10 — runtime consulta confirmação FIRE exata para hold, DISMISS e retorno
manual; template publicado ausente não vira gráfico genérico. 34 testes PASS;
fonte posterior ao compilado, sem prova nativa nova. 6.2 aberto; 10 grupos 1/9,
53 checks 5/26/22. Evidência scratch/group06-secondary-runtime-context-20261010.json.

10/10 — recuperação gráfica secundária cercada por canal/execução/item/revisão
exata; NULL legado não autoriza revisão publicada. 13 testes do lote/types PASS.
Fonte posterior ao compilado A6EB6CDD, sem nova prova nativa/build. Recuperação
completa/órfãos/físicos continuam abertos; 6.2 em andamento. 10 grupos 1/9,
53 verificações 5/26/22. Evidência scratch/group06-secondary-restore-context-20261010.json.

10/10 — ensaio idle nativo 2ACuQn PASS, backend A6EB6CDD: pixels 16→125.5→16,
SHOW/HIDE confirmados, sem TAKE/as-run. Receptor do verificador agora retém dois
buffers (115200 bytes) em vez de gravar raw crescente; 85 quadros decodificados.
3 testes de captura/types PASS. Fixture corrigida ativa grade no runtime.
Não valida PGM com mídia, físicos, navegador ou recuperação completa; não é
otimização do preview/scopes do produto. 6.2 aberto; 10 grupos 1/9, 53 checks 5/26/22.
R51 não gerada por disco (11309056 livres/620000000 necessários); nada apagado.
Evidência scratch/group06-bounded-native-idle-20261010.json. Notas abaixo históricas.

10/10 — atualA6EB6CDD: grafismo secundário conserva janelaPGM e duração
restante; manual usa FIREframe, endrelative duração montada. SHOWexpirado
recusado, DISMISS exige FIREEXECUTED e propriedade de camada/evento/versão,
preservando substituição manual e outros grafismos.53testes distintos/types/
buildPASS, semnative/crashproof novo. Órfãos/restore/idlefixture/PGMemergência/
crashACK/failover/remote/físico/soak seguem abertos.53checks5/26/22;10grupos1/9.
R51 não gerada; nenhuma evidência/pacote removido.
Evidência scratch/group06-secondary-graphic-window-20261010.json.

10/10 — atualA1C1BF37: migração49 projeção de pendências gráfica transacional,
consulta indexada e histórico append-only. Startup/backup validam divergência;
legadopre49 legível e migrável.35testes/types/buildPASS. Caso5000 comandos local
134997→72325→2468ms; não prova soak/carga/disco físico. Backup com pendência
perdida recusado, ativo segueUNCERTAIN; rollbackmigração PASS. Fixtures de
ordenação e schemafake corrigidas. Upgrade/rollback49/ensaios nativos pendentes.
6.2/9.2/10.1 abertos,53checks5/26/22;10grupos1/9. R51 semZIP,36163584livres;
nenhum pacote/evidência removidos.
Evidência scratch/group06-graphic-pending-projection-20261010.json.

10/10 — atualED740649: apresentação idle com ledger/ACK/guardas e propriedade
por camada; retirada preserva grafismos manuais diferentes.81testes/types/build
PASS. NativeVLZ1b0/99BD0225 FAILfixture sem carregar grade, corrigido verificador
load-rundown, sem rerun por38744064livres<100000000seguro. Guarda statfs antes
de qualquer fixture/serviço. NÃO nativeproof do cortefinal ED740649.
Faltam ensaio idle corrigido/PGMmídia/crashACK/restore/failover/remoto/físico/soak.
6.2 aberto;53checks5/26/22;10grupos1/9. R51 semZIP, nenhum arquivo removido.
Evidência scratch/group06-idle-graphic-command-20261010.json.

10/10 — atual5F6C6417/webCkuhX6pK: emergênciaSHOW/RESET com ledger/ACK/guard
fresco de sessão/canal; template opacoSVGg, retirada limpa estado; callback
manual independente, política automática reconferida.51tests/types/buildPASS.
Edp5eQ/5F6C6417 PASS receiver320x180 pixels16→125.5→16, SHOW/RESETconfirmados,
replayativo nãoenvia, asrun0/semTAKE/owncleanup. Idleapresentação desarmada no
clear; AFTER_RESET sóunit. dHbMNZ/6Qe0C9 FAILcenário baseline/clear com idle,
não prova falha nem homologação do RESET completo com mídia. Faltam idlelegado,
PGMcomVT/live/emergência/crashACK/restore/failover/UIremota/físicos/soak.
6.2 aberto;53checks5/26/22;10grupos1/9. R51 semZIP/espaço, R50última real.
Evidência scratch/group06-emergency-graphic-command-20261010.json.

10/10 — atualserver29F82620: timers atravessam meia-noite e hold após ACK;
eventos gráficos secundários com ledger compartilhado. Incerteza bloqueia
intervenções novas e adia automáticos sem consumir deixa; simultâneos em ciclos
separados.60 casos distintos/types/build PASS; g536mG/29F82620 PASS engine/
receiverpixels16→125.5→16, expiração75frames CONFIRMED/replaysemreenvio/semTAKE/
asrun0/owncleanup. Timers meia-noite e conflitos testados localmente, não soak.
6.2 aberto: emergência/failover/fullcrashACK/restoreledger/órfãoslegados/clock/
carga/UIremota/físicos.53checks5/26/22;10grupos1/9. R51 não gerada, R50última.
Evidência scratch/group06-graphic-timing-coordination-20261010.json.

10/10 — atualserver11051AB5: deixas itemGraphics e expiração automática com
pedido durável/ACK, guarda de execução/emergência e composição antes do envio.
50 testes/types/build PASS. QUKi06/11051AB5 PASS SRTreceiver320x180 pixels
16→125.5→16; expiração75frames confirmou retirada sem HIDE manual; replaySHOW
não recoloca tarja, asrun0/semTAKE/owncleanup. Semhardware/externo/browser/livePGM.
6.2 aberto para ciclo completo emergência/failover, crashACK/UIremota/soak e
revisão de timers meia-noite/conflitos de ledger incerto.53checks5/26/22;
10grupos1/9. R51 não gerada; último pacote realR50 não inclui mudanças atuais.
Evidência scratch/group06-automatic-graphic-commands-20261010.json.

10/10 — último corte server3CF8E838: eventos secundários gráficos aguardam ACK
antes da camada ativa/EXECUTED. Guarda de item/execução/revisão e emergência
reconferida na fila; timeout após envio é incerto/FIRING e não se repete;
recusa nativa/pré-envio FAILED.45 testes/types/build PASS, não nativeproof novo.
Deixas itemGraphics e tick legados, emergência/failover/crash/remote/físicos
continuam abertos.53checks5/26/22;10grupos1/9;R51 não gerada.
Evidência scratch/group06-secondary-graphic-confirmation-20261010.json.

Ensaio anterior adicional cq3Lsz PASS: processos reais do ledger caem e reabrem banco;
ACCEPTED/SENDING bloqueiam revisão com dono vivo e reenvios; morto comprovado
permite conferência explícita sem reenviar; CONFIRMED persiste/idempotente.
Cinco verificações isoladas, sem comando nativo/servidor completo/browser/físico.
Falha inicial do verificador: carregador tsx não encontrado na raiz; corrigida
resolução a partir do pacote server. Não é falha nem sucesso do fluxo aplicativo.

10/10 —6.2 ledger manual integrado/server61F1EF53/webBbw4Fk4J: registro durável
antes de envio, confirmação depois de ACK, seleção criptografada, idempotência
sem reenvio. Resultado incerto bloqueia novos comandos; conferência explícita
não reenvia/não declara recuperação. Painel de histórico/revisão implementado.
28 testes distintos/build PASS. Dujmi5/61F1EF53 PASS pixels em receptor SRT
próprio320x180:16→125.5→16; SHOW repetido após HIDE não envia nem recoloca tarja.
Asrun0/semTAKE/owncleanup; não valida UI remota, hardware, destinos externos.
Faltam crash/restart dos recibos, falha/timeout nativo, legacyautomaticgraphics,
emergency/failover completo e homologação visual/física.6.2 segue em andamento.
Totais53checks5/26/22;10grupos1/9. R51 não gerada por espaço; R50 última real.
Evidência scratch/group06-graphic-command-ledger-20261010.json.

Registro anterior:10/10 —6.2 manualgraphic staging/ACK/commit +freshauthority/canal e queue;
emergencypending/active bloqueia overwrite, timersdefer, explicitchannel,
existingsamechanneltemplate e SIMULATED separado. SVGviewport normalizado e
currentLayer limpoemHIDE.81casos distintos PASS/types/buildfinal6AAC56FE PASS.
Nativepixel njD66w/A1F0D07D FAIL viewport640x360pequeno; lBCRTV/76941915 PASS
SRTreceiver320x180 mean16→125.5→16/showhideACK/asrun0/owncleanup/PGMsemTAKE.
Finalattr/selfclosing+identity unitPASS pós pixelproof, não reatribuirhash.
6.2 segue aberto: durablereceipt/uncertainty/audit, failed/timeout/restart,
legacyauto e emergency/failover/UI/remote/physical.10grupos1/9;53checks5/26/22.
R51nãoZIP espaço insuficiente; R50últimopacote não inclui esse lote.
Evidência group06-graphic-confirmation-20261010.json.

10/10 —lote6.3/server9C4ECF4F: expiry absoluta/fuso/invalidfailclosed;
limpeza independente startup/60s/100 auditada SESSION_EXPIRED+delete atômicos,
auditfailreverte e notoken/digest. Login bounded80/1024 e scrypt formato fixo.
41tests/types/build PASS; krMonQ/9C4ECF4F compiled PASS HTTP401, WS4401 após
expiry controlada noDB próprio, auditrollback/restartdedup/limits/owncleanup.
Não é12hsoak/UI/remota/upgrade.6.3 em andamento;53checks5/25/23;10grupos1/9.
R51 código inclui fila+security mas ZIP ainda não gerado:345571328livres
<620000000. R50 última build não contém esse lote. Não apagar releases.
Evidência group06-session-expiry-20261010.json.50tests fila e dwhgy4 permanecem
atribuídos ao anterior77A1FE1C; não reatribuir prova ao buildnovo9C4ECF4F.

10/10 —R51 integrada/server77A1FE1C: marca assinada de fechamento da
observação. Fila esvaziada antes de confirmar selo; crash/storagefail não
confirma. Admissão alerta histórico possivelmente incompleto viaCRITICAL,
audit/outbox atômicos/dedup. Não recupera snapshots voláteis.
50 testes fila/posse PASS/types/build PASS; dwhgy4 PASS callbacknative DBfault
SQLitetrigger→crash ownserver→admissiongap/outbox1→cleanstop→thirdstart sem
gapextra. Asrun0/ownfamilyexit. Não qualifica full-disk físico/sinais reais.
ZIPR51 NÃO gerado por espaço345608192bytes<620000000; nenhum pacote apagado.
R50 último artefato, não contém alteraçõesR51.9.2/10.1 abertos;10grupos1/9;
53checks5/24/24. Evidência group09-observation-closure-crash-20261010.json.

10/10 —R50/server4C56E221/engineAEBDED62: publisher possui retrySRT,
srtsink auto-reconnect desativado quando existe.46sn2P/8390A48C FAIL preservado:
receiver decode real mas nenhum incidente45s após fechar listener.
NBUFrt/AEBDED62 PASS: SRToutput→listener→H264decode320x180, perda real
retryinggen6 e retorno onAirgen7 com entrega nova; incidente/resolução noDB,
contexto/ACK original preservados, PGM nunca TAKE/asrun0/owncleanup.
Carrier preto com PGM parado; não valida editorial/áudio/destino externo.
17tests dirigidos distintos PASS/types/builds PASS; instalação não testada.
ZIP450449852bytes SHA256
A2CF183FC49CB721159140EA71EBC3E70C158E49A5084FEC460C6245F060BB80.
Registro externo posterior ao LEIA-ME interno.9.2 permanece em andamento;
próximo storage/crash/carga e qualificações físicas/remotas/prolongadas.
10grupos1/9;53checks5/24/24. Evidência group09-publisher-loss-return-20261010.json.

10/10 —R49: saída correlacionada por perfil+destino HMAC; geração nativa
identifica reset do contador e só novas entregas confirmam recuperação.
Exit notifica ausência de publishers mesmo sem fonte live; closed runtime
não publica observação após liberação.16 testes dirigidos distintos PASS
(14 ciclo,1 transporte,1 Rust); tipos servidor e builds servidor/engine PASS.
Server4C56E221/engine8390A48C. ZIP450445752bytes SHA256
40F9D82D73CB6B2CB0FBDCF1AE92D87BD2A9884A102EA2DDA7EB0C07C32A2841.
Instalação não testada. Receiver SRT próprio perda/retorno ainda em andamento;
entrega ao pad do sink não prova recepção externa.10grupos1/9;53checks5/24/24.

10/10 —R48/serverB868E6E8: collector mantém evento nativo mesmo quando read
dos nomes falha (N/D). Teste dirigido/types/build PASS. s0kvze PASS ciclo real
local SRT ingest/RTSPdecoder/SRTPVW/RTSPreceiver com PVW configurado; 428x240
antes/depois, emissor novoID após antigo parado, perda/incidente e recuperação
medida áudio+vídeo após re-CUE, contexto/ACK preservados, PGM nunca TAKE/asrun0.
Owncleanup confirmado. Sem prova automática de reconnect, hardware, NDI/OMT/
DeckLink, browser, remota ou soak. Instalação não testada.
R48ZIP450447001bytes SHA256
719F3913B42533E7B2D183A01027C2A0880DE8E86CF894AAED21F9536B80C8AC.
Tentativasu6Rcxy/wO8DFF/bmabeU não passaram; só s0kvze cobre ciclo completo.
9.2 continua em andamento;53checks5/24/24 e10grupos1/9.

10/10 —R47 entregue após aprovação restabelecida,450446977bytes SHA256
189E45ACF4C975DD4B6B65407EAE466FF67D2FB6FF67FD2CD66CAA767F78C473.
Server51CE5E4C/webDeUoJJaB/engine preservado;17tests dirigidos PASS,
types/build PASS. EnsaioAgZKD4 PASS LIMITADO captura CUEING e recusa de CUE
por PVW inexistente no fixture, não conexão SRT. CUE500/asrun0/ownexits,
API histórico sem endpoint. Configurar PVW e validar falha/retorno de sinal
continua pendente; hardware/remoto/soak/instalação não homologados.
Fonte LOST/FAILED invalida leitura antiga, sourceReady sem novo sample é
UNKNOWN; informativo não duplicaCRITICAL. Sem nova migração.
Não atribuir contexto antigo de bloqueio de aprovação ao estado atual.
Totais53:5/24/24;10grupos1/9,9.2 em andamento.

10/10 —9.2 R45: fontes PGM/PVW e publishers com incidentes correlacionados,
recuperação explícita, fim de observação sem resolver, contexto/ACK preservados,
HMAC, fila/auditoria atômicos, retenção e risco históricos. Recorder retém
snapshot original durante retry. 32 testes afetados distintos PASS; tipos/
build servidor PASS, web compilada. Ensaio final66rmAb/62573A62 PASS dois
servidores/engines próprios sucessivos, histórico sintético PGM/OUTPUT,
retirada sem recuperação, auditorias2/loopback2/asrun0/saída nula.
R45ZIP450445614bytes SHA256
7D95169C1A90CD6245246C5243B3D37DFEB8B2AD9285BB51F945B54E5675C9D5.
Sem teste instalação/homologação física/remota/soak. Falta capturar eventos
subsegundo, contratos informativos completos e revisar rótulos auxiliares do
painel. Reconciliação1s não prova captura de todas as transições rápidas.
Totais53:5/24/24;10grupos1/9. Não encerrar9.2 nem escopo global com essa prova.

10/10 —9.2 browser2iQ4an/final83CD413C/webCE4F4AF4 PASS contexto details,
anchorroot253 mantémhistóricoapósnovo/reset254, HANGdeadline10s, filtercancel
e retry;31READs max1ativa/4aborts/27complete/0activeclose, engineoff/asrun0.
R41ZIP450442256bytes SHA256A046D95C7A4DB5827F4C55EB1352D21873EE013B70F5626E04735EF8D32AD548,
semtesteinstalação.50testsdistintos PASS; nativeproducer09d78b13/ZWq3uF não
confundir comguardreadposterior83CD413C. Evidênciagroup09-incident-context-
polling-20261010.json/2PNGs. Faltalifecycleobservaçãoentreincarnações/alertas
fontesepublishers/homologaçõesfísicasremotasprolongadas;9.2 segueaberto.

10/10 —9.2 contexto operacional no instante da transição: item/edição/execução,
nomes seguros, fontes/saídas com identidadeHMAC, snapshot independente do retry.
Migração48 contexto cifrado nullable/índices, backup47/48readonly/canal validado.
Sem fabricar passado. DTOguard409 recusa canal/schema inválido. UI contexto
histórico e contagemunresolved/observationended/missingcontext; não prova física.
READs agregado10s/cancel/nooverlap, anchorroot atéMAISRECENTES; mutações não
canceladas.50casosdistintos PASS/tipos/buildambos; nativeZWq3uF contextAPI/fila48
PASS server09d78b13/engine1195A55A, DTOguarddirigido posterior PASS/serverbuild.
WebCizUtmS5/R41 parcial em geração, browser em andamento, não físico/remoto/soak.

10/10 —9.2 navegação real: remove recorte silencioso30/200, API keysetAT+ID
com ACL+filtros anteslimit, pendentes SQL canalinteiro, janela fixa e30/página.
18casosserver+2markup PASS/tipos/buildambos PASS. Compiledbrowseriyd3WO:
9páginas253eventos245históricossemduplicação, críticoalém200filtrado/ACK200
semresolver, outro canal ausente; engineoff/asrun0. CSV limitado10000 agora
explícito. WebC0-GhWvg/r40 em geração; não físico/remoto/soak/instalação.
Evidência group09-health-pagination-20261010.json e screenshot/browser-pages.

10/10 — visual9.2 local: Monitor→INCIDENTES DO CANAL→Saúde direto. ACK200
auditoria única semrecuperação; falha409 preserva pendência e aviso após polling.
Recuperação medida/fimobservação/ACK distintos na tela, outro canal não exibido.
Erro desaparecia na r38; estado separado corrigido, tipos/buildweb+2markup PASS.
Fixture0zjCDd engineoff/asrun0/ownserverexit; evidência
scratch/group09-health-browser-20261010.json/PNG. Web index-CwJTwjet, r39
em geração semtesteinstalação. Não físico/remoto/soak;9.2 não fechado.

10/10 —9.2 limites freeze: engine1195A55A expõe duração/idade de leitura de
vídeo; serverEFE3D1BA usa duração nativa sem debounce duplo. Bool2s legado
mantido; evento recente não valida leitura nativa antiga.16casosafetados PASS,
tipos/build server/engine PASS. NativecompiledQkkTMZ PASS600ms→627ms,7deliveries
8HTTP/503sameID/47API/recoverysemACK/ownexits. Controle saudável SMPTE móvel,
ball quasepreto da tentativa anterior gerou novo black; detector não alterado.
Não browser/físico/latência em todos perfis/soak. Evidência group09-native-freeze-
duration-20261010.json. R38 parcial em geração semtesteinstalação. Totais53:5/24/24.

10/10 —9.2 resolução separada de ACK (migração47): recovery medida atualiza
incidente original, idle marca apenas observação encerrada. Retenção não apaga
PGM reconhecido semresolver nem resolução/ACK recentes. Backup47 verificado,
CSV/UI mostram estados distintos.28 testesdistintos PASS/4files,tipos/build
server+web PASS. Nativecompiled8gzf19/600BA09D PASS originaisresolvedsemACK,
APIfields47/7deliveries8HTTPloopback/503sameID,ownserver/engineexit. Cópia real
preserva campos, corrupta recusada/origem intacta. Não browser/físico/soak;
r37 anterior não inclui47. Evidência group09-health-resolution-retention-
20261010.json. Totais53:5concluídas/24em andamento/24pendentes;10grupos1/9.

10/10 — 9.2 sinais PGM: sonda configurável→transições retidas→health/outbox
atômicos, identidade correlacionada, nenhum browser no caminho de detecção.
Métrica ausente/idle é desconhecido/unobserved, nunca recuperado. EventoPGM
antigo expira1500ms; silêncio fixo paralelo5s e warning textual black removidos.
Assinatura legada signal.recovered de silêncio mantida.35 testes distintos PASS,
tipos/build server+web PASS. Nativecompiled xZuRKJ/00A85CD0 PASS preto/silêncio,
branco congelado e ball saudável;gateway HTTPloopback7deliveries8requests com
503retry mesmoID; semintervençãoauto, ownserver/engineexit. Não físico/browser/
soak nem precisão de limites em todos perfis. Evidência group09-pgm-signal-
incidents-20261010.json. R37 continua anterior a este lote. Totais53:5/24/24.

10/10 — incidentes/reconhecimento (9.2) integrado: transação ACK+auditoria
com ator/evento/canal, replay preserva primeiro horário, não confirma recuperação;
ACL de lista/CSV antes do limite, escopo restrito não vê nem reconhece globais.
404 inexistente; falhas de audit/update e update ignorado não gravam ACK falso.
UI trata falha e estado pendente. 11 distintos PASS/2files, tipos/build server
e web PASS; compiled qDNRXG PASS persistência após restart/único ator/403/404/409,
engineoff/zero as-run/ownexit observado. Evidência group09-health-incidents-
20261010.json. Não prova browser/detecção física/destino externo. R37 é anterior
a este lote e permanece parcial semtesteinstalação. Marco9.2 em andamento;
totais53:5 concluídas/24 em andamento/24 pendentes,10grupos1concluído/9abertos.

09/10 — QC posicionamento/latência: qualidade gera somente quadro solicitado
com receita qc-frame-v3/seekACCURATE, início PAUSED e JPEG atomicamente publicado;
régua mantém bulk leve/cache separado.9HTTP+3lifecyclePASS,12nativePASS,tipos/
buildservidor/releaseprobePASS. NativeGOP125→4posições/timestamps correspondentes,
hashesdistintos,1JPEG porcall247–291ms; corrigida corrida detectada na prova
inicial(0quadros). HTTPcompiledFFV1 NVELC8firstquality845ms/1JPEG,zeroQC/asrun
PGMoffexit0. Não benchmark remoto ou certificação de corte quadro-exato do canal.
Evidência group03-qc-accurate-frame-20261009.json; nova parcialr36semtesteinstalação.

09/10 — fallback QC validado no browser com servidor/probe compilados atuais:
FFV1 próprio→JPEG original720x540, scopes; erro503 injetado apenas quadro5
em relay loopback→status/sem imagem/safe/medição anterior; retry→200 real;
retorno proxy320x240 ready4 mantém posição próxima1.12. Zero aprovações/as-run,
PGM desativado; não prova continuidade no ar. GiwZjw/79903exit0; evidência
group03-qc-fallback-browser-20261009.json e screenshots. R35 inclui lote;
instalador não testado. Fita24qualidade inicial7644ms, falta otimizar latência
e conferir precisão do seek/GOP longo; remota/hardware/allformats continuam abertos.

09/10 — QC fallback: amostra anterior não conserva medição de JPEG que falhou;
mensagem e retry explícitos sem miniatura em qualidade. Geometria da sonda usa
PAR e raster square-pixel sem upscale/matte, bounded UHD em ambos eixos.
Cache picture-v2 não substitui/relabela antigos. Testes50/5PASS e12nativosPASS,
tipos/buildPASS após reparo da fixture somente; replay9HTTPPASS. JPEGs reais
releaseCLI P5fHrvPASS4casos incluindo vertical UHD/SD anamórfico. Não prova
browserfallback nem HTTPcompilado (próxima evidência); não contido na r34.

09/10 — QC arquivos: fluxo compilado scan Unicode→ARCHIVE/PROXY com receita
picture-raster-v2→HTTP preview/original passou em três arquivos H264/AAC próprios.
Navegador local mostrou 16:9/4:3/vertical com raster efetivo, safe area somente
na imagem e padrão OFF, alternância proxy/original e reprodução. Zero decisões
QC/as-run; engine PGM não habilitado. Capturas scratch/qc-file-*-20261009.jpg.
Não cobre formatos adicionais, 4K/fallback, estação remota ou hardware físico.
Texto de ignorados corrigido para não confundir quarentena com rejeição QC;
compilado sem reteste visual. Parcial r34 sem teste do instalador por solicitação.

09/10 — edição manual verificada no servidor/engine compilados9466/Fayeei:
PATCH→recusa publicação enquanto CUE→limpeza explícita→freshreview→publicação→
re-CUE usa nova conexão, sem falsa atribuição cadastral, mantém execução/PGM
e revisão anterior, vídeo/áudio recentes nos dois buses. SRT loopback contínuo
próprio, não prova NDI/OMT/DeckLink/browser/PVW publicado. Evidência
group02-compiled-connection-edit-20261009.json. R30 não contém fixmanual;
serverA23DCA21... atual. Não revalidar código intacto por status; marcos iguais.

09/10 — prova compilada SRT contínuo loopback PASS(30490/nt3YN3), sem inputs
externos: identidade nativa porbus, vídeo/áudio recentes simultâneos após CUE,
histórico autônomo e STOP/cleanup. Não prova imagens publicadas/browser ou
hardware; publisherPVW idle. HTTP seleção/publicação/edição7 casos PASS após
replay só dos casos afetados. Corrigida fonte executável stale após edição
manual; tipos/build servidor PASS(A23DCA21...). R30 permanece anterior a esse
fix. Evidência group02-realtime-source-catalog-20261009.json. Nenhum marco de
homologação encerrado por teste local; totais iguais.

09/10 — verificação consolidada do vínculo:269 testes/10files e tipos PASS.
Ensaio compilado de fileURI LIVE não aprovado: histórico autônomo confirma
IDs/nomes nativos diferentes nos buses, mas posteriormente videoRecent false
em PGM/PVW. Diagnóstico de listener reparou preparo da fixture, não o critério
de vídeo. Evidência group02-source-identity-validation-20261009.json separa
testes verdes, eco nativo parcial e falha de sinal. Próximo ensaio deve usar
fonte contínua realtime; não equivale a DeckLink/NDI/OMT/SRT físico. R30 intacta.

09/10 — r30 parcial completa criada SEM testes funcionais após compilação
servidor/web/native PASS. ZIP536314854 bytes inclui novos lotes de identidade
e histórico; runtimebase r29 íntegro e binários atuais, manifesto novo. Método
streaming dispensa staging/payloadduplicados e preserva releases anteriores.
Evidência build-parcial-r30-20261009.json; SHA694967BEDAB1FE0E3F002217A5C72803A3FA248379ACCCA8A19EB3069EEB53AF.
Não prova instalação/funcionalidade/tipos/browser/hardware. Validação consolidada
é próxima ação após entrega da parcial; nenhum marco encerrado por compilar.

09/10 — vínculo cadastral em projetos: contrato valida opcionalidade/limites/
LIVE; migração45 reconfere a coluna ao reabrir. Seis casos escritos mas NÃO
executados (incluem legacy/explicit roundtrip); evidência
group02-source-binding-compatibility-20261009.json. Não prova restauração ou
compatibilidade compilada, não modifica marcos/totais. Parcial ainda não gerada.

09/10 — metadado cadastral no decoder implementado: ID opcional recebido na
spec, eco de Ready/Telemetry vem do bus montado, confirmação servidor requer
decoder/seleção atual. Atribuição histórica pode ser NATIVE_DECODER sem
confundir com sinal. Limpeza em nova abertura/restart/perda/falha e decoder PGM
substituído. Um teste novo/extensões escritos NÃO executados; Rust/tipos/build
também não executados. Evidência group02-native-source-identity-20261009.json.
Ainda sem prova compilada, integração, browser ou física. Totais iguais.

09/10 — 9.1 atribuições cadastrais PGM/PVW separadas no histórico: ID explícito
e endpoint do item correspondem ao cadastro scoped, ID histórico HMAC, nome
seguro e origem PUBLISHED_ITEM indicada. Não é atestado de identidade nativa
ou sinal. Dois testes escritos NÃO executados; sem tipos/build/pacote. Evidência
group09-source-bus-catalog-20261009.json. Próximo lote de validação inclui
migração45/rotas/publicação/histórico; browser e hardware continuam pendentes.

09/10 — persistência explícita da seleção implementada no modelo editorial:
configuredSourceId nullable via migração45, verificação transacional do cadastro
no canal com conexão exata e habilitado, edição manual desvincula, publicação
retém campo e proteção do item PGM considera identidade. Seis testes escritos
NÃO executados; sem typecheck/build neste lote por pedido de parcial antes
dos testes. Evidência group02-item-source-binding-20261009.json. Ainda sem
identidade no engine/telemetria, sem integração compilada/browser/hardware.
Não atualizar hashes de dist como se incluíssem o lote, não encerrar marcos.

09/10 — catálogo e seleção por canal: cadastros com mesmo endpoint deixam de
ser deduplicados; seletor usa configuredId separado da referência executável,
preserva nome escolhido e ignora respostas de outro escopo. HTTP filtra fontes
e convidados por permissões sem modificar cache. 37323:13 PASS/1 FAIL;
35125:replay único PASS após registro da rota parametrizada, tipos/build PASS;
63879:web-only build após ajuste de chave React. 14 testes distintos/5 arquivos.
Evidência group02-source-catalog-selection-20261009.json. Persistência do ID
na playlist/engine, browser, fontes físicas e fechamento 2/9.1 continuam abertos.
Nova parcial solicitada sem testes, mas não iniciada por espaço insuficiente
(256 MB livres para cerca de 2,5 GB mais temporários). Releases preservados.

09/10 — 9.1 retry/cancelamento UI integrado: consulta tem deadline10s, abort
em trocaescopo/unmount, atualizar/tentarnovamente mantém until/before da página;
forward bloqueado durante pedido, obsoletas ignoradas.86974:9testesmarkup/API/
tipos/webbuildPASS. WebBOzLKbgT/20AD077A; warning998.78kB. Server/engine intactos.
Tentativa navegador falhou no kernel/sandbox; reset+inventoryretry também
falhou. Nenhuma superfície operada, sem aprovação visual/Reacteffects real.
Testes confirmam SSR e propagação de AbortSignal, não timeout/retry interativo.
Evidência group09-operational-history-retry-ui-20261009.json. Next9.1 browser
quandohelperfuncionar, carga e sourcecatalog;10grupos1/9;53checks5/23/25.
R29 anteriorpreservada, sem novoinstaller.

09/10 — 9.1 retenção atômica: persistMetricHistory grava amostra/expira14dias
na mesma transação, eventoHOST relacionado também; cache/state só depois do
commit, sem servir sucesso não persistido após falha.84199:17testes3files/
tipos/serverbuildPASS; fronteira exata14dias, falhas DELETE/evento e retryreal
cobertos.96086/UEpxKJ compiladoPASS: timerlimpa fixture15dias, preserva payload
13dias, grava amostra realHOST/evento antes de métricasAPI; health0engines,
ownbackend/listener encerrados. Primeiro lançamento nãoexecutado por conexão
da revisão automática de permissão; mesma revisão repetida comsucesso, sem
bypass. Server6102916C; web/engine/installer intactos. Evidência scratch/
group09-operational-history-retention-20261009.json. Datas antigas injetadas,
não soak real14dias/carga representativa/browser/físico. Next9.1 carga/browser
e sourcecatalog inequívoco.10grupos1/9;53checks5/23/25 permanecem.

09/10 — 9.1 nomes/ID de perfil em coleta compilada79863/J7TgQH PASS:
TAKE VT real/edição/execução/PID, coletas automáticas antes de métricasAPI,
item VT São José e gravaçãolocalporperfil; renomeação só do DBfixture aparece
na coleta seguinte com mesmoID opaco, payload anterior intacto e ambos nomes
visíveis na APIhistórica. Gravação realprobe500vídeo/938áudio, fonte750/1408;
STOP/ownprocessos encerrados. CPU22813ms/RAM219422720bytes desta execução,
não benchmark. ServerFA763CE3 inalterado, sem rebuild/testesunit/installer.
Evidência scratch/group09-operational-history-labels-compiled-20261009.json.
Não prova APIdeedição dos perfis, nomes das fontes cadastradas, navegador,
retenção/carga ou NDI/OMT/DeckLink físico. R29 anteriorimutável. Next9.1:
fonte cadastro inequívoco/captura real, browser, retenção/carga.10grupos1/9;
53checks5/23/25,9.1continua em andamento.

09/10 — 9.1 identidades/endereços duplicados: PublisherState preserva outputId
nativo jáexistente; métricas HMAC por canal/perfil, distinto mesmo destino e
estável após troca de alvo. Nome por ID só se alvo também corresponde; semID
continua identidadeendpoint com aviso. Catálogo de fontes/saídas duplicado
marcaambiguidade/remove nome, não escolhe último cadastro. Fonte não cadastrada
não empresta mais título do primeiro item; item mantém título publicado próprio.
UI ambiguidade explícita/legado sem retropreencher.81202:129testes4files/tipos/
buildserverwebPASS. ServerFA763CE3; webxYx9G1Xp/D45E6638,warning998.36kB.
Evidência group09-operational-history-identities-20261009.json. Prova de
transporte simulado/unit/markup, não captura compilada/native real deste lote.
Entrada nativa ainda reporta identidade físicaendpoint, não IDcadastral; cadastro
ambíguo fica explícito até existir essa vinculação. Faltam captura compilada de
nomes/IDs, navegador/retenção/carga. R29 anteriorimutável;10grupos1/9;53checks5/23/25.

09/10 — 9.1 nomes históricos integrados: item da executionView, fonte cadastrada
por canal com fallback título publicado, saída por alvo exato incluindo perfis
gerenciados. Rótulos congelados na amostra, legados sem nome explícitos; acentos
preservados,160caracteres, URL/caminho/padrão credencial rejeitados. Falha de
lookup deixa nomes ausentes sem apagar telemetria. Nenhuma descoberta/CUE.
35661:16testes3files/tipos/serverwebbuildPASS. Server492235A5; webBljo9G6s/
D670DE0D; warning998.10kB permanece. Evidência group09-operational-history-
labels-20261009.json. Prova unitária/markup, não coleta de nomes via bootstrap
compilado nem navegador. Alvos duplicados ainda exigem desambiguação por ID;
fontes sem cadastro/título continuam sem nome. Faltam integração real de nomes,
retenção/carga/browser; totais10grupos1/9;53checks5/23/25. R29imutável/anterior.

09/10 — 9.1 paginação HTTP compilada32787/1qiTXX PASS com2413amostras
históricas sintéticas/21páginas/sem duplicação, janela fixa exclui coleta nova,
cursor inválido recusa, ACLcanal/global/sem autenticação e privacidade mantidas;
payloads históricos preservados, health0engines, ownbackend/listener encerrados.
Primeiro97907/FdBUtQ FAIL na expectativa do verificador de /api/processes200
para conta restrita; regra real403 correta preservada, só fixture ajustada.
Server5C11086E inalterado; sem unidades/tipos/build repetidos. Evidência scratch/
group09-operational-history-pagination-compiled-20261009.json. Maior resposta
observada100ms é dado desta fixture, não benchmarkprodução. Não prova retenção
14dias, soak, navegador ou sinais físicos. R29anteriorimutável/sem novo pacote.
Next9.1: interação UI, retenção/carga representativa e nomes históricos amigáveis.
Totais10grupos1/9;53checks5/23/25 inalterados;9.1continua em andamento.

09/10 — 9.1 navegação histórica por cursor integrada e compilada: APIcanal
aceita until/before validados, janela fixa e cursor exclusivo no índice existente
sampled_at; retorna nextBefore/total sem expor recursos globais ou mudar ACL.
Interface permite anteriores/voltar/recentes, mantém páginas antigas sem polling
e descarta respostas obsoletas por cleanup. Rodada30646:10testes3arquivosPASS,
tipos server/web e buildPASS. Server5C11086E; webindex-DFDCDoiH/097E8F7B;
warning997.89kB permanece. Testes provam cursor exclusivo/limites/janela fixa,
ACL/privacidade, markup/API, não execução de efeitos React/browser nem carga.
Evidência scratch/group09-operational-history-pagination-20261009.json.
Nativo67423 foi ANTES da paginação; não homologa nova rota compilada.
R29 imutável/anterior a esta alteração, sem novo instalador. Falta navegador,
integração compilada da paginação, retenção/carga e nomes históricos amigáveis.
Totais10grupos1/9;53checks5/23/25;9.1continua em andamento.

09/10 — 9.1 ensaio compilado67423/ACEBbN PASS após entregar r29: engine real
com URI sintética tratadaLIVE/saída nula. Coleta automática observada no SQLite
ANTES de consultar métricasAPI; edição/execução/PID/PGM vídeo correlacionados,
CPU4781ms/RAM60760064bytes medidos. APIcanal não expõe recursos globais/URI;
STOP e encerramento dos processos próprios confirmados. Inicial comando na
raiz não achou tsx; replay só do comando usando executor jáinstalado no server.
ServerAE648587 da r29, sem novo build para o ensaio. Evidência scratch/group09-
operational-history-native-20261009.json. Não prova navegador/retenção/carga/
NDI/OMT/DeckLink físicos; paginação posterior não coberta por esse ensaio.
Totais10grupos1/9;53checks5/23/25 inalterados,9.1continua em andamento.

09/10 — parcial r29 solicitada imediatamente após integrar o histórico por
canal. Compilação web/servidor/engine e pacote com runtimes concluídos, sem
novos testes funcionais. Instalador ZIP concluído: release/
RPlayout-1.1-parcial-20261009-r29-instalador.zip, 536190650 bytes,
SHA256 7139917D4A9920EBA74FC5D27C42F7BEA494EB893BE3BF210377E86DCB436B2B;
manifesto
NOT_RUN_PARTIAL_BUILD. Inclui recuperação explícita de reserva e correção da
identidade de live restaurada, posteriores à r28; r28 preservada.
Preparado --metrics-only no verificador existente para observar persistência
automática antes de consultar a API, correlacionar edição/execução/PID/PGM e
verificar privacidade. Esse cenário ainda NÃO foi executado; não usar como
evidência de aprovação. Nenhum marco fechado: 10grupos1/9;53checks5/23/25.
Espaço livre após compactação:328765440bytes. Preservar releases; não iniciar
novas cópias grandes sem espaço. Detalhes em scratch/build-parcial-r29-20261009.json.

Grupo9.1 — painel histórico por canal integrado na interface de engenharia:
OperationalHistoryPanel/Table usa APItyped e consulta independente dos recursos
globais. Seleção de canal/janela, item/edição/execução/engine/processCPUacumulada/
RAM/fontes/saídas; N-D/legacy/falha/truncado explícitos. Timer15s sem overlap,
query keyed por escopo + cleanup implementados; SSR não prova interação.
44704:5testesSSR/API PASS, tipos/buildwebPASS. Web7464E269, serverAE648587
intacto/não revalidado. Warningbundle997kB permanece. Evidência group09-
operational-history-ui-20261009.json. Falta browser, compiledenginehistory,
retenção/carga e janela histórica ampliada; últimos120comwarning não cobrem
14diasinteiros. IDs estáveis, não nomes históricos homologados. Totais5/23/25
inalterados; r28 antiga preservada, sem novo pacote.

Grupo9.1 — histórico operacional correlacionado integrado no backend: coleta
host existente10s/14dias recebe canal/item/edição/execução/engine, CPU acumulada
e RAM de processos disponíveis, fontes/saídas sem URLs/diagnósticos privados.
HMAC também em IDs source: do QC; limites256canais/128fontes/128saídas com
truncamento explícito. Nenhum runtime/fonte/processo criado pela observação.
Histórico por canal /api/channels/:id/operational-metrics/history exige sessão/
canal/REPORT_EXPORT e não retorna recursos globais. ACLglobal existente mantida.
11casosdistintos4files cobertos, com falhas/reparos dirigidos registrados;
15561tipos/buildPASS serverAE648587. Evidência group09-operational-metric-
history-20261009.json. OShost real; correlação engine fixture/HTTPinjetado,
sem prova compilada/visual/carga/física. 9.1 pendente -> andamento: totals
10grupos1fechado9abertos;53checks5/23/25. r28 anteriorimutável, nenhuminstaller.

Grupo9.3 — live restaurada sem vídeo:46615/pakt0d compiledPASS com mesmo
server6FEB705E, sem recompilar/repetir unidades. Backup de TAKE live real,
sourcecrash/exit observado; endpoint gerado desta execução passa a áudio-only,
probe0vídeo/1408áudio. Ativação recusa/sai1 antes de HTTP operacional, journal
FAILED/ready-resumedvazios, cursor/asrun/receipt/edition/origin preservados,
reserva liberada e ownprocessos encerrados. Evidência group09-restored-live-
no-video-20261009.json. URI sintética local, NÃO NDI/OMT/SDIfísico/cleaninstall.
FrozenPGM/unknownspawn ainda pendentes; totais5/22/26 iguais, r28 intacta.

Grupo9.3 — live restaurada e identidade no primeiro quadro: nova confirmação
exige vídeo recente PGM nativo/itemexato; ACK/PVW/simulação não liberam.
Ensaio inicial79051/LaA6Gn FAIL encontrou troca indevida de executionId após
ACK antes do firstPGM. Corrigido EngineTransport.recover mantendo cursor até
confirmTake.64924:113testesafetados/tipos/buildPASS;145distintos4files com36
anteriores (4checkpoint sobrepostos, não149). Tipos inicialmente falharam em
import/readonlyfixtures; reparados sem repetir testes inalterados. Replay
compiladoRSgpBk PASS: livePGM backup real + queda própria/saída native, cursor
52->53, mesma edição/execID/asrunRESTART/start52, vídeo/áudio recentes noPGM,
STOP confirmado. Fonte sintética FILE_URI_TREATED_AS_LIVE, não rede/hardware.
Server6FEB705E; r28 anteriorimutável. Evidência group09-restored-live-activation-
20261009.json. Sem vídeo gate unitcoberto, compiledfailure ainda pendente.
FrozenPGM/unknownspawn/físico permanecem pendentes; totais5/22/26 iguais.

Grupo9.3 — recuperação de reserva após queda: comando offline explícito
recover-restored-reservation.cjs exige manifesto/cofre, exclusão nativa real,
ausência local do detentor/backend e predecessor de distribuição liberado.
Liberação + auditoria atômicas, sem engine/TAKE/alteração de cursor/origem.
STARTING só viraFAILED com identidade correspondente; auditrollback coberto
em unitfixtures.49087:64testes4files/tipos/buildPASS.26505/VGeZHU compiledPASS
com stagecrash real, repairvivo recusado, reserva durável/partidanormalrecusa,
liberaçãoauditada e novo stage admitido, snapshotCP/asrun/owner/origin/receipt
preservado. CLIshaEC3F18A9; sem engine novo ou físico neste ensaio. Unknownspawn
continua bloqueado, crash exato STARTING ainda não verificado compilado.
Evidência scratch/group09-restored-reservation-recovery-20261009.json.
r28 intacta/anterior ao comando novo; totais permanecem5/22/26.

Grupo9.3 — backup durante PGM e retomada compilada real:40648/icxJWi PASS,
scratch/group09-restored-playing-activation-20261009.json. Mídia sintética
codificada + probe nativo750buffersvídeo/1408áudio, servidor normal faz TAKE
real e backupAPI em reprodução. Após queda própria e saída nativa observada,
restoreCLI/activate-restored retomam posição49 e corte25..725, mesma edição,
execução/cadência/barramento, owner novo assinado e journalCONFIRMED. Asrun
RESTART/start49 e STOP confirmados; processos próprios encerrados. Saída nula,
sem sinais físicos/browser/paused/live/HA. Produto/serverE5D264BF intactos,
sem repetir testes/build anteriores. r28 imutável. Marcos permanecem5/22/26.

Grupo9.3 — ativação restaurada explícita: --activate-restored integrado com
mesma reserva/fence, revalidação e diário44 STARTING/CONFIRMED/FAILED assinado.
Confirmação arquiva origem atomicamente com auditoria; falha mantém proteção.
Lote70344:64/64 testes6files/tipos/buildPASS. r28 gerada a pedido SEM novos
testes antes de empacotar. Depois88940/EhhStp compiledPASS engine nativo real
saída nula, inicialização idle, histórico/origem preservados, shutdown libera
reserva. Sem playingcursor/TAKE: não comprova retomada PGM ou sinais físicos.
Pausado/congelado ainda recusado com preservação, suporte pendente. Evidência
scratch/group09-restored-native-activation-20261009.json. serverE5D264BF/
review2EA68CCB; r28ZIP A60E4530. Próximo: cursor nativo playing real, frozenPGM,
live real e reserva incerta. Totais mantidos10grupos1/9;53verificações5/22/26.
As seções históricas abaixo mantêm atribuição às versões anteriores.

Grupo9.3 — handoff de backend em quarentena: evidência
scratch/group09-restored-backend-handoff-20261009.json. Ferramentas restabelecidas;
fonte relida, tentativa anterior recusada por limite não estava aplicada.
Capacidade local não serializável, WeakSet, uso único e fingerprint bloqueiam
falsificação/replay/drift. Reserva assinada verifica arquivo/epoch; bootstrap
registra instância e auditoria criptografada na mesma transação. Mantém
MAINTENANCE durante vida do backend e transfere conexão, sem abrir janela para
peer; reaproveita MESMO hostFence/processo. server.cjs --stage-restored MANIFEST
abre backend HTTP completo em quarentena, não um stub nem ativação operacional.
21867:32casos/4files/tipos/buildPASS.10776/xSm9g5 compiledPASS hostguard real,
instância/auditoria/reserva retida, peer mesmoDB recusado antes de bootstrap e
peer outroDB recusado pela trava nativa; shutdown real do produto dirigido por
IPC de teste fecha storage e libera reserva. Não é prova de sinal OS Windows.
Quarentena/edição/recibo/cursor/posse anteriores preservados, nenhumengine/TAKE.
Server203EB293/reviewDA278D2D; native/web intactos; r27 anterior. Ainda falta
etapa de ativação auditada com revalidação, recuperação nativa e SIGNAL_OK de
lives; reserva interrompida não é roubada nem reparada por timeout. Compilado
positivo sem cursor playing, metadados de sonda anterior e SHA atual, nenhuma
homologação física. Totais10grupos1fechado9abertos;53checks5/22/26.

Grupo9.3 — preparação nativa restaurada: evidência
scratch/group09-restored-execution-preparation-20261009.json. Comando compilado
review-restored.cjs usa reserva42 e host guard real, autentica manifesto43,
integridade/FK/cofre/ledgers e predecessor pelo mesmo contrato de claim global.
Plano exato de partida (cursor nativo ou primeira grade), edição única publicada,
cadência/áudio/corte, QC atual por canal e SHA via archive/cache/original; mudança
de banco durante awaits recusa. Resultado REVIEWED_NOT_ACTIVATED, reserva
liberada ao final, sem autoridade transferível, remoção de quarentena ou TAKE.
30696:29PASS/10FAIL de39casos4files por fixture sem loop; replay dirigido18139
10PASS após corrigir fixture e acrescentar checks integridade/ledgers só no
novo módulo. Tipos inicialmenteFAIL por this do mock, corrigida só anotação;
21857 tipos/buildPASS. Verificador reparado por importcontext e duraçãoNs real
(não fabricar durationFrames).23966/fwuRzk PASS comando compilado com hostguard
real,1canal/1plano/1SHA conferido, cursor legado e helper ausente recusados,
quarentena/histórico/edição/cursores/posse preservados. Sem cursor playing no
positivo compilado; cortes/retomada só fixtures unitárias, guard substituído.
Metadados de sonda real anterior, sem nova sonda; nenhumengine/TAKE/PGM aberto.
ServerC3C56E44/review291786CE. Pacote futuro exige novo comando; r27 anterior.
Falta ativação suportada/handoff mantendo fence, revalidação e recuperação real
do engine, live SIGNAL_OK, auditoria e fluxos físicos.53checks5/22/26,10grupos
1 fechado9 abertos; preparação não fecha9.3 nem re-homologa grupos anteriores.

Grupo9.3 — identidade da restauração: evidência
scratch/group09-restoration-receipt-binding-20261009.json. Migração43 histórico
imutável de recibos assinados; restoreCLI vincula relatório completo ao novo
banco antes da publicação exclusiva. Restauro sucessivo preserva histórico e
acrescenta identidade nova. verifyRestorationManifest autentica envelope externo,
confere JSON público e exige recibo MAIS RECENTE do banco. Relatório válido mas
anterior/outro banco não autoriza ativação. Cofre errado/assinatura/proteção
ausente/links recusados; startup antigo sem recibo não inventa procedência.
20191:33 testes/4 arquivos, tipos/build PASS.36453/yPCRzW CLI compilado PASS
nova origem, vinculação e segunda recuperação, manifesto anterior recusado,
destino existente/cofre ausente/errado/backup estrangeiro/junção/ACL recusados,
arquivos originais preservados. Comparação manifesto/banco pelo módulo fonte
no verificador, não comando de ativação compilado; não iniciou servidores.
Server04BCDBFC/CLI AE2284CF. Não repetidos native/web/sonda/TAKE inalterados;
evidência anterior de serviço compilado mantém hashes anteriores. Nada prova
parada nativa, mídia/QC/cursor, handoff, PGM físico ou promoção; comando de
ativação e integração dessa verificação continuam pendentes. Totais10 grupos
1 fechado9 abertos;53 verificações5/22/26. r27 antigo imutável.

Grupo9.3 — admissão de manutenção: evidência
scratch/group09-storage-maintenance-admission-20261009.json. Migração42 reserva
assinada/durável OPEN/MAINTENANCE com revisão e identidade por encarnação.
Registro de backend e migrações agora compartilham transação imediata; partida
recusada antes dos workers durante reserva. Sem expiração/roubo automático;
detentor antigo não libera geração diferente. Fechamento41 exige boot original.
Limpeza de plaintext/VACUUM segue depois do commit, com backend já registrado.
25883:56 PASS/1 FAIL em57 casos/7 arquivos. Fixture histórica removia fila mas
mantinha37: corrigida somente montagem, replay do único caso54185 PASS.
Cobertura distinta57, não58; tipos/build PASS. Ensaio compilado54185/aleVtT
PASS: duas instâncias, reserva bloqueia nova partida sem registro novo,
backup reservado autenticado, liberação pelo detentor admite sucessor de
conferência, quarentena preservada.61679/FoNBgd PASS restauração compilada+
restart/cofre/mídia/scanner/probe50vídeo97áudio/edições/cursor/asrun/filas,
registros importados assinados e instância viva impedindo reserva; nenhumPOST.
Server7466EAAB/CLI39099EEB. NÃO é comando operacional de ativação nem prova de
engine parado, fence físico, posse canal, QC/mídia/cursor homologado; todos
continuam necessários. Teste na mesma conta/host; native/web inalterados, r27
anterior. Totais:10 grupos1 fechado9 abertos;53 checks5/22/26,9.3 em andamento.

Grupo9.3 — instâncias de armazenamento: evidência
scratch/group09-server-instance-lifecycle-20261009.json. Migração41 registra
encarnações assinadas do backend antes dos workers e valida registros no backup.
STORAGE_CLOSED não comprova morte: processo vivo, remoto, reutilizado ou sem
permissão segue protegido; somente ausência local ESRCH conta como ausência.
27 casos/5 arquivos, tipos/build PASS35435. Mesmo lote: restore compilado
BeHU38 PASS preservando mídia, cofre, fila, publicação, cursor e as-run;
asserções novas de registro adicionadas ao roteiro depois não foram executadas.
Ensaio dirigido78772/9adpXk PASS: dois servidores compilados, encarnações
distintas, saída de um não libera o outro, registros assinados preservados e
validados no backup, consulta sem mutação, processos próprios encerrados.
Server48F9400D/restoreCLI47D1D9CC; native/web inalterados, r27 anterior.
Não existe ainda liberação operacional: falta admissão atômica contra novo
backend, posse nativa/host/canal e comprovação de mídia/QC/cursor. Não é prova
de parada dos filhos, promoção ou PGM físico. Totais inalterados:10 grupos,
1 fechado/9 abertos;53 verificações,5 concluídas/22 andamento/26 pendentes.

Grupo9.3 — chave compartilhada: evidência
scratch/group09-backup-shared-key-20261009.json.20332/M9Pjse PASS banco protegido
criado desde origem com keyenv, restoreCLI real modoSHARED_ENVIRONMENT sem
vaultfile substituto; ciphertext/backup bytes intactos. Chave ausente/errada
recusada antes de mkdir no restore e antes de abrir serviço; configuração
protegida intacta. Chave correta sobe compilado e sessão consulta configuração
protegida/sanitizada; key sóENV, nãoargs/logs. Processos próprios encerrados.
Separadas pastas/processos, mas MESMA conta Windows/host: não outrohost/conta,
rekeyDPAPI, recuperação sem chave, PGM/hardware/Windowslimpo/UI. Nenhuma
mudança do produto/build/retest dos grupos anteriores; server8EE96B53 e
restoreCLID447CBB4 preservam atribuição. Assert rawreport semkey/secret foi
acrescentado ao roteiro depois da rodada, ainda não executado; não somar prova
por flag declarada no JSON. Quarentena/promoção segura ainda aberta.
9.3 andamento, totais10grupos1 fechado9 abertos;53checks5/22/26, r27 anterior.

Grupo9.3 — estado operacional do backup: evidência
scratch/group09-backup-operational-state-20261009.json. Backup/restore agora
inventariam cursores (inclusive playing), edições/ativas e as-run/abertos;
executionResumeAllowed semprefalse. Payload de cursor malformado/foreignchannel
recusado readonly; resumo não atesta posse nativa/QC/media/parada do predecessor.
21 casos/3 arquivos/tipos/build PASS42423. Compilado inicialKdWnjR FAIL fixture
CP duplicado pelo runtime simulado; somente montagem mudou, canal passa a ser
criado após bootstrap.84054/WaR9Av PASS2 edições pelo planner real (ativa e
superseded), cursor playing e2 asrun (um aberto) importados preservados porbytes
após restoreCLI+restart, ediçãoativaAPI e resumo correspondentes. Cursor/asrun
são fixtures históricas, não TAKE físico; publicação não homologa UI/QC físico.
APImídia hash/cofre/sessão/scanner/probe50vídeo97áudio/jobs/scanrevision/TAKEscan
refusedaudit/zeroPOST/filhos próprios encerrados mantidos no mesmo ensaio.
Server8EE96B53/restoreCLID447CBB4; native/web intactos, r27 anterior.
Liberação operacional segura, shared-env/outrohost/conta/Windowslimpo/browser
continuam pendentes.9.3 andamento; totais53checks5/22/26,10grupos1fechado9abertos.

Grupo9.3 — quarentena dos workers restaurados: evidência
scratch/group09-restored-worker-quarantine-20261009.json. Marker fail-closed
mesmo vazio; media/mix/scanner construtores e novos claims/retry/record bloqueados,
proxy reader não reclassifica job; bootstrap timers automação/backup/HA/retention
bloqueados, telemetria não enfileira webhook. Mutação API recusada exceto auth e
backup manual com permissões normais; recusas continuam auditadas. Não DB
integralmente read-only nem rollback de tarefas já ativas antes de marker.
45673:83PASS/1FAIL nova fixture mediajob semasset/versão duplicada, sófixture
corrigida;57427 dirigido1PASS.84 distintos/5 arquivos, tipos/buildPASS.
ServidorDF7515AB; restoreCLI30C75A3D intacto. CompiladoTXiTG9 FAIL roteiro negava
auditoria correta das recusas;15654/OCBRCg parcialmentePASS workers, mas rotaTAKE
inexistente não comprovava transporte real. Correção sóroteiro;42082/mxvxGq PASS
transport actiontake/scan409 com auditroute/status protegidos, jobs/revisõesscan/
fila/grade intactos, APIbackup/CLI/retomada+restart/cofre/sessão/mídia hash/probe
50vídeo97áudio/zeroPOST, filhos próprios encerrados. Jobs interrompidos seeded,
scan/mídia real; sem físico/browser/HA/outro host/conta. Publicado/cursor/asrun
ainda não comprovados nesta fixture. Native/web intactos; r27 anterior.
Totais10grupos1 fechado/9 abertos;53checks5/22/26;9.3 permanece andamento.

Grupo9.3 — ferramenta suportada de restauração: evidência
scratch/group09-supported-backup-restore-20261009.json. restore-backup.cjs
compilado e launcher PowerShell entram no próximo pacote/verificador obrigatório.
Só pasta nova: sem overwrite, chave inventada, remapeamento de mídia ou TAKE.
Validação readonly/hash/identidade, SQLitecopy parcial, marker de quarentena,
cofre/relatório com ACL nativa; publicação exclusiva de DB próprio. Falha mantém
parcial para diagnóstico. Documentação RESTAURACAO-DE-BACKUP.md.
86133:11 unitPASS mas tiposFAIL revelou9 casos negativos mal parametrizados;
objetos corrigidos,73659 dirigido9PASS+tiposPASS.2 casos válidos intactos não
repetidos;11 distintos comprovados, não20. Produto/build não alterado pelo replay.
Build86133 PASS restoreCLI30C75A3D/server57D3C16C. Compilado86133/oc4GkM PASS
APIbackup/CLI real/existingdestrefused/cofre+sessão/retomada+restart/scanner+
probe50vídeo97áudio/mídiaAPIhash/fila/semPOST/filhos próprios encerrados.
84713/FXb2MZ dirigido CLI PASS marker criado em cópia antes sem marker,
destino existente intacto/chave errada/semcofre/sembackup/DBestrangeiro/junção/
ACLhelperausente recusados; parcial próprio quarantined preservado, nenhumservidor.
Launcher sintaxePASS, não instalado. Shared-env suportado sem keyfile/argumento,
sucesso emoutra conta/host ainda não testado. Publicado/cursor/asrun/jobs,
upgrade/UI/promoção física continuam abertos. Web/native intactos, r27 anterior.
Totais53checks5/22/26;10grupos1 fechado/9 abertos,9.3 andamento.

Grupo9.3 — retomada compilada em ensaio: evidência
scratch/group09-backup-service-restore-20261009.json. IntegrationOutbox bloqueia
recover construtor/start/tick/claim em banco com ha_recovery_origin; marker
instalado antes dos workers. Não desfaz POST já iniciado antes de um marker.
14 testes distintos/1 arquivo, tipos/build servidor PASS92452; atual57D3C16C.
Roteiro inicialmente falhou no import de better-sqlite3, reparado via pacote
servidor;92216/wmptCm falhou exigindo rundown runtime em quarentena, trocado por
simulação editorial sem afrouxar fences.97089/RK41Lv PASS: backup API real,
scanner real de vídeo Unicode, cofre original copiado, chave errada recusada
sem substituir dados protegidos, serviço compilado sobe e reinicia, sessão e
mídia original autenticadas, hash preservado, probe50 vídeo/97 áudio, fila e
referências/auditoria preservadas, zero POST, diagnóstico distribuição bloqueada.
Todos processos/listener próprios encerrados. Mesma conta Windows, fonte própria
quarentenada, sem engine/outputs; não operação física/PGM/outro host/conta/Windows
limpo/browser. Fixture não cobre revisões publicadas/as-run/checkpoints ou
retomada de jobs de mídia. Falta workflow suportado de restore/upgrade e gates
operacionais dessas edições.9.3 permanece andamento; totais5/22/26 em53,
10 grupos1 fechado/9 abertos. r27 anterior imutável. Web/native não alterados.

Grupo9.3 — restauração iniciada: evidência
scratch/group09-backup-revision-validation-20261009.json. O verificador readonly
agora confere revisões de categorias/integrações/pastas/scanner (36/37/38/40),
contadores, triggers presentes, registro de migração e versões de entregas.
Backup parcialmente migrado não passa por legado; tombstone legítimo preservado.
21 testes distintos/6 arquivos PASS, tipos e build servidor PASS (24336);
server63A54E86. Original permanece byte a byte intacto. Não valida conteúdo SQL
exato dos triggers nem deduz histórico de tombstones apagados. Ainda faltam
retomada do servidor compilado restaurado, cofre e mídia em ensaio isolado;
não é fechamento9.3 nem prova de HA/PGM físico. Web/native intactos, não retestados.
r27 imutável anterior ao lote. Totais10 grupos1 fechado/9 abertos;
53 verificações5 concluídas/22 em andamento/26 pendentes.

Grupo6.5 — reservas de execução/distribuição: evidência
scratch/group06-execution-distribution-diagnostics-20261009.json. Diagnóstico
estruturado sem coordenadas para local/remoto/spawn/legado/liberação/host fence/
ensaio/canal bloqueador. Registro inválido retorna409 privado sem reparo.
Consulta manual nas duas telas de configurações, sem mutação/promoção/polling,
dados antigos ocultos por chave/generation. Instância encerrada mostra bloqueio
coerente com claim recusado; demais fences não afrouxados.18419:64PASS/2FAIL
expectativas novas incorretas;27115 replay4PASS (inclui seleção nova),67 distintos
cobertos. Tipos servidor/web/build PASS; atual9BDEFB10/2E79965F. Compilado87140
FAIL roteiro esperava global409 apesar de outro canal já bloquear; reparado
roteiro, replay74659/XGChS2 PASS read-only/dois próprios/fixtures/invalid409
específico/global protegido/canal e sessão/sem dados alterados/semPOST. Não
native engines/sinais/browser/PGM/hardware. Native intacto, r27 predates lote.
Reparo legado coordenado e visual continuam pendentes. Totais10 grupos1 fechado/
9 abertos;53 checks5 concluídos/21 andamento/27 pendentes. Bundle grande mantido.

Grupo6.5 — overview de integrações com acesso: evidência
scratch/group06-integration-overview-scope-20261009.json. Diagnóstico visível
na lista, sem precisar abrir cada pedido; projection explícita sem owner/
target/payload, redige URL/credenciais em erro legado sem mudar armazenamento.
Consulta read-only e private no-store, autoridade fresca; filtro SQL antes100
por canal da entrega e configuração; conta restrita sem global/órfão/owner
de outro canal.29 distintos/5 arquivos/tipos servidor/web/build PASS26363.
Compilado70032/DpoF5W listing-only PASS, dois servidores próprios+fixtures
seeded, estados/revisões preservados, nenhumPOST no gateway próprio, restart
e sessão revogada. Não claimHTTP real/browser/PGM/hardware; envio real e
recovery64600 anterior mantêm atribuiçãoFE797333. AtualserverB97378AA/web
522BD006 não constam da r27. Outbox/scanner/native intactos não retestados.
6.5 ainda falta visual, reservas restantes e reparo legado coordenado.
Totais10 grupos1 fechado/9 abertos;53 checks5/21/27; bundle grande mantido.

Grupo6.5 — diagnóstico/recovery de integrações: evidência
scratch/group06-integration-owner-diagnostic-recovery-20261009.json. Conferência
privada mostra dono ativo/encerrado local/remoto/desconhecido/incerto sem revelar
coordenadas. SENDING unknown preservado, não transformado em falha/liberação;
FAILED legado inconclusivo não pode ser reenviado por confirmação manual.
Morte local comprovada: CAS de owner + audit cifrado automático atômicos;
falha reverte estado/posse/revisão e impede POST. UI confere qualquer estado.
33 casos distintos/5 arquivos/tipos servidor/web/build PASS72609. Compilado
64600/xMtdQA PASS: duas instâncias próprias, claim HTTP real protegido, só dono
próprio encerrado, audit failure sem POST, uma auditoria, retry mesmo ID/target/
payload, só204 local real confirma. Fixtures unknown/remote/legacy preservadas
com restart e retrycheckbox recusado. Não gateway externo/browser/PGM/hardware
nem exactly-once. AtualserverFE797333/webE4C2DA7F não constam da r27 imutável.
Migração37 preservada histórica; legado desconhecido ainda precisa reparo
coordenado com prova autoritativa do predecessor. Demais reservas/overview/
aprovação visual6.5 continuam abertos. Totais10 grupos1 fechado/9 abertos;
53 checks5 concluídos/21 andamento/27 pendentes. Aviso bundle grande mantido.

Grupo6.5 — auditoria automática do scanner: evidência
scratch/group06-scanner-auto-recovery-audit-20261009.json. Diagnóstico comum
recusa intenção inválida sem probe de PID; morte local comprovada permite CAS
exato de owner/raízes/modo e MEDIA_SCAN_AUTO_RECOVERED cifrado na mesma
transação. Falha de audit reverte release/revisão e impede claim. Opaque owner
fingerprint sem coordenadas, sem ator humano inventado, nenhum kill/TAKE.
40 distintos/6 arquivos/tipos servidor/build PASS84376. Compilado49962/GaDqpk
PASS: duas instâncias próprias, scanner real em settle controlado, mesmo lote,
uma auditoria cifrada/intent congelado, sucessor probe real vídeo/áudio/hash
preservado. Não cópia grande real nem replay de active-probe crash/browser/
PGM/hardware. Atual servidor9BC72149/probe6A5D00E6; r27 antigaAD9EAE62 não
contém essa melhoria. Provas anteriores conservam atribuição; nenhuma nova
build web/native ou testes intactos por atualização documental.6.5 continua
aberto: demais reservas, migração ambígua e aprovação visual. Totais10 grupos
1 fechado/9 abertos;53 checks5 concluídos/21 andamento/27 pendentes.

Grupo6.5/9.4 — crash real durante probe ativo: evidência
scratch/group06-ingest-active-probe-crash-20261009.json;51931/DlfX28 PASS.
Auxiliar nativo observado vivo por handle OS e encerrado82ms após queda do
servidor próprio, código0 não tratado como JSON de análise concluída/EOF1.
Lote e cadastro abandonados preservados; sucessor termina mesmo pedido medido
com vídeo/áudio/loudness/hash, sem duplicar.1 cenário distinto: tentativas
60915 startup medido incorreto;57139/70665/76139/68850 assert exit1 inadequado;
36134 observação45s insuficiente, estado RUNNING não era falha terminal;
51931 prazo180s PASS. Diagnóstico nativo57976 validou15000 buffers vídeo/
28126 áudio/600s. Sem produto/binário modificado, servidorAD9EAE62/probe6A5D00E6
da r27; sem instalação/browser/PGM/hardware. Auditoria de recuperação automática,
demais reservas/legado, interfaces e continuidadePGM continuam pendentes.

Checkpoint09/10 — grupo6.5 scanner: diagnóstico público sem coordenadas do
responsável; reparo explícito somente após ESRCH local, revisão original e
permissões frescas. CAS+auditoria+deduplicação atômicos, nenhum processo morto
ou comando PGM emitido. Donos remotos/desconhecidos/inconclusivos e PENDING
contraditório preservados. 31 casos distintos PASS18345/5 arquivos; tipos/build
PASS42983. Prova compilada40746/KnArvN PASS após instalador criado: dois
servidores, encerramento real de filho próprio, proteção de donos, rollback
atômico, stale same-value, comando único, restart e autoridade fresca.
Probe desativado: não prova scanner nativo/browser/PGM/hardware. Todos filhos
próprios encerrados. Aprovação visual e demais reservas ainda pendentes.
Build parcial r27 solicitada sem nova rodada de testes antes do pacote;
manifesto NOT_RUN_PARTIAL_BUILD, ZIP535788731 bytes/SHA4C06A592, não homologação.
Evidência scratch/group06-scanner-diagnostic-recovery-20261009.json.
Inventário:10 grupos1 fechado,
9 abertos;53 verificações5 concluídas/21 em andamento/27 pendentes.

Escopo: relatório anotado e pedidos anteriores do operador. Não considerar
compilação, descoberta ou saúde do servidor como homologação de sinal físico.
Atualizado em 09/10/2026. Implementações anteriores permanecem em auditoria.

Grupo6.1 — procura imediata da nova pasta, atômica:
`scratch/group06-root-scan-atomic-20261009.json`. Pasta+scan PENDING dirigido
rápido+ambas auditorias commit/rollback juntos. Sonda ausente explícita,
claim vivo/incerto preservado, próximo FIFO após release sem60s. UI mostra
estado real; erro de início/status pós-commit não finge rollback, consulta
falha/contadores locais de outro dono não presumem vazio.26 distintos cobertos:
71132 22PASS/4FAIL reais tx.$client; db.$client na mesma transação e replay4
81258PASS. Tipos76216FAIL mesma causa; reparado tipos/build81258PASS, polling
web37092PASS. Server8CB3297D/webE452293B/probe6A5D00E6 intacto. Compilado
35822FAIL roteiro parseaudit criptografado; decoder padrão sem retirar cofre,
replay5275/8ptTGPPASS dois backends/claim protegido/root+batch+audit atômico,
stale/no dup/rollback e scanners/probes reais de ambos arquivos com vídeo/
áudio/hash preservados; concluem ambos6805ms após liberar anterior sem60s.
Timestamp controlado, não cópia grande real; não browser/PGM/hardware.
6.1 falta visual e fechamento integrado;6.5 diagnóstico/recovery incerto,
crash durante probe e pacote abertos. r26 antiga preservada. Totais10grupos
1concluído/9abertos;53checks5concluídas/20andamento/28pendentes. Não retestar docs.

Grupo6.1 — comando de scan conferido/durável:
`scratch/group06-scan-command-original-review-20261009.json`. Migração40,
revisão original privada de raízes/fila, POST UUID estrito, auth fresca/global,
PENDING+audit atômicos e dedup pelo mesmo ID/estado real (ausência=UNKNOWN).
Somente raízes cadastradas; worker pós-commit não mascara registro confirmado.
Status global separado de progresso local. Dialog explícito sem rebase/retry
automático, mantém UUID/prova após falha e limpa conferência ao trocar sessão;
Master não anuncia início antes da confirmação.27 distintosPASS83579+1migração,
tipos/build59205/52990PASS; serverEF17BDA6/web3A112441. Probe6A5D00E6 intacto.
Compilado75028/F104qJPASS dois backends, um pedido/lote/audit, stale/rollback,
dedup COMPLETED real, restart/revogação e scanner/probe reais preservando
vídeo/áudio/hash. Não browser/PGM/hardware. Falta busca imediata da nova raiz
atômica, diagnóstico/recovery owner6.5, crash com probe ativo, visual/pacote.
r26 anterior preservada; aviso bundle grande mantido. Totais10grupos1concluído/
9abertos;53checks5concluídas/20andamento/28pendentes. Não retestar por documentos.

Grupo6.1 — posse e encerramento do scanner:
`scratch/group06-ingest-worker-ownership-20261009.json`. Migração39 owner
host/PID/boot; claim global/FIFO, frozen roots/mode, peer vivo/remoto/incerto
protegido e retomada somente por morte local comprovada. Cancel espera
hash/children, retorna PENDING e finish tardio não altera sucessor. Probe nativo
parent-pipe encerra EOF; thumbnails por encarnação. SQLite espera também
reconciliação/scanner no close/flush.29 casos distintos e tipos/build PASS;
server7A0A777E/probe6A5D00E6. Native6923/1m01aj PASS50vídeo/95áudio e helper
preso em HTTP próprio encerra EOF exit1/16ms, original preservado. Compilado
44998 FAIL por fixture criando lote extra durante scanner inicial; replay
65039/dP8yBQPASS lote real, peer não toma, servidor próprio encerrado na espera
de estabilização de timestamp, mesmo ID retomado e scanner/probe reais com
vídeo/áudio/hash preservados. Não cópia grande real nem crash com probe ativo;
não browser/PGM/hardware. Falta comando scan conferido/durável/UUID/audit,
status compartilhado, diagnóstico/recovery incerto6.5, busca imediata auditada
e visual/pacote. r26 anterior preservada. Totais10grupos1concluído/9abertos;
53checks5concluídas/20andamento/28pendentes. Não retestar por documentos.

Grupo6.1 — revisão original de pastas:
`scratch/group06-root-original-review-20261009.json`. Migração38, leitura sem
bootstrap implícito, catálogo/candidato privados com prova original, fingerprint
de caminho real/dev/inode, auth fresca/global e audit atômico. Última raiz,
arquivos e assets preservados; ambas telas conferem sem auto-rebase.44 distintos
PASS (41/42 iniciais53299, fixture content_hash reparada/replay1 e novos2PASS29211).
Tipos/build29462PASS; serverDA2932B5/web33FF2EAE. Compilado31423/UjYpv0PASS
dois servidores, um commit concorrente, Unicode e leitura sem cadastro,
same-value/audit rollback/escopo/revogação/restart e original/asset preservados.
Não scan/PGM/hardware/browser. Cadastro agora separado da varredura cega;
reinserir busca imediata somente pelo fluxo de scan conferido e auditado.
Próximo: comando de scan original/durável/audit, posse/recuperação/shutdown do
scanner e homologação visual das interfaces.6.1 em andamento,6.5 remoto/incerto
aberto. r26 anterior preservada. Totais10grupos1concluído/9abertos;
53checks5concluídas/20andamento/28pendentes. Não retestar por atualização documental.

Grupo6.1 — revisão original e entrega durável de integrações:
`scratch/group06-integration-original-review-20261009.json`. Migração37,
catálogo/configuração/entrega com ETag original privado, autorização fresca,
auditoria atômica e testes UUID deduplicados. Worker host/PID/boot preserva
claim vivo/incerto, retoma apenas morte local comprovada, congela destino e
não confirma resposta de claim sucedido. Shutdown aguarda mídia e HTTP.
UI sem rebase automático ou falso rollback após erro de atualização da lista.
25 casos distintos PASS após reparo dirigido de lifecycle; tipos/build
65412/15552/44944 PASS. Compilado65159/9Gv200 PASS: dois backends e gateway
HTTP próprios, um comando/entrega/POST local, confirmação204 real, stale,
rollback de audit, revogação, restart e segredos protegidos. Server5C53C38A,
web8AFBD047; aviso de bundle grande mantido. Não browser/gateway externo,
PGM/placa/redundância entre hosts/exactly-once.6.1 segue em andamento:
raízes/scan e aprovação visual;6.5 owner remoto/incerto permanece aberto.
r26 imutável anterior ao lote. Totais10grupos1concluído/9abertos;
53checks5concluídas/20andamento/28pendentes. Não retestar por mudança documental.

Grupo6.1 — revisão original de categorias/cores:
`scratch/group06-category-original-review-20261009.json`. Migração36 contador
durável cobre tabela e vínculos de mídia/same-value/ABA; ETag privado original
e auth fresca/global dentro de transação. Remoção+vínculos+audit atômicos;
erro pós-commit não simula rollback. Editor explícito sem rebase automático,
consulta ausente não é lista vazia.15 distintos PASS após reparar expectativa
de fixture (OPERATOR já pode PLAYLIST_EDIT); tipos/build50573 PASS.
82026/Gd7RT2 PASS dois servidores compilados: apenas uma gravação concorrente,
stale/vínculo/audit rollback/permissão/revogação/restart e arquivo preservado.
Não é vídeo/PGM/hardware/browser.6.1 continua aberta para raízes/scan,
integrações e aprovação visual; r26 não inclui este código posterior.

Grupo5.1 — limpeza de temporários e diagnóstico/retomada manual segura:
`scratch/group05-partial-cleanup-job-diagnostics-20261009.json`. Só cache
reconhecido >24h de job conhecido não ativo, com raiz/identidade verificadas;
preserva material original/arquivado/publicado, desconhecidos, links e dono
incerto. Passagem horária limitada com cursor. API/QC distinguem owner incerto
sem expor host/PID; retry legado exige confirmação, não toma RUNNING nem mata
processos. Respostas tardias não afetam outra seleção.35 casos relacionados
PASS+2 regressão da fixtureTRIM corrigida, tipos/build PASS depois do reparo.
91053/iuXCfq PASS servidor21D818EE: órfão real da queda com mtime ajustado25h
removido, todos originais/archive/proxy SHA e desconhecido preservados; depois
cursor validado por teste dirigido e build9DAE3070. Integração77433/h7Lgv1 PASS
no servidor final: scanner/probe/proxy/versão/publicação/TAKE/as-run reais,
recusas QC/perfil preservam PGM local null. Não comprova browser/CUE/hardware
ou instalador; ainda falta aprovação dos controles da fila no navegador.
Versões arquivadas não são apagadas por esta manutenção. r26 não alterada.

Grupo5.1 — identidade de máquina e retomada no servidor compilado:
`scratch/group05-compiled-server-job-recovery-20261009.json`. Jobs usam
identidade opaca do SO, não hostname; fallback não presume morte remota.
Servidor revisita fila2s e encerra timer no shutdown.28 testes/tipos/build PASS.
Ensaio71888/GG6udF PASS com dois servidores compilados sobre DB temporário:
segundo preserva job vivo, primeiro sofre SIGKILL, handle nativo fixado encerra;
job não certifica READY após crash, segundo retoma automaticamente mesmo ID
tentativa1→2, cópia SHA/previewHTTP SHA e1201 buffers vídeo/5627 áudio conferidos.
READY permanece após novo restart. Não comprova scanner/QC/PGM/browser ou
redundância de máquinas. Falta limpeza de parciais órfãos/retenção e diagnóstico
de proprietário legado/incerto. r26 preservada anterior ao lote, não homologada.

Grupo5.5 — UI e ganhoAUTO vinculados ao corte:
`scratch/group05-trim-auto-ui-contract-20261009.json`. Diálogo permite escolher
FILE ou Trecho selecionado/Medir trecho selecionado; invalida contexto ao mudar
hash/trilha/mix/intervalo e identifica mediçãoTRIM antes de ganho/limiter. AUTO
TRIM conferido por job salvo e corte exato em cada alvo; padrão de acervo confere
todos os itens referenciados, sem escrita parcial em diferença. Escopo salvo não
pode ser adulteradoTRIM→FILE. Resolução compartilha vínculo ns; plano/simulação
expõem conflito se timing monta outro trecho; publicação/cadence/rollback e
spec final do engine recusam corte divergente. Schema de projeto aceita identidade
opcional do corte; TRIM antigo sem identidade continua inválido, não presumido.
327 casos31375 PASS+2markup PASS=329 distintos. Replay dirigido7 PASS após
reforço de consistência do escopo salvo, não336. Types inicialmente49867/31981
FAIL por predicate que excluía tipoTRIM, corrigido narrowing FILE;33945/24284
PASS. Build50492 server38ED3DC0/webindex-BRfSNcwC 81B99E60 PASS. Native61464
mGpi1t PASS viaAPI compilada medir1–11s/aplicar/publicar/TAKE→PGM -23,298LUFS;
alterar corte recusou aplicação da medição antiga e nova publicação409, PGM
montado manteve startedAt. Arquivo/mix/trilha/reinício também preservados nesse
fluxo. Analyzer não mudou; evidência nativa do corte anterior reaproveitada.
Tentativa visual09/10 com skillcomputer-use/reset+duas chamadas getState falhou
helper_unknown_error setup refresh/kernel exited, sem ações na página. Markup
não é aprovação visual nem CUE/hardware. Falta essa aprovação/auxiliares físicos
nas respectivas frentes. r25 intacta anterior, lote só no workspace/build.
Totais53:5 concluídos/19 andamento/29 pendentes,10 grupos1/9,5.5 não encerrado.

Grupo5.5 — medição nativa de corte e job durável:
`scratch/group05-native-trim-measurement-20261009.json`. Medidor recebe intervalo
ns, mede amostras [in,out) antes de ganho/limiter e recusa mínimo<400ms, ausência
de timestamps/descontinuidade/cobertura incompleta. Contagem exata com margem
de1 amostra por arredondamento racional. Primeiro nativoPCM92249 9HMl2a PASS,
mas integração65492 DUJaug FAIL: timestamps por buffer quantizados pelo mux
excluíam32 amostras (95968/96000). gst-inspect matroskamux confirma timecodescale
default1ms. Corrigido relógio ancorado em primeiroPTS+ordinalPCM, sem inserir
áudio; recusa descontinuidade declarada ou drift>1ms. Replay23432 z9OKah PASS,
96000 amostras em cada metade, -14,760/-34,760LUFS, diferença20LU; intervalos
vazio/curto/além do arquivo recusados.16 casos Rust distintos (15 iniciais PASS,
replay dirigido3 inclui2 existentes+1novo); regressão FILE98908 hFU5pF PASS.
Servidor captura corte efetivo do item/asset e cadence na transação; jobTRIM
separado deFILE, hash/trilha/mix e intervalo salvos, compara corte antes/depois,
exige echo/contagem do medidor, sem aprovarQC/alterarPGM.47casos70262/tipos27558/
build servidor12B9DA37 PASS. Compilado50058 RGiMsg PASS mede1–3s viaAPI e
salva identidade; versão editorial preservada. Aplicação AUTO ainda recusaTRIM
para não misturá-lo comFILE enquanto falta vínculo integral de aplicação/
publicação/execução e controle na UI. Não fechar5.5 nem chamar medição do corte
de fluxo pronto. AnalyzerF6A1A6AD, r25 preservada anterior. Totais10 grupos1/9,
53 verificações5/19/29; físico/browser continuam sem homologação.

Grupo5.5 — AUTO padrão autoritativo e escopo de medição:
`scratch/group05-file-auto-trim-scope-20261008.json`. Corrigida lacuna: AUTO
DEFAULT sem analysisId aceitava medição do cliente; agora usa somente FILE
válido do acervo. Ausência/TRIM/data/LRA/hash inválidos recusam sem alteração
parcial. Trilhas secundárias ainda exigem análise própria. Resolvedor compartilhado
não reutiliza TRIM sem identidade do corte como FILE e prefere FILE atual do
acervo ao anexado antigo. Diálogo informa arquivo inteiro: projeção com ganho
não comprova corte nem resultado após limiter. Não se fabricou medição TRIM.
187 casos distintos:186 PASS/1 FAIL inicial26542 por ordem de mensagem de
recusa; ajustada guarda, replay dirigido7 PASS (sem somar casos sobrepostos).
Tipos servidor nullable reparado43976 PASS/web13162 PASS. Build servidor final
B85EC96D/web index-SLHtafC_ B631B8B9 PASS. Native83017 ztF6kl PASS: cliente
enviou TRIM adulterado, servidor salvou FILE real do acervo e PGM -23,225LUFS;
mix AUTO -23,216, segunda trilha real20dB abaixo, recusa medição de outra trilha,
reinício preservou READY. Null output/sem PVW/físico/browser. Faltam medição
específica de trecho/vínculo de corte e aprovação visual para fechar5.5.
r25 preservada e anterior a esta correção; novo código só no workspace/build.
Totais53:5 concluídos/19 andamento/29 pendentes,10 grupos1/9 inalterados.

Grupo5.5 — Ignorados/limpeza com mídia real:
`scratch/group05-real-ignored-media-20261008.json`.31981 cJdmcs PASS, servidor
723D9616 mantido sem rebuild. VP8/Vorbis real em caminho Unicode decodificou
75 buffers vídeo/152 áudio; PNG válido gerado, bytes dos três arquivos intactos.
Filtro compartilhado da UI exclui STILL mesmo ignored=true. Remoção concorrente
tem único vencedor/ETag obsoleto409/auditoria com rollback, remove VT e limpa
fallback sem apagar item LIVE. Reinício preserva prova; QC ABA invalida review.
Limpar falhas só inclui probeError, não todos os ignorados. Vídeos saudáveis
fora da seleção; apenas segundo arquivo recebe erro emulado no catálogo para
provar limpeza do registro sem apagar arquivo. Não afirmar que seu probe falhou.
Primeira importação do verificador corrigida antes de iniciar ensaio;82790
8rGOnr FAIL por expectativa errada da fixture sobre prune, filhos encerrados;
replay dirigido31981 PASS. Nenhum produto alterado nem suíte já aprovada repetida.
Catálogo seed, não scanner; PGM/PVW simulados; filtro não é aprovação visual.
Backup com integrity=ok não encerra9.3 restauração.5.5 falta trims/loudness e
aprovação visual; totais preservados53:5/19/29,10 grupos1 concluído/9 abertos.

Grupo5.5 — integridade da medição e seleção real de trilha:
`scratch/group05-audio-measurement-integrity-20261008.json`. READY agora exige
FILE, valores finitos/LRA não negativo/data válida e vínculo SHA/trilha/mix.
Fechar durante verificação de original não inicia medidor atrasado nem salva
READY após encerramento.46 casos5files32790 e tipos75964 PASS. Build servidor
723D9616 da parcial r25 reaproveitada: nenhum código produto mudou depois.
Native71741 7Mymlt PASS mix/ganho/AUTO/reinício. Fixture ampliada para segunda
trilha PCM distinta:30088 IDmQiZ PASS, reprodução no PGM20dB abaixo conforme
trilha escolhida, publicação congela trilha1 e AUTO medido na trilha0 recusa
aplicação em1 sem alteração editorial/PGM. AUTO final -23,210LUFS. Verificador
guarda logs/resultado após fechar somente filhos próprios, cofre isolado.
Resultados de pares master não provam auxiliares multicanal físicos. Não é
homologação do instalador r25, CUE, navegador, SDI/NDI/OMT, trims/loudness ou
ignorados reais.5.5 em andamento; totais53:5 concluídos/19 andamento/29 pendentes.

Grupo5.4 — política explícita de acervo legado/sondagem:
`scratch/group05-explicit-probe-policy-20261008.json`. requireProbe opcional
preserva compatibilidade de perfis existentes; novos canais criados pela API
recebem true explicitamente. UI mostra política na avaliação e no editor.
Rigoroso exige codec/duração/varredura/declaração áudio conhecidos; presença de
áudio requer número de canais; ausência declarada pode ser aceita quando o
perfil não obriga áudio. Geometria/cadência inválidas continuam sempre recusadas.
Cliente omitindo campo novo não desativa valor já ativo; mudança explicitamente
false usa mesmo ETag/revisão/auditoria. Não aprova mídia automaticamente.
210 testes7files26744 PASS,tipos56433/11514 PASS,build54525 PASS/server1BE7A898/
webC0DEAEC3. Native15765 R1g9jU PASS em arquivo real+codec metadata legado
emulado apenas na base isolada: modo rigoroso recusa aprovação/TAKE mantendo
PGM, omissão antiga não enfraquece, compatibilidade explícita permite TAKE e
as-run SHA/revisão. Não é falha real da sonda nem sinal físico/browser.
Política legado definida;5.4 aberto para aprovação visual. r24 preservado e
anterior a estas alterações. Totais10 grupos1/9,53 checks5/18/30.

Grupo5.4 — contrato do perfil completo e medição do original:
`scratch/group05-qc-profile-loudness-contract-20261008.json`. Corrigido uso de
TRIM como medição FILE; versão divergente quando hash declarado, LRA/data
inválidos agora recusados quando medição obrigatória. Política opcional não
forçada; editor esclarece arquivo inteiro, não trecho/proxy.198 casos6files
97698 PASS,tipo servidor26975/web72608 PASS,build92810 PASS/server7C04487A/
web378DFA47. API cobre cada regra de codec/width/height/FPS/scan/áudio/duração/
loudness isoladamente, perfil válido inteiro, APPPROVED e ressalva; recusas409
sem falso commit. Native22758 Yhfffm PASS: scanner mede FILE real VP8, -26.650
LUFS/pico-25.783dBTP; limitesLufs/pico incompatíveis recusam QC/TAKE mantendo
PGM/origem, perfil restaurado permite TAKE/as-run do SHA/revisão. Faixas amplas
do ensaio são política de teste, não recomendação broadcast/certificação.
UI/hardware não homologados; legado sem probe ainda precisa política explícita.
5.4 aberto;10 grupos1/9,53 checks5/18/30. r24 preservado, não contém este lote.

Grupo3.4 — safe areas no raster exibido, não no matte/tela cheia:
`scratch/group03-qc-contained-safe-area-20261008.json`. Overlay considera
dimensões reais de video/img e object-contain:16:9,4:3,vertical,proxy e viewport
de outra proporção. ResizeObserver+metadata/load/resize, não redesenho por
quadro; sem raster válido não inventa geometria. Default QC permanece false,
store compartilhado agora false. Rodada da47e4:31/32 PASS,1FAIL por arredondamento
numérico; clamp no produto, replay do helper505400:10/10 PASS,22 outros casos
inalterados. Cobertura distinta32,não42. Tipos49682 PASS antes de clampnumérico
com forma inalterada; build final83338 PASS/webBF2FD79C. Bundle>500kB persiste.
Habilidade computer-use lida, navegadorgetState falhou após retry/reset com
helper_unknown_error setup refresh: não houve aprovação visual.3.4 em andamento;
10 grupos1/9,53 checks5/18/30. Servidor/engine/r24 não alterados.

Grupo5.4 — QC/perfil alterados após CUE:98607 Vv1Phl PASS.
`scratch/group05-compiled-cue-qc-profile-20261008.json`: CUE publicado entrega
imagem real320x180/desvio34.24 no PVW; BLOCKED e perfil incompatível posteriores
recusam TAKE implícito409 sem alterar PGM/origem/seleção CUE; reaprovação e
perfil válido permitem TAKE/as-run nativos.91416 FAIL exigia240p mesmo para
canal180p;98720 FAIL por contraste do padrão ball (JPEG inspecionado continha
círculo, não preto). Corrigida somente fixture: tamanho exato320x180 e barras
SMPTE de alto contraste, gate desvio>10 mantido. Sem rebuild/alteração de produto
ou replay de suíte ampla. Sem browser/hardware.5.4 ainda aberto para matriz
completa de perfis/aprovação visual;5.2 fechado por prova integrada58729 e
contratos prévios de integridade/versões, não por este teste. Totais atuais:
10 grupos1/9,53 checks5 concluídos/17 em andamento/31 pendentes. r24 preservado.

Grupo5.2/5.4 — troca real do original durante PGM:58729 F5ReKl PASS.
`scratch/group05-compiled-source-replacement-20261008.json`. Novo modo dirigido
--source-replacement,sem repetir a suíte do produto ou o build: scanner real
reimporta mesmo ID/nova edição PENDING. QC/preview com hash antigo409; archive
original mantém SHA e edição operacional preserva PGM. BLOCKED do novo hash
não revoga a antiga aprovação: segundo TAKE nativo usa archive antigo. Nova
aprovação não substitui bytes do item no ar: publicação409 até STOP explícito.
Publicação nova após STOP + TAKE nativo usam novo hash; as-run separa hashes/
revisões; snapshot publicado antigo permanece imutável. Sem browser/CUE/
hardware neste modo. Produto e instalador r24 não mudaram; somente ensaio.
Totais preservados10 grupos1/9,53 checks4/18/31;5.2/5.4 ainda abertos.

Entrega parcial10.1: r24 gerada,sem testes funcionais por pedido expresso.
Sessão92816 build/deploy/manifesto exit0;26908 instalador ZIP exit0. Dependências
incluídas,engine92B7E56B/proxyD8AD6CDB/serverC1F7016E; não executados instalador,
verificador do pacote ou homologação Windows limpo. Não é Setup.exe assinado.
`release/RPlayout-1.1-parcial-20261008-r24-instalador.zip`,535720242bytes.
10.1 em andamento,10.2–10.5 pendentes;10 grupos1/9,53 checks4/18/31.

Grupo5 — integração real scanner/proxy/QC/publicação/TAKE:
`scratch/group05-compiled-ingest-qc-take-20261008.json`,69193 amP8jH PASS.
Vídeo Unicode importado pela sonda real, sem metadados/QC semeados; archive e
proxy nativos READY, HTTP proxy corresponde ao SHA persistido,240p/10fps com
vídeo e áudio decodificados. Pendente recusado na inserção; QC bloqueado e
perfil atual incompatível recusam TAKE409 preservando item/origem do PGM.
Aprovação incompatível409; reaprovação/perfil válido permitem segundo TAKE
nativo; as-run registra SHA e revisão publicada. ServidorC1F7016E,engine92B7E56B,
proxyD8AD6CDB. Sem saída física/browser/CUE/alteração do original neste ensaio.
Grupos5.1–5.4 continuam abertos; totais10 grupos1/9,53 checks4/17/32.
Operador pediu build parcial instalável sem novos testes após essa integração;
não equivale a pacote homologado ou fechamento dos grupos10/hardware.

Grupo5.4 — elegibilidade técnica numérica:
`scratch/group05-qc-numeric-eligibility-20261008.json`. Cadência sondada com
num/den não inteiros positivos, geometria inválida e duração não finita/positiva
agora recusadas. FPS/minDuration não deixam NaN/Infinity escaparem na comparação.
Perfil permissivo para metadados válidos preservado; faltas de probe legado
continuam política existente, não foram promovidas a aprovação técnica.
162 testes/5 arquivos63478 PASS, tipos servidor88623/web47179 PASS, build36847
PASS/server3A18F3F8/web65424497. API injetada: rate_den/width/duration_ns zero
recusados409 sem decisão/auditoria/revisão falsas; avaliação global/canal usa
mesma função. Não é scanner/publicação/TAKE nativo integrado/browser; esses
continuam próximos, sem repetir crash/QC físico inalterados. Bundle>500kB
permanece.5.4 agora em andamento, sem fechamento:10 grupos1/9,53 checks4/17/32.

Grupo5.1 — cópia de entrada incompleta em disco:
`scratch/group05-real-incoming-copy-20261008.json`. Novo modo --incoming-copy
não repete cache/crash: vídeo real em pathname Unicode, apenas85725 de171450
bytes presentes. ArchiveFAILED/proxy dependenteFAILED sem tentativa, arquivo/
proxy indisponíveis e .part removido. Completar arquivo/retry preserva mesma
edição/IDs, archive/proxyREADY e hashes conferidos; decode31vídeo/143áudio.
98580 FAILdOItQy era expectativa attempts2 após retry manual; código atual
reinicia orçamento e contava1. Corrigida apenas asserção do contador, sem mudar
produto/IDs/hashes/conteúdo.62045 PASShM9yEk/result.json pós-close lido. Não
é varredura/aprovação integrada, servidor compilado/browser nem cancelamento
durante stream ARCHIVE (arquivo de entrada incompleto é outro caso). Nenhum
build/suite/crash repetido por status.10 grupos1/9,53 checks4/16/33 inalterados.

Grupo5.1 — diagnóstico do observador e recuperação após crash:
`scratch/group05-crash-observer-recovery-20261008.json`. Sem mudança do produto
(server35783709/proxyD8AD6CDB), sem suite/build repetidos.32698 FAIL timeout:
monitor compilou tarde e PID já ausente; xHs4fP lido. Observador preparado antes
do worker, consulta GetExitCodeProcess pelo handle:99637 FAILNN9bQQ lido
confirmou código0 no kernel em15ms após pedido SIGKILL, não erro de propriedade.
Critério anterior exit1-only era suposição do verificador, não requisito do
operador. Corrigido explicitamente, não replay da mesma asserção: handle vivo
(259) antes de kill, SIGKILL aceito/observado, saída nativa limitada após pedido,
job durável NÃO READY/sem hash, novo worker retoma mesmo ID/tentativas e decodifica
saída. Código0 permanece registrado, mecanismo específico não provado e nunca
tomado como prova de material pronto.51093 PASSuU33lO/result.json pós-workers
lido: saída18ms após pedido, jobRUNNING/hashNULL, retomada1→2/READY,601 buffers
vídeo/2815 áudio. EOF direto continua recusado1. É crash do worker de mídia,
não servidor compilado/cópia ARCHIVE interrompida/QC-PGM/browser. Parcial órfão
nunca reutilizado; retenção/limpeza segura ainda falta.10 grupos1/9,
53 checks4 concluídos/16 andamento/33 pendentes; nenhuma nova conclusão global.

Grupo5.1 — isolamento por tentativa, crash ainda não aprovado:
`scratch/group05-attempt-isolation-crash-20261008.json`. Temporários têm UUID
por execução; retry não reutiliza/apaga pathname de predecessor.16 testes14426,
tipos71358/build0197d0 PASS/server35783709. Native crash90831 FAIL: monitor
handle pinado observou EXIT:0, não provou cancelamento precoce. Fixture20s
ampliada para60s e HasExited conferido antes de armar, sem mudar produto nem
repetir testes/build inalterados; replay53611 FAIL pelo mesmo EXIT:0. Failure
OxcONz lido, sem esconder falha/afrouxar exit não-zero. Causa ainda não provada:
correlacionar timestamp de saída do worker, entrega do stdout do monitor e
saída do handle nativo antes de inferir runtime/fixture. EOF direto anterior
não substitui crash real; recuperação pós-crash não executada por falha no gate.
Cópia em disco/servidor-QC-PGM/browser também permanecem abertos. Nenhum marco
novo aprovado;10 grupos1/9,53 checks4/16/33 inalterados.

Grupo5.1 — cópia cancelável e posse do proxy pelo pipe:
`scratch/group05-copy-cancel-proxy-parent-20261008.json`. Proxy nativo aceita
--parent-pipe e recusa EOF do servidor com fechamento do pipeline; supervisor
mantém stdin aberto. Uso manual sem opção preservado. Caso de cópia com stream
controlado prova cancelamento/arquivo parcial indisponível/mesma versão retomada.
15 testes1217 PASS;1 teste nativo de vídeo/áudioeeb839 PASS; tipos91302, build
serverdcf2ff/proxye7618c PASS. ServerC63BDFCA/proxyD8AD6CDB, engine inalterado.
Ensaio97339 PASS,fpSj1F/result.json lido após processos: job retomado1→2 com
201 buffers vídeo/940 áudio, EOF nativo direto recusado exit1 com diagnóstico
de servidor encerrado. Não é crash abrupto do servidor nem cópia de disco
interrompida end-to-end. Falta isolar arquivos parciais por tentativa em crash,
servidor compilado/QC-PGM/browser e entrega Windows com ambos componentes novos.
Nenhum marco encerrado;10 grupos1/9,53 checks4/16/33. Não somar testes repetidos
de contratos anteriores; ensaio foi requerido pela mudança real de ABI CLI.

Grupo5.1 — drenagem e retomada da fila:
`scratch/group05-worker-drain-restart-20261008.json`. Ticks compartilham promessa;
close aborta pipeline de cópia/encerra ChildProcess próprio e espera limpeza.
Flush do servidor espera o worker antes de SQLite.close; novos record/retry
recusados após close e flag fechada reconferida após rename antes de READY.
22 testes afetados80450 PASS, tipos43901/build326d8f PASS/server09A48B84. Ensaio
51615 PASS,hTUbH6/result.json pós-exit dos dois workers lido: proxy nativo vivo
interrompido por close controlado, child terminou antes de drenagem, .part
removido; novo processo retoma mesmo ID e tentativas1→2, READY e201 buffers
vídeo/940 áudio reais. Não é crash abrupto, cópia ARCHIVE interrompida ou API
compilada/servidor completo/QC-PGM. Essas validações permanecem; nenhum novo
marco encerrado. Totais10 grupos1/9;53 checks4 concluídos/16 andamento/33 pendentes.

Grupo5.3 — integridade persistida do cache:
`scratch/group05-proxy-cache-integrity-20261008.json`. Migração34 grava SHA da
saída; proxies legados READY sem identidade tornam-se FAILED para regenerar,
preservando arquivos/arquivos originais. Preview confere bytes e falha somente
o job observado se ausente/alterado/sem prova; geração registra hash verificado.
30 testes/4 arquivos13783 PASS (não somar aos32 anteriores sobrepostos), tipos
88214/build6c2c5f PASS/serverE71934F1. Native65891 PASS,0vGkJS/result.json lido
após close: corrupção real recusada, retry regenera426x240/10fps com31 buffers
de vídeo/143 de áudio, SHA persistido coincide,2 versões/4 jobs READY e edição
antiga preservada. Workflow fonte/proxy e sonda nativos; não API compilada ou
navegador. Não é trava contra escritores futuros; ainda falta fluxo integrado,
restart/cópia incompleta e aprovação visual. Contagens permanecem10 grupos,
1 fechado/9 abertos,53 checks4 concluídos/16 em andamento/33 pendentes.

Grupo5.1/5.2/5.3 — fila e versões/proxy em lote:
`scratch/group05-workflow-proxy-20261008.json`. Jobs interrompidos no limite
viram FAILED recuperável, não PENDING eterno; metadados inválidos isolados por
versão, caminho exigido/SHA normalizado. Copiar novamente libera apenas proxy
dependente daquela falha de arquivo. SHA da cópia conferido antes/depois da
geração; saída vazia não chega a READY.32 testes/4 arquivos78798 PASS, tipos8883
e build servidorcdee5c PASS/serverA87EA427. Ensaio84864 PASS,V3lJ3K/result.json
lido após close da fila/DB: dois vídeos reais locais em caminho Unicode,
4 jobs READY/2 versões, arquivo antigo preservado e SHA maiúsculo deduplicado.
Proxy nativoAE55C952/sondaFAF1099C:426x240/10fps/H264, áudio estéreo48kHz com143
buffers decodificados;115230bytes/3.1s (~297.37kbps médios do arquivo, não rede).
Não é API compilada/browser/QC técnico completo nem carga/soak. Faltam restart
real/cópia incompleta, publicação concorrente/QC/PGM integrado, integridade do
cache e aprovação visual.5.1–5.3 agora em andamento, sem encerramento:10 grupos
1 fechado/9 abertos;53 checks4 concluídos/16 em andamento/33 pendentes.

Grupo2.5 — opt-in de decoder encaminhado ao engine:
O filtro comum removia RPLAYOUT_HARDWARE_DECODE antes do spawn, portanto a
opção documentada não chegava ao Rust. engineProcessEnvironment agora admite
somente valor exato1 e normaliza a chave; helpers/relays continuam sem a opção,
cofre/admin/token/destinos seguem removidos. Software continua padrão.121
testes afetados PASS em94199 (13 inicialização/108 transporte); build servidor
80a505 PASS, novo server9871BEB4, engine92B7E56/web inalterados. Estes testes
provam seleção de configuração/spawn, não homologação de decoder GPU físico.
Não repetir o ensaio anterior de CUE/QC só por status; suas evidências continuam
atribuídas ao serverCE255336.2.5 permanece aberto para hardware/browser/soak.
Tipos servidor14001 PASS. Evidência registrada em
`scratch/group02-engine-decode-environment-20261008.json`. Não houve entrega
de pacote Windows/publicação GitHub neste lote.

Grupo2.5 — CUE/PVW/TAKE na API compilada, independente do QC:
`scratch/group02-compiled-cue-take-20261008.json`. Novo modo `--cue-take` no
verificador reaproveita infraestrutura, mas não executa o workflow de QC/HQ.
70979 PASS, resultado GCF2Lw lido após cleanup: CUE inicial/repetido não dá
TAKE; outra ocorrência no PVW conserva item/origem do PGM e avanço do contador.
TAKE sem item escolhe o CUE; fonte compartilhada por dois eventos é recusada409;
TAKE sem CUE é recusado400 sem cair em Próximo. Imagem PVW decodificada428x240,
HQ nunca habilitado, STOP confirmado. ServerCE255336/engine92B7E56 inalterados;
sem repetição de QC/suítes/build por status. Não aprova navegador, áudio PVW,
identidade de pixels entre fontes distintas, rede externa ou hardware.2.5 segue
em andamento; totais10 grupos/1 fechado/9 abertos,53 checks4/13/36 inalterados.

Grupo4.2 — duração montada, projeção e eventos antes do fim:
`scratch/group04-mounted-duration-events-20261008.json`. Estado nativo e grade
incluem mountedDuration, preservando plannedDuration e separando uma interrupção
prioritária projetada do limite efetivo do decoder. Compensações ordinárias não
mudam filler já montado; HARD_TIME vencido não apaga o PGM do plano. Master,
eventos end-relative e janela de restauração usam o limite montado.163 casos
distintos cobertos:9477 teve162 PASS/1 FAIL por fixture sem schedule, corrigida
com replay1 PASS80451, mesma asserção de75 em vez125. Tipos50394/build72022 PASS.
Nativo8128/serverCE255336/engine92B7E56 PASS,mMhLJ5/result.json pós-cleanup lido:
nominal1250, transporte/grade montados750, alvo do evento650/disparo651 apenas
uma vez, EOS750. Interface2E435E6A compilada, não aprovada no navegador; ledger
gráfico local não prova pixels ou gateway externo. Arquivo/null não aprova
hardware/protocolos externos/CUE. Serviço de timing/recuperação completa/soak
e entrega final continuam abertos; contagens atuais não mudam por esse lote.

Grupo4.2/4.5/9.4 — recuperação do corte efetivamente montado:
`scratch/group04-09-mounted-crop-recovery-20261008.json`. Checkpoint inclui bounds
do decoder e SHA; watchdog/backend restauram o mesmo crop, sem reprojetar outro
corte. Posse/revisão/cadência/áudio/hash/limites/cursor continuam obrigatórios.
Legacy de arquivo sem crop é recusado, sem apagar cursor em ticks vazios/erro;
somente confirmação nativa de STOP ou novo TAKE libera preservação.146 casos
afetados27607/tipos73431 PASS. Native29871 FAIL2rwmNR expôs retry para cópia
verificada omitindo recoveryTrim; produto corrigido,3 casos dirigidos12366 PASS,
147 casos distintos cobertos. Server final84FA0D94/engine92B7E56. Native18418
FAILhVa5Oo tinha crop750 correto, mas fixture autoNext=false segurava quadro e
não encerrava as-run por EOS. Corrigida só política da fixture, sem enfraquecer
EOS750 nem recompilar/retestar fonte inalterada.20899 PASS8qcHO8/result.json
pós-cleanup lido: nominal1250/resolvido750, crash engine/server preserva cursor
51→120/120 e executionId, EOS750; legacy preservado até STOP confirmado.
Só mídia real local/output null; sem CUE/browser, SDI/NDI/OMT externos. Não cobre
queda de broker/DB/saída, máquinas redundantes nem soak/RPO/RTO completos.
9.4 agora em andamento; nenhum check de fechamento novo aprovado.53 checks:
4 concluídos/13 em andamento/36 pendentes;10 grupos/1 fechado/9 abertos.

Grupo4.1/4.2/4.4 — duração resolvida executada e estabilidade do preroll/CUE:
`scratch/group04-resolved-execution-timing-20261008.json`. Corte automático do
timing agora enviado ao decoder, sem editar o nominal; corte montado do PGM
preservado e retorno histórico não recortado pela âncora expirada. Crescimento
elástico limitado aos quadros reais; corte inválido não reserva tempo. Revisão
e auditoria de compensação distinguem nominal/executável, assim como a tela.
Publicação/rollback protegem também o corte calculado do CUE.196 casos iniciais
com1 falha de fixture reparada por replay dirigido, sem enfraquecer asserção.
Ensaio64218/v66Wtd FAIL revelou reprojeção de relógio invalidando trimOut durante
preroll. Correção mantém timing preparado/CUE congelado e recusa alterações reais
de mídia/grade/revisão;105 casos afetados17229 PASS, tipos/build servidor PASS.
Cobertura distinta200 casos/8 arquivos, não integral única. Interface compilada
antes da correção restrita ao transporte, não recompilada sem necessidade.
Ensaio41034 compiladoCAC6A4E0/engine92B7E56 PASS, yzvqPd/result.json pós-cleanup
lido: VT nominal125/resolvido75/EOS75 sem compensação manual; filler nominal75/
resolvido300/EOS300. Interrupção346/retomada, ajuste live+120s, rollback, proteção,
opcional e concorrência preservados. CUE por contratos simulados, não bus nativo;
null/arquivo não aprova DeckLink/NDI/OMT. Falta navegador/horários remotos, CUE
nativo e recuperação persistente do corte montado após crash. Bundle web grande
permanece pendência; sem pacote final/deploy/GitHub. Grupos/totais não alterados.

Grupo4.1/4.4/4.5 — CUE/publicação concorrente e respostas pós-commit:
`scratch/group04-publication-cue-concurrency-20261006.json`.
Protegidos liveConfig.sourceType/sourceEndpoint/fallbackMediaId e contrato do
item no CUE em publicação/rollback; execução revalidada no commit e selecionada
por executionView. Refresh após commit falho retorna applied/aviso, não recusa
de publicação/rollback; UI não afirma sincronismo.85 testes12599 PASS,
tipos12833/build43156 PASS. Ensaio72989 FAIL revelou origem do PGM calculada
em cada consulta oscilando1frame, não foi tratado como tolerância de fixture.
Produto corrigido para origem fixa por ocorrência/novo TAKE/seek explícito;
98 testes do transporte41312 PASS, tipos/build só servidor76607 PASS.85
anteriores não repetidos:4 arquivos/183 casos distintos, não suíte integral.
Compilado final0699768F + engine92B7E56,24816 PASS terminal0; resultado
pós-cleanupmBbeii/result.json lido. Duas publicações urgentes simultâneas geram
201/409 e um commit; editorial novo publicado explicitamente, PGM conserva
item/startedAt com igualdade exata. +120s live, quatro compensações,
rollback/retomada357frames e payload original imutável/cleanup PASS.
CUE por contratos simulados, não preview nativo; null/arquivo não é hardware.
Anchor SOFT alterada no payload, não prova chegada no relógio nesse horário.
Faltam browser/tempo remoto/CUE nativo/crash e intervenções concorrentes amplas.
QC/grupos inalterados não repetidos por status. Totais10 grupos/53 checks,4/12/37.

Grupo4.4 — quatro ações compiladas/nativas, sem alterar/recompilar produto:
`scratch/group04-compensation-all-actions-native-20261006.json`.
Novo alcance do verificador: filler50→75 e VT125→75 executados com EOS nativo
e cursor75 na revisão compensada; opcional removido não recebe as-run, avanço
real vai ao SOFT; atraso flexível75frames preserva FIXED; zona recusa ajuste
sem nova revisão ou troca do PGM. Replay de cada pedido deduplicado. Revision
original, +120s live, rollback e retomada354 frames preservados.
90467 FAIL: zona da fixture sobrepunha25frames do VT seguinte; recusa correta.
Reparado só endpoint da zona.81181 PASS terminal0, resultado pós-cleanup
bWOe5F/result.json lido. Mesmo servidor59D41C9D/engine92B7E56; nenhum replay
de QC/tipos/build/unitários/grupos inalterados por status. Um cenário ampliado,
não duas aprovações nem aval retroativo da falha. Não prova browser/latência
remota/CUE (fixture null sem bus)/hardware/concorrência/crash/urgência.
4.4 permanece em andamento, totais10 grupos/53 checks,4/12/37.

Grupo4.4 — ações rápidas na edição publicada:
`scratch/group04-operational-compensation-20261006.json`. Filler finito é
alterado no trim real dentro do arquivo/elasticidade; VT com corte permitido
ganha mínimo persistente; opcional removido com suas deixas; atraso somente
SOFT/WINDOW, sem mover FIXED/HARD_TIME. PGM/CUE/itens e zonas protegidos recusados.
Review/requestId/commit-audit atômico/reenvio e aviso pós-commit no Master;
preenchimento editorial identificado, retiradas promessas de100%/24h inferidas.
UUID do ajuste live usa helper que funciona em HTTP LAN sem randomUUID.
90497:17 PASS/2 FAIL/38 skipped; fixture persistia flags no campo inexistente.
70820:2 PASS/11 skipped após usar colunas oficiais.19 casos distintos (18 novos
+1 existente), não integral única verde. Tipos4174: servidor FAIL, interface
PASS; reparados opcionais e fixture, servidor75956 PASS; build56757 PASS.
Ensaio85001 FAIL ao CUE: fixture null sem barramento preview; nenhum aval CUE.
Fixture corrigida para prova do trecho em PGM,70198 PASS terminal0:
servidor59D41C9D + engine92B7E56, filler50→75frames, cursor74/EOS e as-run na
revisão compensada; reenvio deduplicado, +120s live, rollback/retomada354 frames
e cleanup próprios PASS. ResultadoBaWmQh/result.json lido após cleanup.
Não prova todas as ações em engine/browser/hardware, nem latência remota.
Aviso dispensável da UI recebeu build web separado69870; não repete backend,
engine ou QC inalterados. Totais mantidos10 grupos/53 checks,4/12/37.

Grupo4.4 — ajuste rápido revisado e idempotente:
`scratch/group04-live-duration-guard-20261006.json`. POST exige input conferido,
requestId e token vinculado à ocorrência/revisão/item/duração/configuração/ator.
Auditoria e revisão no mesmo commit; falha de refresh informa ajuste gravado,
não rollback. UI usa trava imediata e reenvia a mesma solicitação para conferir.
Rodada66334:47 PASS/8 FAIL por expectativa201 da fixture;48387:8 FAIL por
contexto obrigatório ausente na assinatura do produto. Reparados contexto e
tipos;16450:8 PASS/31 skipped.55 casos distintos cobertos, não integral única
verde. Tipos servidor43688/interface51600 PASS; build64098 PASS.
API compilada CFA93417 + engine92B7E56, ensaio19427 PASS terminal0:
HARD_TIME/interrupção349 frames, ajuste+120s e replay da mesma revisão sem
duplicação, rollback/retomada/PGM e cleanup próprios confirmados. Resultado
persistido9iBiVW/result.json. LIVE por arquivo local; browser/hardware/filler/
opcional/trim/proteções/urgência continuam abertos. Não repetido QC ou grupos
inalterados por status.10 grupos/53 checks:4 concluídos/12 em andamento/37 pendentes.

Grupo4 — primeira integração compilada/nativa:
`scratch/group04-priority-integration-20261006.json`. Novo verificador
`scripts/verify-priority-playout.mts` usa DB/porta temporários, saída null e
arquivo real VP8/Vorbis Unicode como VT e fonte LIVE por URI; não abre placa,
NDI/OMT nem mídia de produção. Simulação/publicação revisionadas, título editorial
posterior não altera execução, HARD_TIME corta VT automaticamente antes do fim.
Interrupção durável e as-run NATIVE preservam cursor357/revisão/hash da mídia.
Ajuste live +120s cria revisão/schedule sem modificar payload original; rollback
restaura revisão original mantendo live no PGM; retorno com review/requestId
confirma VT e as-run start_position357, resolve pendência. Cleanup pós-asserções
confirmado e resultado persistido, sem kill por PID histórico.
Rodadas66585 FAIL por JSON.parse de payload cifrado,50500/72600 FAIL por falta
de If-Match na GET de conferência do rollback (correção intermediária somente
no POST não resolvia GET). Reparados apenas leitores/chamadas da fixture;
57034 PASS terminal0. Um cenário integrado aprovado, não quatro cenários nem
aprovação retroativa das falhas. Produto/binários inalterados; sem retestar QC.
Não fecha grupo4: faltam browser/diff, compensações filler/opcional/trim,
proteções, intervenção urgente/concorrência/falhas e fontes externas. IDs4.1..4.5
passam a em andamento. Totais10 grupos/53 checks,1 grupo fechado,
4 concluídas/12 em andamento/37 pendentes; fechamento continua requirement-by-requirement.

Integração QC3.3/3.5 — `scratch/group03-direct-qc-compiled-pass-20261006.json`.
Rodada25502 terminal0 PASS e resultado final persistido depois do cleanup:
servidor compilado DE7F54E + engine92B7E56, DB/ports/sender próprios. QC CUE e
HQ antes de publicar grade ou TAKE:1280x720 com detalhe real, PGM null/parado,
apenas1 leitor da entrada. Etapa posterior com PGM/PVW: preview428x240 contra
HQ1280x720, Opus decodificado RMS0,0243448,2 leitores de entrada inalterados
pela HQ, PGM preservado,2 viewers isolados, fonte errada409, parada/reabertura/
expiração por falta de heartbeat. Processos próprios encerrados/DB fechado;
nenhum kill por PID histórico. Não houve produto alterado/rebuild nesta etapa.
Não é UI/WebRTC browser, inspeção de arquivo, CPU/RAM/rede remota ou hardware.
Captura antiga Z0fiF2 sem terminal mantém classificação incompleta, não convertida
em PASS por esta rodada nova.3.3 passa a em andamento, não concluída.
Totais atuais10 grupos/53 checks:1 grupo fechado,4 concluídas/7 em andamento/42 pendentes.

Lote2.1 — política de sinal por canal:
`scratch/group02-live-policy-20261006.json`. Perfil técnico QC expõe habilitar
aviso de chegada, intervalo0,5..20 quadros e aquecimento1..10000 buffers.
Padrão3/50 continua para perfis existentes sem propriedade opcional. Campo
liveSignalPolicy persiste no JSON qcProfile já versionado/auditado; não adiciona
ALTER/migração nem modifica elegibilidade de arquivo. PUT valida limites,
mesmo controle de sessão/permissão e If-Match; concorrência obsoleta409.
EngineTransport usa a configuração da visão atual, não a capturada no construtor;
teste demonstra alteração do aviso sem qualquer comando adicional ao engine.
Frontend recalcula o sinal com a mesma política do canal. Ausência de áudio/vídeo
não é ocultada ao desabilitar o aviso; settings inválidos em dado importado usam
padrão defensivo.158 testes distintos/5 arquivos PASS, tipos servidor/web PASS,
build servidor/web PASS. Sem alterar/recompilar/retestar binário nativo.
Não homologa UI interativa, hardware/rede, limiares reais ou freeze por conteúdo.
As evidências HTTP compiladas antigas mantêm atribuição ao build antigo; este
novo servidor não recebe aprovação de playback por simples compilação.
Contagens mantidas10 grupos/53 checks:1 grupo fechado,4 concluídas/6 em andamento/43 pendentes.

Lote2.1 — proveniência de descoberta na UI:
`scratch/group02-discovery-provenance-20261006.json`. Corrigidos cards de
DeckLink/NDI e incluído card OMT com componente comum. Apenas DISCOVERED conta
como descoberta; CONFIGURED e origem ausente são diferenciados sem afirmar
sinal. Reason sempre visível nos cards e nos seletores aplicáveis mesmo com
endpoints salvos. Adicionar item deixa de afirmar driver presente no fallback
vazio e de suprimir reason por fonte cadastrada. Mensagem de reescan não afirma
sucesso de hardware só porque API respondeu.13 contratos existentes/novos PASS;
2 adicionais do diálogo PASS, cobertura distinta15. Tipos/build web verificados
por etapa; sem alteração/reteste nativo. Não resolve/homologa placa física por
markup. Totais mantidos4 concluídas/6 em andamento/43 pendentes.

Lote2.1 — diagnóstico de degradação: `scratch/group02-live-degradation-20261006.json`.
UNSTABLE deriva da variação de chegada já medida no pad nativo, com cadência
conhecida e aquecimento50 quadros; limite operacional3 intervalos de quadro.
Não representa jitter de pacotes, freeze por conteúdo, limiar broadcast oficial
ou política por canal homologada. NO_AUDIO tem precedência e ambos mostram aviso
âmbar junto ao vídeo. Imagem/PGM/tally preservados; não é nova condição de TAKE.
Contratos141/141 PASS, tipos servidor/web PASS e compilação PASS; após adicionar
mensagem visível,2 testes de markup PASS e somente web recompilado. Tentativa
inicial .test.tsx não selecionada pela configuração .test.ts: sem teste executado,
corrigido apenas formato da fixture. Total distinto143, sem somar às rodadas
anteriores. Sem engine modificado/recompilado/retestado; browser/hardware pendentes.

Lote QC3.7 — scopes: `scratch/group03-scope-presentation-20261006.json`.
Relógio de apresentação live precisa avançar para certificar pixels recentes;
canvas repetido de frame retido não renova medição. Dois segundos de tolerância,
sem interferir na inspeção estática/pausada de arquivo. Estatísticas antigas
invalidadas; relógio de playback removido das dependências do intervalo para
evitar render forçado adicional. Fonte web alterada:21 testes afetados PASS,
typecheck PASS e Vite build PASS com aviso de chunk grande preservado.
Não é prova de responsividade/consumo remoto nem freeze por conteúdo; navegador
pendente. Sem build/test do engine/servidor. Totais atuais:10 grupos/53 checks,
1 grupo fechado,4 concluídas/6 em andamento/43 pendentes.

Etapa adicional QC direto antes do Master/PGM:
`scratch/group03-direct-qc-api-20261006.json`. Verificador ampliado para CUE/HQ
antes de publicação/TAKE, PGM parado e apenas um reader da fonte. Execução65859
gerou quadros diretos e avançou às capturas posteriores, mas handle desapareceu
sem stdout/exit final recuperado. Processos próprios não encontrados em inspeção
somente leitura. **Não é PASS integral nem homologação do navegador.** Persistência
de milestone/resultado pós-cleanup adicionada para próxima rodada consolidada,
sem replay apenas por status. Produto/binários inalterados; contagem permanece
10 grupos/53 verificações:1 grupo fechado,4 concluídas/5 em andamento/44 pendentes.

Frente atual EXEC-03 integrada na fonte: admissão no bootstrap, guardas de
configuração/engine/relays e identidade de encarnação do MediaMTX com prova
antes/depois do fetch. Kernel b6c5b7 e cliente 95b936 reais PASS; oito Rust,
24 IPC e última direcionada 44 PASS. Não confundir componentes com integração.
Repetição compilada sTtEOU recusou ACL antes de abrir MediaMTX. Correção agora
usa rplayout-file-security embutido, não PowerShell; quatro testes Rust reais
PASS, incluindo arquivo vazio Unicode e recusa de conteúdo/hardlink/diretório.
Fonte final do grupo reunida; compilado final gW0s1R PASS com engine/relay reais
em loopback, entrega de buffers e recuperação de relay sem reiniciar VT.
Regressão por cobertura com replay: integral57152 2.168 PASS/10 FAIL em5
fixtures simuladas; reparadas juntas, replay38396 36/36 PASS. Mesmas asserções,
2.142 PASS fora do replay; 2.178 testes distintos/221 arquivos cobertos.
Não é uma integral única verde. Fonte/binários do produto permaneceram iguais.
Grupo1 fechado localmente; grupos2–10 e pacote final continuam abertos.
Inventário fixo: docs/PENDENCIAS-NUMERADAS.md, 10 grupos/53 verificações.
Os2135 PASS e compilado EXEC-02 abaixo são históricos, não da fonte atual.

Checkpoint anterior EXEC-02 validada localmente: migração33 protege recursos globais no
mesmo SQLite, antes de arquivo/processo/pipe e reinício. MediaMTX/config/relays
mantêm reserva de PID/generação até saída real; peer sem posse não muda
distribuição ou transporte. Escrita privada revalida após ACL e antes do rename.
33 novos; direcionadas70/45 PASS sobrepostas e final7 arquivos/82 PASS;
tipos/build44153 e compilado12975/9BJZRR com MediaMTX real local PASS.
Integral3978 terminal215 arquivos/2135 testes PASS,803,16s, um worker,
reporter persistente conferido. Não atribuir2102 PASS nem
ensaios EXEC-01 abaixo à fonte atual. Não prova porta/API própria, isolamento
entre bancos, entrega física, outro host/HA, browser ou pacote final.

Checkpoint anterior EXEC-01: posse nativa local durável, migração32, antes de spawn,
pipe privado/fila/dispatch/registro, token por geração e host opaco do SO.
56 novos/213 direcionados PASS; tipos/build e ensaios nativos locais yop8U7 e
sN053O PASS. Integral final212 arquivos/2102 testes PASS,750,21s, um worker,
reporter persistente conferido; o PASS2046/SEC-22I abaixo é histórico.
Peer vivo recebe409 em CUE/TAKE/STOP sem segundo engine; cursor/posição e as-run
do predecessor retomados somente após parada comprovada. Vídeo sintético real,
NULL/fakesink, backup, filhos/listeners próprios encerrados. No compilado o
engine morreu com o pai; órfão sobrevivente NÃO foi ensaiado, só fixtures.
Legado/inconclusivo permanecem bloqueados, não presumidos livres. Ainda faltam
reparo explícito/UI, posse global de MediaMTX/config/relays, outros contratos,
outro host e homologação física/visual. Não é promoção/HA ou
pacote final. Próximo: cercar recursos globais ANTES de seus efeitos; depois
legado/interface e categorias/raízes/scan/integrações com contratos próprios.

SEC-22I implementada em software: conferência de remoção/limpeza do acervo,
prova original, migração 31 e auditoria atômica. UI mostra usos diretos e
fallbacks, bloqueios e subconjunto; não existe force cego. Cargas antigas do
runtime são invalidadas sem CUE/TAKE/STOP; fila do engine reserva comando antes
do primeiro microtask. Feedback local MAM não sobrepõe catálogo/QC mais novo.
Complemento: QC por canal participa da prova pelo counter 23, inclusive ABA,
mesmo sem alterar media_assets; fases duráveis desconhecidas recusam conferência.
89 testes novos; última direcionada 117 PASS; tipos/build finais PASS.
Compilado kYCBbt PASS, duas instâncias temporárias, PGM/PVW SIMULATED,
restart/backup/rollback, mudanças QC/ABA e fases inválidas recusadas, bytes
de arquivo placeholder preservados. Build I atual server.cjs
66D17E3320C4D1121E67292E6FAC68EA4241FE570EE96EDE157542E4E61458AC;
web index-B9cvqlkL.js/index-CAZIMpiP.css; engine inalterado.
Integral final I PASS:209 arquivos/2046 testes,07h07m14 BRT,867,80s,um worker;
relatório persistente conferido, sem falhas ou pendências. A integral intermediária
2038 PASS ocorreu antes desse complemento; manter sua atribuição histórica.
Sem homologação física/visual, dois engines nativos ativos ou pacote final.
Categorias/cores, raízes/scan, integrações e demais frentes continuam abertas.

Histórico SEC-22H: título/categoria do acervo por prova original, auditoria
atômica e editor explícito. Complemento H: live separado das ações MAM e merge
da varredura com decisões atuais sob writer. 74 testes novos; 125 distintos
aprovados em duas rodadas direcionadas complementares, tipos/build PASS.
Build atual server.cjs FD7AB194AADFAE1FCE679184CA79B045F6C875C822F7CC271AE6D400B8EB1905;
web index-DpojKwrr.js/index-CAZIMpiP.css, engine inalterado. Compilados atuais
tRbSQP/A8yKEo/ZsVUNC PASS; integral final 203 arquivos/1957 testes PASS,
00h29m35 BRT, 815,22s, um worker. Primeira integral H: 1945 PASS/2 FAIL em ACL
Windows; cinco testes ACL repetidos isoladamente PASS. Guarda não relaxada;
causa exata da primeira recusa não comprovada. Ensaios 9c8WXC/EkYJpN/DaVbDD
PASS pertencem à build H anterior, não automaticamente à atual.
Remoção/limpeza, cores/cadastro de categorias, raízes/scan e integrações continuam
separados; não tratar esta etapa como acervo integralmente concluído.

SEC-22G implementada em software: contas, acesso, bootstrap e sessões com
conferência original, autorização fresca e auditoria atômica. Migração 30,
87 novos testes/121 direcionados, tipos/build e compilados b3GGxR/N0huIK/ywtS43 PASS.
Integral desta build terminal PASS: 198 arquivos/1883 testes (23h42m33 BRT,
240,95s, até quatro workers Windows).
Não atribuir a integral SEC-22F automaticamente à G. Escopo amplo permanece ativo.

SEC-22F validada em software: inicialização de artes uma única vez, migração 29,
preservando catálogos antigos/vazios e decisões de renomear/excluir. 20 testes
novos, direcionada 51, tipos/build, compilados a0tfx2/hYc30X e integral
192 arquivos/1796 testes PASS. A integral SEC-22E abaixo é histórica.

SEC-22E validada em software: templates/slate conferidos, migração 28,
auditoria atômica e exclusão vinculada recusada. 67 novos testes, direcionada
112 testes, tipos/build, compilados JihJIy/xWEU0z e integral 191 arquivos/1776 PASS;
não atribuir ensaios SEC-22D automaticamente à build atual.

SEC-22D validada em software: CRUD de faixas por revisão original, migração 27,
auditoria atômica, proteção de sobreposição em projetos e revisão durável
nas propostas diárias. 65 testes novos aprovados nas rodadas direcionadas;
tipos/build finais, integral 186 arquivos/1709 testes e compilado 8WyocI PASS.
Regressões compiladas de projetos bvhDba e multiview qG8G1M também PASS;
resultados anteriores não valem automaticamente nesta etapa.

Retomado em 05/10/2026 por solicitação do operador. SEC-22C protege a edição
compartilhada de layout multiview, separando global/canal e telemetria histórica
de sinal. 184 testes direcionados, tipos/build, compilado 6pc34o e integral
181 arquivos/1644 testes PASS. Ver resultados e limites no fim.
SEC-22B recusa papéis
inválidos e torna a emissão de sessão/auditoria atômica; integral 176 arquivos/
1600 testes, tipos, build e ensaio compilado jSBHVN PASS. SEC-22A protege o
cadastro normal de entradas ao vivo; seus três ensaios pertencem à build
anterior registrada naquela etapa. Ver limites/resultados no fim.
SEC-21A/B/C registram integridade, conferência e contrato semântico de projetos.
Não considerar o checkpoint anterior como release final.

Pausa histórica solicitada após QC em 04/10/2026: UI-04 + SEC-20 foram o
checkpoint preservado. Objetivo retomado/ativo; não há conclusão integral
nem pacote final 100% homologado.
Pendências consolidadas e prompt pronto para retomar:
[Continuação após QC](PROMPT-CONTINUACAO-APOS-QC-2026-10-04.md).
Resultados anteriores mantêm sua data/escopo; a pausa não descreve o estado atual.

SEC-18 — presets conferidos em 03/10 às 20h52: criação, remoção e aplicação
SRT/RTMP exigem o ETag do canal que o operador recebeu. GET entrega lista e
counter de um snapshot privado. Migração 22 acrescenta três triggers ao
contrato 21, cobre ABA/mudança de dono e invalida uma vez as telas anteriores.
Startup/restauração recusam proteção adulterada. Sessão/papel/canal/arquivo
do canal são reconferidos no commit imediato; escrita, counter e auditoria
sem destinos privados são atômicos. Falha reverte tudo antes de rebuild.
Preset antigo com protocolo/destino incompatíveis não é aplicado. Excluir
preset não elimina saídas já criadas. Commit seguido de falha de engine é
resposta de configuração gravada com aviso, nunca rollback ou entrega fictícios.

A tela preserva a lista em erro, distingue consulta de lista vazia e não
rotula habilitação como ATIVO NO AR. Rascunho guarda sua revisão; atualizar
lista não substitui a prova de abertura. Reabertura explícita pede confirmação
antes de descartar os campos; sucesso próprio pode avançar a própria base.
Troca de canal remonta o editor e respostas de consultas antigas são ignoradas.
Monitores já leves não geram UPDATE/versão nova a cada sincronização; upgrade
real continua reduzindo resolução/FPS/bitrate sem alterar o programa.

144 arquivos/1099 testes passaram às 20h49m53 (101,66s); tipos, build, cargo
check e diff check passaram. Ensaio r6LjSm: dois servidores compilados HTTP
64946/64947, PIDs 19944 e 6516→7444, revisão 1→11, vencedor único tanto em
canal quanto em preset, ABA recusado, três falhas de auditoria com rollback,
remoção preservou saída aplicada, reinício e backup/migrações 22 passaram.
SQLite compartilhado/SIMULATED, não replicação, HA, entrega física ou visual.
Primeiro verificador parou por import de dependência fora do workspace do
servidor; ajuste para edição SQLite de nome, sem import externo. Fixtures
iniciais tinham argumento default de headers e inserção de segredo legado;
corrigidos para ausência real de header e inserção pelo cofre, testes repetidos.

QA 4041 atualizada após conferir processo exato, PGM parado/CUE vazio, políticas
DISABLED/v0 e backup pré-migração. Novo PID 29152/sessão 32071. Canal 1 conserva
14 itens/revisão 25494162001883; RW 13/revisão 1744; ambos SIMULATED/parados.
Counter de configuração agora 168123508636337 após migração 22; GET presets
retorna o mesmo valor/ETag por canal. HTTP 200 serve index-YSZ6XXGI.js /
index-CZEXkAEj.css, com reabertura e qualidade QC, não prova visual. SHA servidor
28C809D4E3373B302F27F304B5656B471C89DC564C8B6CEB00C57991A8F2213B.
Backup pós-update 23-51-39-323Z-4e71b72a-c4da-444f-b63c-f756f27726ff validou
integrity/foreign keys/migrações 22/cofre; removed[]. Pacote r21 preservado.
Objetivo amplo aberto: próprios CRUD/hot-ACK de saída e reconciliação durável,
projetos/QC e demais guardas, banco separado, HA/replicação/fencing, pacote
Windows final e homologação física/visual/soak. A revalidação isolada anterior
do QC não encerrou novos requisitos; esta etapa fez mudanças de implementação.

SEC-17 — configuração conferida em 03/10 às 20h18: PATCH do canal e
simulação/aplicação de FPS exigem ETag próprio ao canal da abertura. Ausência
428, formato inválido/outro canal 400, versão superada 409; não busca versão
nova para autorizar rascunho antigo. Sessão/papel/dono reconferidos dentro do
commit imediato. Mudança de canal, contador/revisões editoriais e auditoria
antes/depois ficam atômicos; falha de auditoria reverte tudo antes de fechar
runtime. Alterações em saída invalidam o formulário do canal. Isso ainda não
impõe revisão nas próprias rotas CRUD de saída/preset/projeto/QC e afins.
FPS sela também os campos incluídos na confirmação e contadores editoriais;
ABA de item/configuração não restaura validade de simulação antiga. STOP/CUE
limpo, histórico/tempos convertidos e nova publicação continuam obrigatórios.
Formulários guardam baseline de abertura, enviam apenas campos alterados,
mantêm edição em recusa e só descartam ao reabrir explicitamente (com aviso).
Mudança de canal durante resposta não sobrescreve o formulário novo. Após
conversão própria, consulta recarrega estado; falha exige reabrir, não finge
nova autorização. Reinício é solicitado, não sucesso físico presumido; erro
de reconstrução/recuperação retorna configuração já gravada com aviso, sem
anunciar rollback fictício. Navegação/uso visual ainda não homologados.
141 arquivos/1073 testes passaram às 20h14m20 (115,27s), tipos/build/cargo
check/diff check passaram. Primeiro fixture de fetch reutilizava Response
consumida; corrigido para resposta nova por chamada. Anotação de this no teste
de recuperação corrigida após diagnóstico do compilador; typecheck repetido.
MEFrv4: dois servidores compilados HTTP 64227/64228, PIDs 5908 e 24292→30316,
contador 1→6; uma escrita por revisão, ABA recusado, rollback conjunto,
formato selado, consulta após reinício idêntica e backup restaurado passaram.
SQLite compartilhado/SIMULATED: não é replicação/HA. XUVzCf: HTTP 64298,
engine release 13664→25852, PGM ativo recusado, corte 25/250→50/500, publicação
histórica byte-preservada e as-run 25/50 FPS, sem TAKE automático. Saída null,
sem publisher PVW, não física. eOSzbr (HTTP 64128/receptor local 64127) passou
reconfiguração geométrica com retorno PGM, saídas, restore, arquivamento,
reativação e comandos sem replay com as guardas novas; antes do ajuste final
de mensagens/erro de recuperação. Nenhum desses ensaios homologa placa real.
QA 4041 agora PID 25440/sessão 10317 após conferir executável/comando/listener
e PGM parado/CUE vazio; Canal 1 14/revisão 25494162001883 e RW 13/revisão 1744
preservados. Políticas DISABLED/v0 conferidas antes. GET configuração HTTP 200
com ETag, PATCH sem revisão 428 manteve DTO/counter idênticos. HTML/JS HTTP 200
com reabertura e QC em qualidade, não prova visual. Bundle index-EXIpb3Se.js /
index-CX3GfQEa.css; SHA servidor
ACB10BC525F72F2FF38630FB11203146C79A366760B985B6FA5BBF2356059781.
Backup pós-update integrity/foreign keys OK, migrações 21/cofre verificado,
nenhum backup removido; cinco PIDs finais dos verificadores ausentes e zero
engines nativos remanescentes. Pacote r21 preservado; novo pacote final não
produzido. Objetivo integral aberto: guardas restantes, banco separado,
HA/replicação/fencing, homologação física/visual/soak e entrega portátil final.

QC — revalidação em 03/10 às 19h52: Ver em qualidade/retorno ao preview leve
continuam na barra acima do player. Indicadores de scopes/áudio agora acompanham
a fonte exibida: proxy, player do original, quadros JPEG ou preview ao vivo.
Quadros não anunciam escuta; trocar qualidade limpa estatísticas anteriores.
Alvo de loudness usa a configuração do canal, sem -23 fixo na tela. Não é
certificação de cor/scopes. Ensaio compilado Bk77K1 (HTTP 63639/PID 25648):
JPEG 3840×2160 contra 320×180 leve, original SHA idêntico, QC PENDING e zero
decisão nova. Processo próprio encerrado. Playback/visual no navegador não
validados nesta revisão; qualidade de live continua fora desta opção.
139 arquivos/1047 testes passaram às 19h48m29 (119,35s), typecheck, build,
cargo check e diff check passaram. JS index-DG5w5sef.js/CSS index-CX3GfQEa.css;
SHA servidor 6E38AD0F782FC26FF7769002F8728E486C5D943D8671A5F1ECF93E2F14374B29.
QA 4041 atualizado para PID 28652/sessão 87015 após conferir identidade,
listener, PGM parado/CUE vazio e preservar duas grades: Canal 1 14/revisão
25494162001883; RW 13/revisão 1744. Políticas DISABLED/v0 permaneceram;
transportes SIMULATED. HTML/JS HTTP 200 incluem controles, não prova visual.
Backups antes/depois da migração restaurados com integrity/foreign keys OK,
cofre verificado, nenhum backup removido. Pacote r21 não foi sobrescrito.

Configuração — checkpoint anterior (superado por SEC-17 acima): migração 21 cria contadores por
canal com triggers SQL de canal/saídas, tombstones e limite numérico. DTOs de
consulta capturam campos/revisão no mesmo snapshot; startup/restauração
recusam contrato ausente ou adulterado. Seis testes conferem ABA, rollback,
outro escritor/reabertura, remoção/reinserção, saídas e backup. Esta é a base,
não proteção completa da edição: If-Match nas rotas de configuração, sessão
revalidada no commit e baseline imutável dos formulários ainda pendentes.
Nenhuma dessas guardas será anunciada como aplicada apenas pelo contador.
Objetivo integral continua aberto: demais mutações, banco operacional separado,
HA/replicação/fencing, pacote final e homologações física/visual/soak.

AUDIO-03 — integração no produto em 03/10 (complementa a base nativa abaixo):
configuração 2/8/16 persistida por canal, padrão legado 2, migração 20
transacional/idempotente e CHECK SQL validado em startup/restauração de backup.
Formato do canal oferece total; diálogo de áudio substitui seletor SDI fictício
por atribuições reais: entrada numerada da trilha escolhida → par auxiliar de
saída, ganho -60..+12 independente do master. Não atribuído fica em silêncio.
Não presume nomes SAP/clean/audiodescrição; medição AUTO continua exclusiva
do mix master e não certifica loudness dos auxiliares. Formulário conserva
edição após recusa, valida canais conhecidos e não usa zero legado como prova
de ausência. Desconhecido exige verificação nativa; ausência comprovada recusa.
Servidor aplica trilha/master/auxiliares juntos por escopo/revisão. Escopo
amplo/padrão compartilhado verifica todos os canais e trilhas dos alvos antes
de escrever; um destino estéreo incompatível reverte todos, inclusive padrão
e escolha de trilha. Total novo exige valor anterior conferido (428/409), PGM
parado e CUE limpo. Redução não apaga pares incompatíveis para conseguir salvar.
Mudança permitida conserva fotografias históricas, marca-as SUPERSEDED e
exige nova publicação, sem TAKE. Configuração de FPS e áudio é separada.
Publicação congela total/pares, conferência incorpora o contrato, rollback,
execução, contingência/cache/continuidade recusam total incompatível. Publicação
antiga sem campo continua estéreo, nunca 8/16 presumido. Mudança após CUE
invalida TAKE; checkpoint inclui total e não retoma em outro barramento.
Projeto legado restaura estéreo e reconfere seus pares antes do commit.
Ensaio compilado/release jfKqnw (8, HTTP 62480, servidores 4280→24508,
engines 30716→23752): pares 3–4 e 7–8 atribuídos, master medido -23,281 LUFS.
PYZp0I (16, HTTP 62534, servidores 29580→21412, engines 29088→9232): pares
3–4 e 15–16 atribuídos, master -23,286 LUFS. lTSnot (2, HTTP 62696,
servidores 15884→29428, engines 18288→29988): regressão estéreo -23,253 LUFS.
Os três verificam pares/master congelados, ganho -6 após roteamento, medição
-8,761 LUFS durável após reinício, seleção real indisponível preservando PGM,
sem publicação de preview. Processos próprios encerrados. Amostras de todos
os canais/limiter foram medidas nos testes Rust anteriores, não pelo medidor
estéreo HTTP destes ensaios. Sem placa física, rede externa ou latência homologada.
138 arquivos/1035 testes passaram às 19h13m48 (102,11s); tipos/build/cargo
check/diff check passaram. A primeira rodada encontrou backup antigo sem
schema_migrations: compatibilidade restaurada sem relaxar contrato da migração
20. Primeiro ensaio 8 foi recusado por zero legado; corrigida a distinção
desconhecido/sem áudio e repetido com sucesso. Falhas não contam como prova.
QA 4041 atualizado para PID 20416 / sessão 24842, transportes SIMULATED
(processos ENGINE sem PID; engines=2 em health conta runtimes, não hardware).
Bundle index-egGfFQFa.js / index-CX3GfQEa.css. Duas grades preservadas:
Canal 1 14/revisão 25494162001883; RW 13/revisão 1744; PGM/CUE vazios/parados.
Políticas de publicação/continuidade conferidas DISABLED/v0 antes do reinício.
Backups antes/depois restaurados com integrity/foreign keys OK/cofre verificado;
19→20 migrações, sem reinterpretação de publicações ou edição das grades.
Servidor atual SHA256 ED9CCAA1006B39C96DF7DF4EBA9FE1A1C7C195C1762AD2ECF84E9A4845ED6EB6.
Ainda pendentes: homologação SDI/DeckLink e visual/uso no navegador; novo
pacote final e demais requisitos da matriz. Não declarar o objetivo concluído.

Fechamento AUDIO-03: declarações brutas de áudio agora acompanham o asset
independentemente de geometria de vídeo. hasAudio NULL/canais NULL continuam
desconhecidos; false explícito prova ausência. Servidor, publicação e formulário
usam a mesma leitura; trilhas conhecidas não somem quando probe de vídeo falta.
138 arquivos/1036 testes passaram às 19h24m22 (112,89s); tipos/build passaram.
Servidor final SHA256 FAF4CE52038481D6B0D33D8C334876DFD73E76A7AD658903A7879DCF88E06F37.
Repetições com este binário: QHCecx (8, HTTP 62918, servidores 8048→29968,
engines 4788→4596) master -23,213 LUFS; IX54cj (16, HTTP 62948,
servidores 10916→17236, engines 26528→28240) -23,242 LUFS; ambos passaram.
ARxKkJ (8, HTTP 63098, servidores 25616→30696, engines 29608→23224)
passou com fixture 4ch real e has_audio/audio_channels/audio_tracks todos
NULL no banco: decoder entregou master e aceitou auxiliares; a fixture 2ch
real continuou recusada. AUTO -23,213 LUFS e resultado durável após reinício.
Servidores/engines próprios encerrados. Não é SDI físico ou rede ao vivo.
QA final: PID 26872, sessão 47471, JS index-AHoIBJCO.js/CSS index-CX3GfQEa.css
HTTP 200, declarações brutas presentes na API e nenhum PID de engine nativo.
Grades novamente conferidas 14/25494162001883 e 13/1744, PGM/CUE vazios,
paradas, padrão estéreo preservado. Não houve inspeção no navegador.

Revalidação do QC em 03/10: botão Ver em qualidade permanece acima do player,
com retorno ao preview leve e tela cheia. Ensaio 02mQw3, servidor compilado
isolado PID 17220 / HTTP 58016: quadro do original 3840×2160, preview 320×180,
SHA do original idêntico, QC PENDING e nenhuma decisão de aprovação criada.
O servidor próprio foi encerrado. QA 4041 entrega index-CwIvxGe0.js e mantém
o modo leve por padrão. Qualidade original é opt-in para arquivos, não live;
erro de codec informa inspeção por quadros, sem prometer áudio ou playback.
Suíte atual: 133 arquivos / 1019 testes, 96,00s, início 18h18m57; tipos,
build servidor/web, cargo check e diff check passaram. Verificação HTTP/SSR
e geometria JPEG não substituem homologação visual/playback no navegador.

AUDIO-03 — base nativa multicanal em 03/10, ainda PARCIAL no produto:
engine aceita --audio-channels 2/8/16 (padrão 2). Par 1 continua master;
pares auxiliares explícitos selecionam um par da trilha decodificada,
com ganho independente. Pares sem atribuição permanecem silenciosos;
seleção ausente/inválida recusa o candidato sem trocar o PGM. Não há
inferência de SAP, clean feed ou audiodescrição a partir de outro par.
Limitador vincula L/R dentro de cada par, sem limitar o master por um
auxiliar mais alto. Medidores, preview e publicadores IP permanecem estéreo
com os canais 1–2, sem somar os auxiliares. SDI prepara S32LE/48k em 2/8/16,
mas nenhuma placa física foi homologada. Captura DeckLink solicita 2/8/16
conforme os canais de entrada efetivamente necessários, não o total de saída.
Conversão de canais numerados usa identidade explícita e máscara sem posições;
fontes: https://gstreamer.freedesktop.org/documentation/audioconvert/index.html
e https://gstreamer.freedesktop.org/documentation/decklink/decklinkaudiosink.html.
Para 8/16, eliminado produtor/mixer permanente redundante; interaudiosrc
selecionado fornece silêncio quando vazio. Arquivo aguarda buffers reais
no preroll com prazo limitado, em vez de presumir prontidão pelo estado GST.
Falha assíncrona durante TAKE agora gera item_error não fatal, cancela apenas
o candidato e preserva o programa anterior; servidor limpa pendência sem
registrar saída do VT ou assumir confirmação de troca.
Testes nativos completos, incluindo OMT local oficial: 65 passaram,
104,66s. Amostras reais 8/16 comprovam CUE sem áudio no PGM, TAKE com ganhos
independentes, seleção indisponível preservando PGM, A/B sem vazamento de
pares antigos e STOP silencioso. Fault injection testa a falha pendente,
não um emissor NDI físico. OMT local entrega vídeo/áudio reais de uma fonte
estéreo com mapeamento auxiliar explícito; não prova rede/placa externas.
Coleta após estabilização de 1500ms não homologa latência de TAKE.
Engine release SHA256 F93B65160F091E4F51B0AD3E206F20157A36D5C5CB4C75F32A68DF6E26FFF051;
servidor 8AC641EB9AD9D47EAD2FE7C4BA7344EFF8E6774B1E0452E21E71EC7E62C14BFA.
Regressão estéreo VgPIcN com servidor compilado/engine release passou:
seleção 3–4, ganho -6 após roteamento, mix medido -8,761 LUFS, AUTO no PGM
-23,237 LUFS, resultado durável após reinício e canais reais ausentes
preservando o programa. Ensaio isolado encerrou seus dois servidores e
engines. Não valida CUE/PVW visual, publicação IP ou placa física.
Naquela etapa de base ainda pendiam contrato persistido por canal/item,
publicação, API e interface; foram integrados no complemento AUDIO-03 acima.
A validação física e o novo pacote portátil continuam pendentes. O padrão
permanece estéreo; o seletor fictício foi substituído pelo editor de pares reais.

QC — complemento do botão Ver em qualidade em 03/10: mantida a barra
própria acima do player, original por escolha e retorno ao preview leve.
Controles e scopes agora derivam o mesmo modo do player realmente montado,
sem estado paralelo de vídeo/quadros. Sem URL reproduzível ou após erro de
decodificação, inspeção por quadros fica pausada: play desabilitado, sem
ícone de reprodução sobre imagem estática nem indicação falsa de playback.
A régua permanece disponível. Trocar qualidade não aprova material nem dá TAKE.
24 testes específicos e suíte completa (133 arquivos / 1018 testes, início
16h25m36, 91,52s) passaram; typecheck, build servidor/web e diff check
passaram. Ensaio nativo FXirpJ em servidor compilado isolado (PID 15312,
HTTP 56549): JPEG 3840×2160 contra preview 320×180, SHA do original idêntico,
QC permaneceu PENDING e sem decisão. Processo encerrado pelo ensaio.
QA HTTP 4041 já entrega index-K1PlsxIO.js / index-CHBQOgyM.css, ambos 200;
botão, retorno e aviso de quadros presentes no bundle. Sem reinício ou edição
das grades: Canal 1 14/revisão 25494162001883, RW 13/revisão 1744,
ambas paradas e PGM/PVW vazios. Não houve homologação de playback/layout no
navegador, live em qualidade, SDI físico ou novo pacote portátil.

TIME-07 / complemento TIME-04 em 03/10: montagem e publicação
recorrentes pela pauta implementadas, separadas da autorização TIME-06 para
entrar no ar. OWNED_EMPTY_DAYS, desligada por padrão. Conferência HMAC vincula
canal/formato/QC/pauta, versão da política, conta/permissão, antecedência,
limite, datas futuras e grades já presentes. Habilitar exige prova e versão
atual; leitura não monta/publica nem cria runtime. Antecedência 1–7 dias,
limite 1–5000 itens/dia, padrão 2 dias/2000 itens. Pauta deve cobrir os sete
dias de 0–1440 min, sem gap/sobreposição. Dia civil com mudança de fuso exige
programação manual. Grade manual/incompleta não é substituída; grade própria
já publicada é preservada e publicação alterada exige intervenção explícita.
Acervo aprovado pode evoluir sem liberar material pendente; perfil de canal,
VIDEO/SHA/corte/áudio e repetição são conferidos. Critério usa as-run e reservas
de publicações anteriores, com timestamps previstos, inclusive entre dias.
Seleção determinística/exata em auxiliar CJS separado, baixa prioridade,
limites de acervo/itens/input/output/tempo; auxiliar não recebe DB/cofre/engine
nem credenciais do ambiente. EOF do dono encerra espera pelo pedido. Parent
valida plano/faixas/repetição, confere bytes de cada edição aprovada e identidade
dos arquivos imediatamente antes do commit. Mídia/QC/histórico/pauta/formato,
reservas de publicação, datas e direitos são revalidados; não escolhe outro
vídeo após a conferência nem aplica corte/filler para esconder sobra.
Ledger protegido existente: RUNNING/READY/FAILED, claim IMMEDIATE e dono
host/PID/boot. Outro dono vivo/remoto/unknown não é roubado. Interrompido local
com PID comprovadamente morto vira FAILED; exige nova conferência, sem replay
ou publicação presumida. Grade + itens + fotografia publicada + READY +
auditoria são um único commit síncrono; falha de auditoria desfaz todos.
Cada dia é atômico: dia anterior concluído não é apagado se o seguinte falhar.
STOP canônico/externo e arquivamento suspendem. STOP autorizado sem view agora
também suspende automação; STOP sem direito não a desliga. Não envia TAKE,
não altera PGM/CUE, não aprova QC e não promete continuidade/sinal por duração.
Tela de programação contém painel recolhido, conferência→habilitar/desligar,
limites, motivo de recusa e trabalhos/datas. Troca de canal descarta respostas
antigas; direitos vêm do servidor. Antes da resposta, indica CONSULTANDO ESTADO,
não uma política desligada presumida. SSR é markup, não layout/uso no navegador.
Auxiliar schedule-planner.cjs é build-in e obrigatório nos scripts de pacote;
usa Node embutido, não tsx/tsc/pnpm no destino. Nenhum pacote final foi criado.
W3rWGh: servidor compilado, HTTP 53321, PIDs 10788→16396; arquivo Unicode real
de 1h/25fps verificado pela sonda release (duração 3600000000000ns e quadro).
Dois dias completos, 24 itens/dia/2160000 quadros, sem conflitos. Reinício após
primeiro READY preservou sua revisão e concluiu segundo dia; original/hash,
grade manual, aprovação e ausência de TAKE/as-run conferidos. Revisões
4342985b-b2e8-42f1-bb21-052b3ebe57bc e 6daadc66-6095-461e-9046-d6d61baaf1bd.
STOP suspendeu; reabilitação conferida + disable preservaram as publicações;
helper EOF retornou 2. G6zk2e/FGdIew repetiram estágios anteriores. Ensaios próprios
e portas encerrados. Primeiro ensaio VYqt1w excedeu o prazo de decodificação
integral de 1h; verificador corrigido para duração indexada + quadro real, sem
anunciar sucesso daquele timeout. Fixture fracionária foi corrigida para
1798/2589411 quadros, segundo os conversores reais, não alteração de timing
para acomodar expectativa errada. Teste adicional revelou STOP sem view e
orientou a correção; nenhum 404/falha foi contado como validação.
133 arquivos/1012 testes passaram às 16h03 (96,72s) e na repetição final às
16h11 (104,05s); tipos/build/cargo check e
diff check passaram. Aviso de tamanho JS permanece. QA 20284 foi encerrada
somente após confirmar executável/comando/listener, SIMULATED parado, CUE/PGM
vazios e contagens/revisões. QA atual PID 25848/session 48478/HTTP 4041, mesmas
grades Canal 1 14/revisão 25494162001883 e RW 13/1744. Ambas políticas editoriais
DISABLED/version 0/jobs 0, auxiliar disponível. index-CDgMfahy.js/CSS
index-CHBQOgyM.css e painel/QC HTTP 200. Sem nova validação de navegador,
reprodução PGM nativa desta montagem, saída física ou soak 24/48h. Não é HA.
Ficam abertos pares de saída SDI/PGM multicanal, guardas globais restantes,
banco operacional separado, HA/host B/replicação/fencing, pacote final e
homologação física/visual/longo prazo. Objetivo integral continua ativo.

QC — controle de qualidade explícito em 03/10 às 15h17: botão de arquivos
movido da barra de timecode para uma barra própria acima do player, com
quebra de linha para não disputar espaço com os contadores. Ver em qualidade
carrega a edição original conferida por hash; Voltar ao preview leve conserva
o modo econômico. O modo selecionado, custo de rede/codecs e fallback por
quadros são identificados separadamente; selecionar original não afirma que
o navegador já o decodificou. Tela cheia tem nome acessível. Troca limpa a
mensagem anterior, sem aprovação automática nem comando ao PGM. Safe permanece
desligado por padrão. Entrada ao vivo continua leve, sem anunciar HQ inexistente.
Novos cinco testes SSR cobrem os estados da barra, incluindo live/sem arquivo;
SSR não equivale a interação/layout visual no navegador. Testes específicos:
18 aprovados; suíte completa: 129 arquivos/988 testes, início 15h13, 108,13s.
Typecheck, build servidor/web, cargo check e diff check passaram. Aviso de
tamanho do bundle permanece. Ensaio jm8f8l com servidor compilado, PID 8700,
HTTP 50330 e arquivo Unicode 4K real: JPEG HQ 3840×2160, leve 320×180 e SHA
do original idêntico; inspeção manteve QC PENDING, sem nova decisão. Processo
e porta do ensaio encerrados. Não valida playback browser, live HQ ou SDI.
QA existente PID 20284/HTTP 4041 já serve index-Blur3YVv.js e
index-ze-3EOrk.css sem reinício: HTTP 200, barra/botão/retorno presentes no
bundle. Grades preservadas: Canal 1 14/revisão 25494162001883 e RW 13/1744;
ambas SIMULATED paradas, PGM/CUE vazios. Não houve novo pacote portátil nem
homologação visual/física; demais pendências globais continuam abertas.

Continuação TIME-06 em 03/10 às 14h54: política recorrente PUBLISHED_ONLY
implementada no servidor e exposta no Master, dentro de Próxima grade.
Desligada por padrão; leitura/conferência não habilitam, não carregam grade,
não aprovam material e não aplicam TAKE. Habilitar exige publicação inicial,
engine nativo pronto, conta/permissão atual e prova da configuração/primeira
passagem, vinculada a formato, versão da política e origem. Atraso máximo de
0–180 min é conferido também no EOS. Publicações futuras são selecionadas pela
cronologia congelada, não por data/título do rascunho; início empatado,
intervalo/sobreposição ou prazo vencido não são resolvidos pulando outra grade.
Cada origem enfileira um pedido determinístico, reusa o ledger de TIME-05 e
somente PGM nativo confirmado instala destino/checkpoint/as-run. Políticas e
auditoria ficam nos registros protegidos existentes, sem tabela/migração nova.
STOP canônico/externo, cancelamento autorizado e arquivamento suspendem; falha,
incerteza e perda de autoridade/formato exigem nova conferência. Não há replay
automático de passagem falha/incerta. Versão da política muda ao suspender e
invalida intenções/provas antigas. Cancelamento inválido não suspende política.
Dono local inclui host/PID/boot/engine; outra instância não rouba processo vivo.
Retomada exige ambos PIDs locais comprovadamente mortos; estrangeiro/unknown
permanece bloqueado, sem inventar fencing remoto. Claim e auditoria ocorrem no
mesmo commit. API omite dono/worker/contrato privado e distingue CURRENT_SERVER,
WAITING_RECOVERY e OTHER_OR_UNKNOWN_SERVER, sem equiparar habilitação a sinal.
Passagem enfileirada valida política/autoridade atuais no EOS e cessa após
desligamento. Campo público workerState é só categoria, nunca processo/dono.
0wJtIA: servidor compilado em HTTP 64730, PIDs 26572→12312; engines release
25300→24756. Três arquivos Unicode reais, saída null/PVW desligado. Duas
passagens consecutivas entre publicações confirmaram PGM/as-run; reinício no
primeiro VT preservou cursor, intent e identidade, recuperou dono após ambos
processos acabarem e não duplicou a fila. Habilitar não fez TAKE; STOP suspendeu.
Revisões 6c8fc9c9-2900-4b9f-81aa-7fcb58267ad7,
bbbb5f97-f3a8-46fa-97e5-936d21212898 e f3d4cb13-5dc2-4856-b0b6-9a9a7557ab0d.
PpqkED repetiu o fluxo na build anterior desta etapa. Ensaios próprios encerrados.
Validação final: 128 arquivos/983 testes, início 14h49, 85,28s; typecheck,
build servidor/web, cargo check e diff check passaram. O primeiro ensaio revelou
428 convertido em 409 pelo wrapper: corrigido preservando CollaborativeEditError.
Teste de privacidade foi ajustado para propriedade worker, não substring da
categoria pública workerState. Nenhuma falha foi tratada como prova de sucesso.
Guard MEDIA-06 também usa identidade operacional ativa, não só flag editorial
publicationRequired (limpo ao publicar); teste cobre publicação ativada sem SHA.
QA própria anterior 23740 encerrada só após reconferir processo/comando,
SIMULATED parado, CUE/PGM vazios e contagens/revisões iguais. QA atual 20284 /
session 85260, HTTP 4041, mantém Canal 1 14/revisão 25494162001883 e RW 13/1744.
Ambas políticas DISABLED/version 0/worker OFF. Bundle index-D_qlRVAI.js e CSS
index-D9GOEo6B.css HTTP 200 contêm os controles e QC em qualidade; aviso de tamanho
permanece. Não é inspeção visual, reprodução browser, CUE/emissão física ou HA.
PUBLISHED_ONLY não monta nem publica automaticamente a pauta editorial; essa
parte de TIME-04 continua pendente, assim como pares SDI/PGM multicanal, guardas
globais restantes, banco separado, HA/replicação/fencing, pacote final e ensaio
físico/visual/longo. Nenhum novo pacote portátil produzido; objetivo ativo.

Continuação MEDIA-06 em 02/10: identidade real da mídia publicada agora é
conferida no transporte nativo, não só na ingestão/metadata. SHA integra o
contrato do CUE/preroll; arquivo local é verificado antes de carregar e antes
do TAKE, incluindo retomada, próxima playlist/contingência e preparo antecipado.
Publicação obrigatória sem SHA válido não aceita presença de arquivo como prova.
Leitor usa handle, compara inode/dispositivo/tamanho/mtimeNs/ctimeNs antes/depois
de calcular SHA e confere novamente o caminho. Cache de evidências é limitado
a 512 caminhos por verificador e invalidado quando identidade ou SHA mudam.
Arquivo substituído após CUE exige novo CUE mesmo quando os bytes forem
restaurados. Mudança/restauração durante preroll recusa decoder ambíguo; próxima
tentativa prepara novamente. Medição histórica READY não autoriza conteúdo novo.
Inspeção original e arquivo de versões usam o mesmo verificador robusto.
Falha de versão devolve HTTP 409/MEDIA_VERSION_CHANGED com ação corretiva.
Não manda STOP/TAKE para o PGM anterior e não cria as-run de corte recusado.
Unpublished legado sem SHA continua sem prova de versão; URI legada não é
homologação de mídia. Checagens não são lock/WORM contra escritor externo
futuro: arquivos controlados/arquivados continuam sendo a opção operacional.
Ensaio Glkmv7: servidor compilado PID 21188, engine release 24032, HTTP 54295,
saída null, sem PVW. Original Unicode sem media_versions/cópia de cache; cache
indisponível propositalmente. Após medição/aplicação AUTO/publicação, troca dos
bytes foi recusada 409; PGM anterior continuou avançando, nenhum as-run do
arquivo alterado. Restauração entrou com AUTO a -23,224 LUFS, um as-run.
Revisão 70c88e43-a7b7-47bd-94fd-82ff47a80abe, medição
6abd0b3c-410c-4e6f-a66a-01f8db4fb520. Ensaios Glkmv7 e LbeZh7 encerraram seus
próprios processos/portas; não provaram CUE/saída física, live ou navegador.
Validação final: 126 arquivos/970 testes, início 12h42, duração 105,23s;
typecheck, build servidor/web, cargo check e diff check passaram. Bundle
index-XO-FB8En.js / index-D9GOEo6B.css; aviso de tamanho permanece.
QA própria 5724 encerrada após reconferir PID/comando, canais SIMULATED parados,
PGM/PVW vazios e grades intactas. QA atual PID 23740/session 46496, HTTP 4041,
preserva Canal 1 com 14 itens/revisão 25494162001883 e RW com 13/revisão 1744.
Index/bundle HTTP 200 incluem QC em qualidade/medição, sem prova visual.
Não se criou pacote portátil novo. Permanecem pares de saída SDI/PGM multicanal,
publicação recorrente TIME-04, guardas globais restantes, banco separado,
HA/replicação/fencing, pacote final e homologação física/visual. Objetivo ativo.

Revalidação UI-03 em 02/10 às 12h29: build web index-D0VTIg0B.js servido em
HTTP 200 na QA, com Ver em qualidade e Voltar ao preview leve. Testes de markup
QC e rotas de preview: 2 arquivos/10 testes aprovados. Ensaio qa4CSM em banco
isolado, servidor compilado PID 6028/HTTP 54031, confirmou JPEG original
3840×2160, preview 320×180 e bytes originais com SHA idêntico. QC continuou
PENDING/sem decisão. Servidor do ensaio encerrado; QA e grades preservadas.
Não prova playback, composição visual ou aferição de cor no navegador.

Continuação AUDIO-02 em 02/10 às 12h23: medição real do mix escolhido e ganho
AUTO ligados ao diálogo de áudio. Novo auxiliar rplayout-audio-analysis usa o
mesmo roteador e medidor BS.1770 do engine, mede a trilha escolhida do arquivo
inteiro antes do ganho/limiter e recusa áudio ausente/incompleto. Botão Medir
mix escolhido é explícito; live continua MANUAL/OFF, sem inventar uma medição
de arquivo. Matriz/trilha/versão distintas invalidam o resultado exibido.
Fila durável usa registros protegidos AUDIO_MIX_ANALYSIS; autorização/revisão
da tela conferidas na transação de criação, um claim por trabalho, limites de
fila e worker separado de baixa prioridade. Consulta respeita item/canal e
não expõe worker/caminho. READY é vinculado a SHA, trilha e matriz; aplicação
revalida todos os alvos do escopo, usa exclusivamente os números persistidos
do medidor e não aceita ganho/loudness fabricados pelo cliente. Padrão exige
compatibilidade com trilha inicial. Nenhuma análise aprova QC ou aplica TAKE.
Mudança de mídia durante análise descarta resultado. Encerramento marca só o
trabalho próprio como FAILED; queda comprovada do dono local não vira sucesso
ou repetição automática. Claims de outro host/PID ainda vivo não são roubados.
O auxiliar encerra ao perder o pipe do servidor, sem decoder órfão. Medição
FILE não é medição específica do corte TRIM ou monitoração da fonte live.
Validação integral final: 125 arquivos/961 testes, 12h19, 102,70s. Typecheck,
build servidor/web, cargo check, release do auxiliar, 13 testes Rust dele e
diff check passaram. Bundle index-D0VTIg0B.js / index-D9GOEo6B.css; aviso de
tamanho permanece. Scripts de pacote agora incluem/verificam o auxiliar, mas
nenhuma nova release portátil foi criada/verificada; r21 permanece imutável.
mXjYaZ: servidor compilado HTTP 53849, PIDs próprios 21380→15512 e engines
3576→6864. Medição 59430d0c-2064-4375-9170-709e62227d41 persistiu após reinício
parado; não alterou revisão editorial ou PGM durante análise. Mix 3-4 medido
-8,761 LUFS; AUTO chegou a -23,202 LUFS no medidor real do PGM. Recusa de par
inexistente preservou programa. Revisão AUTO publicada
ef98d045-3186-47b0-af5f-5bd4feb9c8c6. Saída null, sem PVW: não prova CUE físico,
emissão/recepção externa, DeckLink, SDI/NDI/OMT ou inspeção visual no navegador.
p839O4: auxiliar release decodificou PCM de duas trilhas reais em caminho
Unicode; -14,760/-34,760 LUFS, diferença 20,000 LU. Inversão manteve loudness;
cancelamento de canais idênticos mediu -70 LUFS/-90 dBTP. Trilha/par ausentes
foram recusados. Perda real do pipe abortou auxiliar. Processos dos ensaios
foram encerrados por seus verificadores.
QA anterior 23064 encerrada só após conferir PID/executável/comando/listener,
dois canais SIMULATED parados e CUE/PGM vazios. QA atual 5724/session 77357 em
127.0.0.1:4041 conserva banco/cofre, Canal 1 com 14 itens/revisão
25494162001883 e RW com 13/revisão 1744. HTTP 200 contém QC em qualidade e
botão de medição; não é inspeção visual ou confirmação de sinal nessa QA.
Permanecem pares de saída SDI/PGM multicanal, política de publicação recorrente,
guardas globais restantes, banco separado, HA/replicação/fencing, pacote final
e homologação física/visual. Auditar também proteção de SHA no TAKE de arquivos
legados sem cópia imutável, especialmente alteração no disco após a análise.
O objetivo inteiro continua ativo.

Continuação AUDIO-01 em 02/10 às 11h56: roteamento de canais de entrada para
o PGM estéreo implementado. Padrão legado preservado; escolha 1-2, 3-4, mono,
L/R, matriz 2×N com inversão e mix legado de pares passam antes do ganho,
medição e limiter. Não é seleção de pares de saída SDI ou PGM multicanal.
Arquivo/live enviam trilha e matriz no contrato nativo; alteração após CUE
exige novo CUE. Canais/trilha ausentes não autorizam substituir PGM. API e
escopo verificam metadados de áudio mesmo sem probe de vídeo completo, gravam
nível/trilha/matriz/revisão juntos e permitem undo sem trocar CUE/PGM. Mix novo
não herda medição do arquivo inteiro; AUTO é recusado enquanto não existir
medição específica do mix. MANUAL/OFF continuam disponíveis com medidor real.
Validação: 123 arquivos/950 testes em 96,85s, typecheck, build servidor/web,
cargo check, release engine e diff check passaram. Rust engine: 60 testes
passaram, 1 loopback OMT ignorado nesta rodada. Teste real audioconvert mediu
amostras de seis modos, incluindo inversão; teste Channel com arquivo PCM 4ch
mediu PGM 3-4 e preservou programa com arquivo sem áudio/trilha inexistente.
ebZ7AE: servidor compilado HTTP 53302/PID próprio 19076, engine release 21064,
revisões 9cdd1585-8903-46bc-9ff0-13414b7156bb e
c875acff-d6be-4d6a-af84-b72768b22fc1. PGM real 3-4: -10,458/-7,959 dBFS;
PGM 1-2 após ganho -6 dB: -26,000/-19,979. Arquivo real 2ch com metadados
legados desconhecidos recusou 3-4 sem substituir o programa. Processos próprios
encerrados. Esse ensaio não abriu PVW/publisher; não prova CUE físico, fonte
live externa, DeckLink, SDI/NDI/OMT ou inspeção visual no navegador. Primeira
tentativa de CUE sem barramento de preview foi recusada e o fixture corrigido
para ensaio somente de PGM, sem fabricar resultado de CUE.
Build web index-xJghS-5p.js / index-D9GOEo6B.css; aviso de tamanho permanece.
QA anterior 11088 foi encerrada somente após conferir processo/listener e os
dois canais SIMULATED parados, sem CUE/PGM; mesmo banco/cofre preservados.
QA atual PID 23064/session 49736 em 127.0.0.1:4041: Canal 1 mantém 14 itens e
revisão 25494162001883; RW mantém 13/revisão 1744. Ambos permanecem parados,
sem CUE. HTML/bundle HTTP 200 contêm QC em qualidade e matriz de entrada;
isso não equivale a inspeção visual ou sinal nativo nessa instância simulada.
Pacote r21 permanece anterior e imutável; nenhuma nova release portátil.
Permanecem pares de saída SDI/multicanal, loudness específico do mix, política
de montagem/publicação recorrente, guardas globais restantes, banco separado,
HA/replicação/fencing, pacote final e homologação física/visual. Objetivo ativo.

Continuação TIME-05 em 02/10: próxima revisão publicada pode ser conferida e
enfileirada para o fim natural da grade. Isso não monta/publica outras grades
nem conclui a continuidade autônoma 24/7 ou redundância entre máquinas.
Validação final: 121 arquivos/939 testes, 11h23, 90,30s; typecheck, build de
servidor/web, cargo check e diff check passaram. Bundle index-D3HMQNkT.js /
index-D9GOEo6B.css; aviso conhecido de tamanho permanece. Nenhuma nova release.
24 testes adicionados para revisão/ledger/EOS/preparação, reconhecimento,
permissão/escopo/STOP, ordenação durável e watchdog sem replay incerto; os dois
testes de markup SSR não equivalem a conferência visual no navegador.
zZT0x4: servidor compilado HTTP 52675, PIDs próprios 7112→296→22332, engines
11068→6992→12260, vídeos locais reais e saída null. Origem publicada
38575828-e055-4717-829a-f31ca26c18dd, destino 22574eda-7f2d-4625-a3c8-72bd90205898.
Fila duplicada não repetiu intenção; reinício parado conservou QUEUED sem TAKE;
preroll ocorreu antes do EOS; PGM, checkpoint e as-run confirmaram o destino
congelado apesar da edição posterior. Bloqueio QC após autorização manteve o
PGM anterior. Claim SWITCHING injetado antes de crash bloqueou recuperação do
checkpoint antigo; reconhecimento exigiu canal parado e ambos os PIDs locais
anteriores encerrados, sem repetir TAKE. A injeção não é prova de corte físico
incerto ou fencing remoto. Sem publisher PVW, teste de cold-start ou hardware.
23940 foi encerrado somente após verificar PID/executável/comando/listener,
dois canais SIMULATED parados e CUE limpo. QA atual 11088/session 46109 em
127.0.0.1:4041 mantém banco/cofre, 14 itens/revisão 25494162001883 no Canal 1 e
13/revisão 1744 no RW. HTML/bundle HTTP 200 incluem QC em qualidade e próximo
destino; consulta distingue SIMULATED sem passagem autorizada. Leitura HTTP
não é validação visual/browser. R21 continua snapshot portátil anterior.
Revalidação UI-03 nesta build: v5KSVP, servidor compilado HTTP 52817/PID próprio
16088 e sonda release real. JPEG de inspeção 3840×2160, preview 320×180, arquivo
original com SHA idêntico; ativo permaneceu PENDING e sem decisão de QC. Botão
Ver em qualidade disponível no bundle HTTP servido, sem elevar preview padrão.
Playback/inspeção visual no navegador permanecem não validados.
Permanecem política/proprietário de montagem/publicação recorrente, demais
guardas globais, áudio real/matriz, banco separado, HA/replicação/fencing,
pacote final e homologação física/visual. Objetivo inteiro continua ativo.

Continuação anterior TIME-04 às 10h36: relógio relativo à data da grade e horizonte da
execução congelada corrigidos; não é conclusão da continuidade autônoma 24/7.
Validação final: 118 arquivos/915 testes, 10h34, 88,14s; typecheck, build
servidor/web, cargo check e diff check passaram. Bundle web index-BGezuGVE.js /
index-D9GOEo6B.css; aviso conhecido de tamanho permanece. Sem nova release portátil.
23 testes adicionados: relógio/cadência/data inválida, prioridade >24h e ontem,
simulação através da meia-noite, horizonte finito/loop/live aberto/TAKE manual,
ledger durável/rollback e rotas congeladas/acesso/dia local.
Er43jR: servidor compilado HTTP 51844, PIDs próprios 9056→23136, publicação
35acb3fc-731f-4ec6-8e86-37cf35026363. Grade de ontem conserva data/cobertura ao
editar hoje; PGM/CUE simulados preservados; um aviso após reinício, sem autofill
ou publicação implícita. Meia-noite validada por relógio controlado e transporte
nativo em fixture de protocolo, não por transmissão física cruzando a noite.
QA 10732 foi encerrado somente após validar PID/executável/comando/listener e
confirmar os dois canais SIMULATED, parados e sem CUE. QA atual 23940/session
74070 em 127.0.0.1:4041 conserva SQLite/cofre: 14 itens/revisão 25494162001883 no
Canal 1 e 13/revisão 1744 no RW. API distingue OPEN_LIVE publicado de LOOP
legado, sem inventar cobertura de 48h; HTML/JS 200 servem o botão de qualidade.
Isso não prova inspeção visual/playback no navegador ou sinal físico. Próximas
etapas continuam sendo política/proprietário duráveis de montagem/publicação,
fila de próxima revisão e passagem entre grades no EOS, além das pendências
globais abaixo. O objetivo inteiro permanece ativo.

Continuação SEC-16/UI-03 às 10h: proposta de autofill congelada e botão de
qualidade do QC implementados; não é entrega final do objetivo inteiro.
Validação integral: 114 arquivos/892 testes, 10h03, 117,20s; typecheck, build
servidor/web, cargo check, diff check e 11 testes Rust da sonda passaram.
Build web: index-BGd1-M_A.js / index-D9GOEo6B.css; aviso conhecido de tamanho do
bundle permanece. Servidor foi recompilado após ajuste do limite par de pixels.
shIUKm: HTTP 51113/51114, PIDs próprios 8808 e 22476→23352→15256→16768→22484;
proposta após reinício/aplicação entre processos, um vencedor, plano diário exato,
QC/pauta/replay recusados, publicação/rollback e original verificado passaram.
XwpXiR: HTTP 51260/PID 9300, original 4K gerado localmente, sonda release real;
JPEG 3840×2160 versus preview 320×180 e SHA do original idêntico, sem decisão QC.
Essas são provas de HTTP/decodificação/extração, não inspeção visual ou playback
do navegador. CbIYyT: HTTP 54909/receptor local 54908, publicação
e43a47f8-dc87-4f9c-983a-d743216b0466; engine nativo confirmou PGM, proteção de
automação/incerteza e recuperação/reconfiguração/arquivamento sem replay;
saída null e publisher PVW desligado, não homologação física. Verificadores
encerraram seus próprios processos. QA anterior 12912 desapareceu durante a
sessão; listener foi conferido livre antes de iniciar 6388. Só 6388 foi depois
encerrado por nós, com PID/executável/comando/listener verificados, para atualizar
o backend final daquele ensaio. QA então PID 10732/session 87830 em 127.0.0.1:4041 preservava
SQLite/cofre e os dois canais cadastrados: 14 itens/revisão 25494162001883 no
Canal 1, 13/revisão 1744 no RW. HTML/bundle HTTP 200 referenciam a build nova e o
texto do botão; transporte configurado SIMULATED, MediaMTX desativado. Não se
declarou imagem ao vivo ou validação visual a partir disso. r21 continua snapshot
imutável anterior. Permanecem TIME-04 (horizonte/virada/política automática),
guardas equivalentes dos modelos/comandos restantes, importação e contexto,
matriz/pares reais de áudio no engine, banco separado, HA/replicação/fencing,
pacote final atualizado e homologação física/visual. Objetivo permanece ativo.

| ID | Requisito | Situação | Evidência / próxima verificação |
| --- | --- | --- | --- |
| EXEC-03 | Exclusão Windows por computador e identidade privada de sockets | Fechamento local: kernel b6c5b7/cliente95b936/compilado gW0s1R PASS; cobertura2.178 testes distintos/221 arquivos, integral com10 falhas de fixture e replay36 PASS. NÃO é integral única verde | Mutex/job independem de DB/cwd. Handle/nascimento reais, pai pelo SO, encarnação pinada e sockets antes/depois do fetch. Bootstrap/config/engine/relays cercados antes dos efeitos. Auxiliar ACL embutido com4 Rust reais PASS. Engine decodifica vídeo sintético, relay entrega buffers em loopback e recupera geração sem reiniciar VT; peer bloqueado antes dos efeitos. Reparos somente em5 fixtures, sem mudar produto/expectativas. Watchdog externo, browser/hardware/HA/pacote continuam abertos. Crash de broker fecha a própria família: segurança, não continuidade |
| EXEC-02 | Posse global de distribuição na instalação local compartilhada | Migração33; tipos/build PASS; final7 arquivos/82 direcionados PASS; compilado9BJZRR PASS; integral215 arquivos/2135 testes PASS,803,16s, um worker | Antes de config privada, spawn/pipe/restart e mutações de distribuição/transporte. MediaMTX e relay mantêm PID/generação até exit real; callback antigo não libera sucessor. Banco/cofre compartilhados, dois servidores compilados e MediaMTX real local; peer recusa efeitos, sucessor só após parada comprovada, backup e porta/API conferidos. Sem engine/relay no compilado, nem prova de entrega física, outro banco/host, browser ou HA. O servidor de mídia não sobreviveu ao pai nesse ensaio; órfão vivo é fixture. Faltam contrato dos demais mutadores, posse externa de recursos/portas, reparo/UI e pacote final |
| EXEC-01 | Posse durável de execução nativa local, sem roubo por prazo | 56 novos/213 direcionados PASS; tipos/build e compilado nativo yop8U7/recuperação sN053O PASS; integral final212 arquivos/2102 testes PASS,750,21s, um worker | Migração32, MAC de dono e as-run, slot/epoch/tombstone, host opaco do SO e token por geração. Antes de spawn/pipe/fila/dispatch e registro; erro com PID não retira proteção. Peer vivo bloqueia engine/CUE/TAKE/STOP; runtime vazio preserva cursor predecessor. NULL com vídeo sintético real e backup; predecessor comprovadamente morto recupera posição/identidade sem evento secundário duplicado. Legado/remoto/PID reutilizado/pending spawn protegidos em fixtures, não homologados em outro host. MediaMTX/relays globais ainda NÃO cercados; faltam reparo/UI/contratos restantes/qualificação física e pacote final |
| SEC-22H | Título/categoria compartilhados por prova original, distintos da aprovação QC | 74 novos/125 direcionados distintos, tipos/build e compilados tRbSQP/A8yKEo/ZsVUNC PASS; integral final 203 arquivos/1957 PASS, 815,22s, um worker; tentativas anteriores preservadas abaixo | Reutiliza counter durável 23, com ETag próprio de metadata. PATCH novo/legado exigem prova original, recusam ABA/novo hash/QC/campos extras e mix. Autoridade fresca sob writer IMMEDIATE, dados/counters/auditoria atômicos. UI salvar/reabrir, sem autosave; resposta metadata não renova QC. Live não recebe ações MAM; varredura relê decisões após probe sob writer, sem sobrescrever metadata/ignorado/QC/medição do mesmo hash nem ressuscitar ID removido/substituído. Sem CUE/TAKE implícito. SIMULATED/SSR/sonda simulada; remoção/limpeza/categorias/raízes/integrações e homologação física/visual permanecem abertas |
| SEC-22I | Remoção/limpeza conferidas e fila do engine reservada sincronamente | 89 novos; última direcionada117 PASS, tipos/build e compilado kYCBbt PASS; integral final209 arquivos/2046 testes PASS,07h07m14 BRT,867,80s | Migração 31, 21 triggers/counters com tombstones para ativos/usos/publicações/projetos/políticas/proteções; counter QC23 também invalida original por canal/ABA. Prova original por MAC, ator/sessões/estação reconferidos sob IMMEDIATE. REMOVE oculta ativo e remove somente itens diretos conferidos; fallback limpa apenas vínculo. PRUNE exclui subconjunto de registros de vídeos falhos, preserva imagens/arquivos/histórico. Publicação ativa/legada, arquivos de projetos, as-run aberto/checkpoint/retorno/configuração/passagem e PGM/PVW/Próximo/preroll locais protegidos; fase durável desconhecida não vira canal livre. Dados/counters/auditoria um commit; runtime síncrono/epoch impede carga antiga. UI explícita sem force/retentativa automática; override ignorado limitado ao hash/revisão original. SIMULATED/SSR, não fencing de engines concorrentes, browser, mídia real ou hardware. Custo em grande acervo, workflows/jobs, categorias/raízes/integrações e objetivo amplo pendentes |
| SEC-22G | Contas, políticas e sessões conferidas; bootstrap e último admin protegidos | 87 novos/121 direcionados, tipos/build, compilado b3GGxR e integral 198 arquivos/1883 testes PASS | Migração 30, nove triggers, catálogo/conta/sessões com namespace e tombstones. Prova original e autorização fresca em IMMEDIATE, hash assíncrono não renova permissão. Escrita/counters/revogação/auditoria atômicos. UI separa editar/salvar e conferir/encerrar sessões, preserva rascunhos e exige reabrir; nunca consulta senha/hash/token. Cinco rollbacks, duas estações/vencedor único, ABA, restart/backup e PGM/PVW preservados. SIMULATED/SSR, não browser/mídia/hardware/HA. Escritores SQL externos, acervo/integrações e objetivo amplo pendentes |
| SEC-22F | Inicialização única das artes compartilhadas, preservando decisões editoriais | Direcionada 51, tipos/build, dois compilados e integral 192 arquivos/1796 PASS | Migração 29 com marcador protegido. Banco existente, mesmo vazio ou anterior às migrações, adotado sem criar padrões. Banco novo inicializa em IMMEDIATE, com revisão/INSERTs/marcador no mesmo commit. Artes locais não suprimem compartilhadas; conteúdo/IDs existentes preservados. Dois rollbacks SQL, reinício sem recriar e backup verificados. Sem comandos/TAKE ou nova homologação física |
| SEC-22E | Templates e apresentação técnica por revisão original, dono real e confirmação explícita | Direcionados/tipos/build, dois compilados e integral 191 arquivos/1776 PASS | Migração 28 com escopos G/C:id, tombstones e seis triggers validados no startup/backup. Conferência local inclui revisão compartilhada; mudanças globais/ABA invalidam seleção antiga de slate. CRUD e escolha de slate com acesso fresco/IMMEDIATE e auditoria/counters atômicos. Exclusão recusa vínculos de slate/cues/eventos sem apagar referências. UI separa marcar/salvar, cadastro/disparo, preserva rascunho e exige reabertura. 67 novos testes, 112 direcionados PASS. Compilado JihJIy: vencedor único, quatro rollbacks, restart/backup, PGM/PVW preservados. SIMULATED, não prova de SVG renderizado, browser, hardware ou HA; comandos operacionais ainda em auditoria |
| SEC-22D | Faixas editoriais conferidas, sem corrida de sobreposição ou ABA da proposta diária | Tipos/build, integral 186 arquivos/1709 testes e três ensaios compilados PASS | Migração 27, revisão por canal e tombstones/triggers verificados no startup/backup. CREATE/PATCH/DELETE exigem prova original, dono real e acesso fresco dentro de IMMEDIATE, com escrita/auditoria/counters atômicos. Faixas sobrepostas recusadas inclusive em captura/restauração de projeto; horários encostados/dias distintos preservados. DAY vincula dependência à revisão durável, recusando alteração revertida e legado inválido; não publica nem altera PGM/PVW. UI preserva rascunho/prova, distingue falha de lista vazia e exige reabertura; troca de abas não remonta editor. 65 novos testes; compilado 8WyocI confirma vencedor único, três rollbacks, DAY/ABA, restart/backup e PGM/PVW preservados. Projetos bvhDba e multiview qG8G1M PASS na mesma build. SIMULATED/metadata placeholder, não homologação visual/física/HA ou conclusão global |
| SEC-22C | Multiview compartilhado com revisão original, isolamento e auditoria | Implementado; integral 181 arquivos/1644 testes, tipos/build e compilado PASS | Migração 26 com namespace global/canal, tombstones e triggers verificados no startup/backup. Consulta estável e privada, sem timestamp fabricado. PUT exige revisão original e autorização fresca em transação IMMEDIATE; auditoria/dados/counters atômicos. Não sobrescreve outro dono por colisão mv-default; duplicatas/legado inválido são conflitos explícitos. Engenharia grava layout por canal, preserva rascunho em recusa e exige reabrir; não renova a prova por polling. Cells omitidas preservam conexões privadas; tally/telemetria históricos não provam sinal. 44 testes novos e ensaio compilado 6pc34o: vencedor único, ABA recusado, dois rollbacks, restart/backup e PGM/PVW preservados. SIMULATED, não browser/hardware/HA; editor completo de células e demais mutadores pendentes |
| SEC-22B | Papel inválido não concede operação; sessão e auditoria atômicas | Software, tipos/build e ensaio compilado validados; demais frentes abertas | DENIED é resultado diagnóstico, não papel cadastrável. Conta/configuração/header inválidos não recebem permissões do operador. Login reconfere conta habilitada, nome/hash verificados, papel e estação dentro de transação IMMEDIATE; sessão hash-only e SESSION_CREATED gravados juntos. 47 testes novos; direcionados finais 84 PASS; integral terminal 176 arquivos/1600 testes PASS após reparar fixture antiga. Compilado jSBHVN confirma login/leitura recusados, WebSocket encerrado 4401, rollback sem cookie, sessão válida após restart e configuração local inválida sem elevação. Não valida navegador/hardware/HA; administração/bootstrap e demais guardas permanecem pendentes |
| SEC-22A | Cadastro de entradas ao vivo confirma revisão original e preserva transporte | Software, tipos/build e ensaios compilados validados; homologações externas pendentes | Migração 25 com counter por canal, tombstone e triggers de canais/fontes, verificados no startup/backup. CRUD/aliases exigem If-Match original; transação IMMEDIATE reconfere sessão/estação/canal/arquivo e grava auditoria atômica sem conexão privada. Recusa ABA, mudança de dono, par estrangeiro, protocolo/limites incoerentes e exclusão de par referenciado. UI em Configurações/Master preserva rascunho e exige reabertura explícita após recusa; mantém nome abaixo da seleção. Sem rebuild/CUE/TAKE implícitos. 46 novos testes; integral 174 arquivos/1553 testes PASS. Compilado 2KXPI5 confirma vencedor único, rollback e transporte SIMULATED preservado; regressões de projetos w1pnvi e referências chl6OA PASS. Homologação visual/física, force-failover, outros mutadores e objetivo amplo ainda pendentes |
| SEC-21C | Conteúdo semântico de projetos antes de captura/restauração | Software, tipos/build e ensaio compilado validados; homologações externas pendentes | Primitivos compartilhados de corte/áudio/âncora/perfil QC; limites e enums das 12 seções, JSONs estritos, calendário/zonas, roteamento/matriz, limites nativos de cadência/SCTE, preview leve e equipamento existente/habilitado. Captura, GET e commit recusam conteúdo inválido antes da escrita/rebuild, sem normalização silenciosa ou exposição de valores privados. 58 testes novos; integral 169 arquivos/1507 testes PASS, ZlsA6p compilado PASS. Resultados e correções das fixtures abaixo. Não prova SVG renderizado, sinal físico, mídia decodificada/QC, navegador, HA ou pacote final |
| SEC-21B | Conferir impacto e confirmar somente revisão original de projeto | Software, build e ensaio compilado validados; navegador real pendente | Migração 24, contadores/tombstones/triggers por canal e dependências compartilhadas, verificados no startup/backup. GET somente leitura devolve contagens, formato e avisos, sem endpoints/chaves; confirmação exige If-Match e prova original vinculada a ator/configuração, revalidados no commit imediato. Recusa confirmação cega, malformada, stale/ABA ou repetida; rollback conserva prova/contador. UI por canal não renova prova silenciosamente e bloqueia tentativa seguinte até reabrir. 37 testes novos; integral 169/1449 PASS após correção da fixture legado. Tipos/build/diff PASS; HLwUgB confirma proteção/rollback/backup em servidor compilado SIMULATED. Browser real, semântica completa de JSON, HA e pacote final não homologados |
| SEC-21A | Restauração de projetos sem mutação entre canais e com auditoria atômica | Integridade e isolamento validados; continuação SEC-21B | Captura e restauração IMMEDIATE, autorização fresca no commit, IDs/donos/referências conferidos antes de apagar dados; sem upsert estrangeiro. Preserva publicações/importações/as-run, substitui eventos locais e recusa cascatas/vínculos de outros canais. Auditoria e counters revertem juntos; rebuild posterior incerto retorna applied:true e cerca a configuração, sem TAKE/replay. 39 testes novos; integral 166/1412 PASS com um worker após primeira rodada com 7 falhas de helpers/prazo. Build/tipos/diff PASS; zQICxO valida isolamento, dois rollbacks e backup em servidor compilado SIMULATED. Não prova browser, hardware, semântica completa de JSON, concorrência de conferências, HA ou pacote final. Prévia e revisão original evoluídas em SEC-21B |
| SEC-20 | QC por canal, quarentena global e perfil técnico confirmam a conferência original | Implementado; software, duas instâncias compiladas e backup validados; interação visual pendente | Migração 23 cria revisão monotônica/tombstone por arquivo, atualizada por todos os escritores de mídia e decisões QC, com validação no startup/restauração. Conferência retorna hash, metadados, perfil, histórico aplicável e revisões de arquivo/configuração no mesmo snapshot; decisão exige If-Match específico ao arquivo/canal e perfil exige revisão de configuração. Recusa 428/400/409 sem escolher revisão atual para autorizar campos antigos; revalida sessão/papel/canal/estação no commit imediato. Decisão/quarentena/perfil e auditoria detalhada gravados juntos; falha reverte dados/contadores. Commit seguido de falha de refresh é informado como gravado com aviso. UI guarda revisão de abertura do perfil, exige conferência antes de aprovar/rejeitar, preserva ressalva/perfil em recusa, reabertura explícita com confirmação e não anuncia quarentena após erro. 41 novos testes; integral 166 arquivos/1373 testes PASS. hnJK7a comprovou um vencedor, ABA, histórico global, três rollbacks, restart e backup com dois servidores SIMULATED/SQLite compartilhado. Não é decodificação de mídia, HA, aprovação automática ou sinal físico. Guardas de projetos/acervo fora de QC e demais pendências amplas permanecem abertas |
| UI-04 | QC ao vivo: Ver em qualidade, raster da fonte e retorno ao preview leve | Implementado; vídeo/áudio reais locais e software validados; navegador, fontes físicas e 4K live pendentes | Ramo raw antes de crop/escala PVW, mesmo decoder; filas limitadas/leaky, gate fechado e encoder independente sob demanda. Perfil usa caps efetivas, não resolução do canal: até 3840×2160/60 fps, 6–50 Mbps, H.264/Opus progressivo; não é sinal original sem perdas. API vinculada a fonte vigente e sessão/viewer, revalida direitos na fila; último viewer/expiração fecha HQ, CUE novo cancela HQ e pedidos antigos não abrem outra fonte. Engine só inicia encoder após buffer real e possui deadline monotônico próprio de 15s. UI exige SOURCE+PVW_READY da seleção, limpa scopes na troca/erro e não substitui qualidade falha por imagem leve. YDoso1 comprovou entrada/inspeção 1280×720 com canal 640×360, preview 428×240, bordas reais e áudio Opus decodificado, PGM preservado, sem nova conexão de input, duas janelas e expiração. 72 testes Rust PASS/1 OMT ignorado; limites 4K testados por caps, não por emissor 4K. QA 4041 manteve backend anterior por bloqueio da atualização de processo; r23 não alterado; pacote final pendente |
| SEC-19 | Saídas usam versão original, fence durável, compensação de hot-change e reconciliação explícita | Implementado; testes de software e engine/servidor compilados locais validados; visual/físico pendentes | GET privado entrega perfis+revisão, cada ação leva If-Match original. Commit imediato revalida sessão/papel/canal/proprietário; auditoria atômica. Slot e journal cifrados no ledger existente, sem expiração/roubo por timeout. Tentativa nativa registrada antes do envio; ACK não é sinal físico. Falha de commit retorna ao perfil anterior somente se a revisão permanece intacta e registra seu ACK; retorno inconclusivo mantém UNCERTAIN e bloqueia mudanças/restart automático de publishers. Watchdog usa apenas perfil confirmado após commit. Reconciliação exige runId/prova/direitos atuais, PGM parado e CUE limpo; mesmo boot sem callback ativo ou todos os PIDs locais anteriores mortos, remoto/unknown bloqueado; reabre configuração gravada com STOP, nunca replay de TAKE. UI preserva baseline do rascunho, reabertura explícita, editor por canal e bloqueio visível; protocolos incompatíveis e preview full/herdado recusados antes do engine, removidos RTT/perda/AES fictícios. NE8vEu confirmou criação/disable/delete/rebuild e hot ACK mantendo engine/PGM, sem repetir automação; ZSfPyW confirmou dois servidores SIMULATED concorrentes com SQLite compartilhado e backup, não replicação/HA. Demais configurações globais/QC/projetos/comandos, banco separado, fencing entre hosts, pacote final e homologação física/visual/soak continuam abertos |
| SEC-18 | Presets SRT/RTMP usam snapshot conferido e auditoria atômica | Implementado; software e dois servidores compilados validados; visual pendente | Migração 22 cobre ABA/dono/remoção no counter do canal e valida triggers no startup/backup. GET lista+revisão privada; criar/aplicar/remover exigem If-Match original e direitos atuais dentro do commit imediato. Uma confirmação por revisão, rollback conjunto em falha de auditoria, aplicação incompatível recusada e remoção não afeta saída já criada. Resposta distingue commit de falha posterior do engine. Rascunho mantém baseline em refresh/recusa; reabertura explícita e editor por canal; falha de consulta não vira lista vazia, habilitada não significa no ar. Sync de monitor sem alteração não invalida revisão. r6LjSm comprovou concorrência/ABA/rollback/reinício/backup com dois servidores SIMULATED e SQLite compartilhado, não HA. 144 arquivos/1099 testes, tipos/build/cargo/diff aprovados. Guarda/reconciliação de saída complementada por SEC-19; demais controles, banco separado, HA, pacote final e físico/visual/soak continuam abertos |
| SEC-17 | Configuração de canal/FPS usa a revisão da abertura e auditoria atômica | Implementado; software e servidores compilados validados; visual e demais rotas pendentes | Migração 21, ETag namespaced, sessão/papel/dono no commit imediato, erro 428/400/409 sem gravação/rebuild. Baseline retido e patch mínimo; reabertura explícita descarta campos com confirmação. FPS sela formato/counters, incluindo ABA. Auditoria guarda antes/depois e versões; falha reverte dados/counters. Commit seguido de erro de rebuild/recovery é informado como aplicado com aviso, não falso rollback/sucesso físico. MEFrv4 conferiu dois escritores/reinício/rollback/backup, XUVzCf confirmou conversão nativa STOP/republicação/tempos históricos; 141 arquivos/1073 testes e tipos/build/cargo check/diff passaram. CRUD de saídas/presets/projetos/QC e outros controles, banco separado, HA, pacote final e homologação física/visual continuam pendentes |
| TIME-06 | Continuidade recorrente entre grades já publicadas, com autorização durável e STOP | Implementado; software e engine nativo em servidor compilado validados, UI visual/físico pendentes | Opt-in PUBLISHED_ONLY, conferência/versionamento e owner de conta/processo; seleção cronológica sem desempate ou salto, atraso revalidado no EOS. Ledger único por origem, SHA/QC/preroll/PGM existentes; STOP/cancelamento/arquivamento suspendem, falha não repete. Recovery local somente após ambos PIDs mortos, auditado; remoto/unknown bloqueado e status distinto, não fencing HA. 0wJtIA confirmou duas passagens entre três publicações, restart do primeiro VT, fila/as-run sem duplicação e STOP. 128 arquivos/983 testes passaram. Não monta/publica rascunhos, não garante 48h, não é sinal físico/visual; pacote final pendente |
| MEDIA-06 | Bytes publicados conferidos antes do CUE/preroll/TAKE, sem herdar aprovação ou mix de arquivo substituído | Implementado; software, servidor compilado e PGM nativo validados | SHA no contrato, hash real/handle/identidade nanosegundos e cache limitado. Recusa 409 com orientação, reabre decoder após mudança/restauração e exige novo CUE; próxima playlist/retomada/preroll também protegidos. Publicação obrigatória sem SHA bloqueada. Glkmv7 com original Unicode, cache indisponível e sem arquivo de versões comprovou PGM avançando, zero as-run de corte recusado e AUTO -23,224 LUFS após restaurar. 126 arquivos/970 testes finais. Não é lock/WORM contra alteração futura, aprovação de legado sem SHA, CUE físico ou validação browser; pacote final ainda não produzido |
| AUDIO-03 | Barramento PGM 8/16 e pares auxiliares explícitos | Engine, persistência/API, formulário e publicação integrados; software/nativo validados; SDI físico/visual pendentes | Ganhos independentes, pares não atribuídos silenciosos, limiter por par, medição/IP estéreo 1–2, captura SDI conforme entrada necessária. Migração 20/CHECK SQL/backup; alteração exige total anterior, PGM parado/CUE limpo, histórico preservado e republicação. Escopo amplo é atômico; total/pares congelados e incompatíveis recusados em execução/rollback/recovery. Declarações brutas preservam ausência versus desconhecido com probe parcial. 65 testes nativos anteriores + 138 arquivos/1036 testes e ensaios compilados 2/8/16 e metadados desconhecidos passaram. Formulário não presume SAP/clean nem sinal físico. Novo pacote final pendente |
| AUDIO-02 | Medir trilha/mix real para ganho AUTO, com resultado durável e vinculado à versão | Implementado e validado em software, auxiliar release e PGM nativo; visual/físico pendentes | Botão explícito no diálogo; FILE antes de ganho/limiter, não TRIM nem fonte live. SHA/trilha/matriz conferidos antes/depois e em todos os alvos na aplicação; números do servidor substituem os enviados pelo cliente. Jobs protegidos PENDING/RUNNING/READY/FAILED, claim atômico, dono local comprovado, sem roubar processo vivo/remoto; limites e baixo consumo em worker separado. Encerramento do servidor/pipe termina decoder e não presume resultado. mXjYaZ comprovou READY após reinício de servidor e AUTO no PGM -23,202 LUFS; p839O4 comprovou duas trilhas com diferença 20 LU, inversão, cancelamento, canais ausentes e EOF do dono. 125 arquivos/961 testes e 13 Rust passaram. Não aplica TAKE, não aprova QC, não homologa saída SDI ou controle visual. Auxiliar incluído nos scripts; pacote final não produzido |
| AUDIO-01 | Canais e matriz de entrada antes do ganho/limiter/medidor estéreo | Implementado e validado em software e engine nativo; hardware/PVW visual pendentes | Padrão legado mantido, pares 1-2/3-4, mono, L/R, matriz 2×N e mix de pares. Ausência não seleciona outro canal nem substitui PGM. Nível/trilha/matriz gravados juntos por revisão/escopo, CUE alterado exige nova preparação. ebZ7AE mediu PGM 3-4 e 1-2 com ganho -6, recusa 2ch; Rust mediu amostras reais dos seis modos. Esta linha é roteamento de entrada para master, não pares de saída; integração multicanal explícita em AUDIO-03, sem clean/SAP presumido |
| SEC-16 | Montagem aplica exatamente a proposta conferida, inclusive pauta diária e GAP de segundos | Implementado e validado em software e dois servidores compilados; visual pendente | Proposta imutável persiste no ledger protegido existente, com UUID, canal/grade/ator/revisão e expiração de 30 minutos; nenhuma migração nova. Guarda seleção/ordem/âncoras/cortes/áudio efetivos e explicação exibida. Confirmação não recalcula o seletor: exige If-Match capturado, proposta do mesmo destino/mode/sessão e dependências atuais de mídia/QC/canal/histórico/pauta; mudança recusa sem escolher outra mídia. Inserção, ordenação, consumo único e auditoria são um commit com undo/redo local após aceitação. Formulário mantém conferência/campos na recusa, invalida aplicação se critérios mudarem e exige conferência também do dia inteiro. GAP de segundos recebe a mesma proposta; folga antes fixa em 15s passa a no máximo 5% da janela curta. Leitura de preferências agora autentica/descriptografa via coluna protegida, sem json_extract no envelope. 20 novos testes de rotas; shIUKm comprovou aplicação em outro processo após reinício, um vencedor, plano exato, replay/QC/pauta recusados. SQLite compartilhado/SIMULATED, não replicação/HA; não publica ou envia TAKE. TIME-04 retirou o gatilho legado inválido; política automática durável continua pendente |
| UI-03 | QC tem botão Ver em qualidade, original verificado e inspeção até 4K | Implementado; software, HTTP e extração nativa de imagem validados; playback/visual no navegador pendentes | Preview leve permanece padrão. Botão explícito abre original para avaliação, permite voltar ao proxy e tela cheia; ativação vinculada a arquivo/hash/canal e apagada ao trocar seleção, nunca eleva live ou Master. SHA verificado prefere edição arquivada; original legado só é servido se bytes conferirem, substituição no mesmo caminho recusa 409. Range continua disponível, original usa cache privado/no-store. Codec não decodificado pelo browser usa quadros JPEG identificados como inspeção não contínua, sem prova de áudio; extrator agora aceita até 3840px e mantém 320px padrão. Cache de qualidade é separado; falha não anuncia miniatura como alta qualidade. Safe area continua desligada por padrão. XwpXiR: servidor compilado e sonda release geraram JPEG real 3840×2160, preview 320×180 e original SHA idêntico; QC permaneceu PENDING/sem decisão. 5 novos testes de API/cliente + 2 de markup SSR, 11 testes de sonda Rust aprovados. shIUKm validou range/hash e conteúdo original substituído. Não equivale a aferição de cor/scopes, reprodução browser validada, imagem live em alta qualidade ou hardware físico |
| TIME-05 | Próxima grade publicada conferida e passagem única no EOS | Implementado e validado em software e engine nativo com arquivos reais; visual/saída física pendentes | Master oferece seleção → conferência → enfileirar/cancelar/reconhecer, sem publicar, carregar grade, alterar CUE ou TAKE imediato. Revisões congeladas, primeiro vídeo exato, mesma cadência/canal, origem sem loop/hold, data/horário do destino, mídia/QC e autorização durável da conta vinculados à prova HMAC. Copy/SHA e permissão revalidados após preparação. Ledger protegido existente, uma pendência por canal, ID idempotente, claim e auditoria atômicos; nenhuma migração. Preroll no último trecho, reutilizado se o contrato persistir; somente identidade nativa no PGM instala snapshot/secondary events, checkpoint e as-run PLAYLIST_BOUNDARY. Falha preserva último PGM e não escolhe outro VT; ACK sem PGM torna incerto e não repete TAKE. STOP canônico/externo e arquivamento cancelam intenção não enviada. Cancelamento não altera SWITCHING; supervisor reconhece somente com canal parado/CUE limpo e dono atual serializado ou ambos PIDs locais antigos comprovadamente mortos; remoto/desconhecido bloqueia. Recuperação de servidor e watchdog recusam replay do checkpoint anterior sobre claim incerto. Pins de cache conservam destino pendente sem prender falhas históricas. Ordenação usa inserção durável, não UUID/relógio civil. 24 testes novos, 939 totais; zZT0x4 confirmou servidor compilado, vídeos nativos, preroll/EOS/PGM/as-run/checkpoint, fila após reinício, QC alterado e claim incerto injetado sem replay. Saída null/PVW desligado; não é fencing remoto, diária autônoma ou prova física |
| TIME-04 | Horizonte contínuo, virada de data e política de montagem/publicação automática | Relógio/horizonte/aviso e montagem/publicação editorial TIME-07 implementados; passagem TIME-05/06 implementada; visual/físico/soak/fencing pendentes | Relógio relativo à meia-noite local congelada não zera na virada; FIXED/HARD_TIME conservam timestamp absoluto. Cobertura usa execução publicada, não edição/cache; GAP/loop/live não garantem 48h. Aviso durável não duplica após reinício. TIME-05/06 fazem passagem única/recorrente entre publicadas com confirmação nativa, sem publicar rascunhos. TIME-07 monta/publica dias futuros vazios pela pauta com autorização durável, seleção exata em auxiliar separado, QC/SHA/repetição/conta e commit atômico; nunca sobrescreve grade manual nem aplica TAKE. W3rWGh confirmou dois dias, restart sem duplicação, STOP e disable; transporte SIMULATED neste ensaio, sem playback de 48h, sinal físico ou HA. Veja descrição atual acima; pacote final, integração visual/física e fencing entre hosts continuam pendentes |
| SEC-15 | Zonas protegidas, grafismos e eventos respeitam a revisão aberta | Implementado; software, dois servidores compilados e engine nativo validados; visual pendente | PUT de zonas e inclusão/remoção de deixas/eventos exigem If-Match e revalidam proprietário, sessão/permissões e cadência na transação imediata. 428/400/409 não grava nem registra undo; auditoria, dados e contadores são atômicos. Leituras readonly de grafismos/eventos entregam itens, templates, cadência e revisão num único snapshot, sem load de outra data. Formulário compartilha uma revisão entre grafismos/eventos, usa a resposta aceita como próxima base e não busca versão nova para forçar gravação; recusa mantém campos, atualização é explícita e seleção de origem é congelada. Zonas preservam também a cadência de abertura. Histórico local agora captura zonas e eventos/deixas de item, sela estado aplicado e permite undo/redo; restauração de automação exige permissão atual OUTPUT_CONTROL e não envia comando físico. 21 testes de API + 2 cliente adicionados: suíte 112 arquivos/863 passou antes de DB-02, 865 depois. BG85Qi comprovou zonas superadas, leitura coerente de GC/eventos e undo visível no outro processo; SQLite compartilhado/SIMULATED, não replicação. DcIBl9 confirmou programação/publicação, PGM nativo, recuperação/reconfiguração/arquivamento sem replay, com saída null e receptor local. QA 4041 atualizado, 3 escritas sem revisão recusadas com 428, 14 itens/revisão preservados. Modelos globais e demais comandos continuam em auditoria; pacote r21 anterior, sem inspeção visual nova |
| DB-02 | Reabertura do cofre não disputa upgrade de snapshot com escritor ativo | Corrigido e validado, sem equivalência a banco separado/HA | Ensaio de reinício revelou SQLITE_BUSY_SNAPSHOT na migração do cofre. Leitura/autenticação e proteção de valores legados agora acontecem sob uma transação IMMEDIATE, reservada antes da primeira leitura; evita upgrade de snapshot e sobrescrita de valor protegido mais recente. Reabrir banco já protegido autentica sem regravar metadados/contadores. Limpeza de legado ainda exige checkpoint/VACUUM e recusa outro processo ativo quando necessário, sem declarar limpeza fictícia. Dois testes adicionais verificam reserva de escrita antes das linhas e ausência de writes na reabertura; todos os 10 testes de migração/backup protegido passaram. BG85Qi e DcIBl9 passaram após a correção. Schema continua na migração 19; banco operacional separado e redundância entre hosts permanecem pendentes |
| SEC-14 | Publicação e rollback ativam somente o plano explicitamente conferido | Implementado; software e dois servidores compilados validados, visual pendente | Simulação lê grade/revisão, acervo/QC, fallback live, canal, grafismos/eventos, equipamentos e revisão ativa em um snapshot SQL; HMAC vincula operação, proprietário, versão e dependências. Confirmar exige If-Match capturado e prova válida, revalida sessão/permissões na transação imediata e não procura versão nova para forçar a gravação. Duas confirmações iguais têm um vencedor; versão atual não autoriza uma conferência antiga. Publicação/ativação/numeração/auditoria são um commit: falha de auditoria reverte tudo. Proteção de PGM também compara corte/áudio efetivos herdados; overrides explícitos preservados não são bloqueados por padrão novo. Rollback confere a revisão de origem e cria outra publicação, sem reescrever a edição; automação editorial inválida não impede restaurar uma publicação válida. Tela mostra alterações/conflitos antes do rollback e mantém recusa visível; atualização da conferência é explícita. Mudança de canal/data durante a confirmação não solicita carregar outra grade. 20 testes de API + 2 cliente adicionados; suíte 110 arquivos/840 passou. Ensaio VF1aAv, dois processos compilados, comprovou proof após reinício, concorrência e rollback em outro processo, preservação editorial e 4 auditorias atômicas. SQLite compartilhado/SIMULATED, não replicação ou HA. QA 4041 atualizado com banco/cofre/14 itens preservados; equipamento ausente na grade de teste impede publicação com 409 específico, não falso 404. Pacote r21 anterior, visual e demais mutações ainda em auditoria |
| MEDIA-05 | Todos os previews de vídeo usam proxy leve, sem fallback silencioso para original | Corte, consulta do Master e identidade de versão corrigidos; software/HTTP validados, visual pendente | TrimDialog e fallback do BroadcastMonitor antes serviam /media original; agora somente preview=1, hash capturado e preload metadata. MXF/ProRes não impede abrir o proxy H.264 por extensão original. Proxy ausente devolve 425; versão diferente 409, sem enviar original. QC consulta workflow da versão selecionada e recebe URL fixada no hash. Master identifica consulta como proxy, não confirmação PGM/PVW; falha WHEP abre consulta e permite reconectar. Régua continua disponível e corte permite tentar proxy novamente. 1 teste cliente + 5 de API (range, ausência, versão, workflow e acesso explícito separado). QA serviu proxy MP4 real com 206, 32 bytes/113221, e recusou hash antigo 409. Inspeção visual nova não realizada |
| TIME-03 | Corte compartilhado preserva tempo entre cadências de canal | Implementado com migração 19; software, backup e engine nativo validados | ALL_RUNDOWNS converte endpoints por razão exata, arredondando ao quadro mais próximo; trecho que ficaria vazio recusa 409 sem escrita parcial. ASSET_DEFAULT registra FPS da marcação e resolve por canal, mantendo overrides existentes. Inserção/importação/autofill usam resolvedor comum; undo/redo restaura também a unidade. Legado sem FPS permanece desconhecido, não inferido pela sonda; aviso pede revisão do padrão. Migração/backup recusam coluna/trigger ausente e par de taxa inválido. 25 testes adicionais e suíte 106 arquivos/812 antes dos previews. Engine DXkuO5 confirmou corte 25–250 a 25fps e 50–500 a 50fps, padrão 50fps byte-preservado, publicação/as-run históricos intactos e sem TAKE automático; saída null, sem PVW físico |
| SEC-13 | Confirmação revisada de todos os alvos de corte/áudio e undo de padrões | Implementado; software e dois servidores compilados validados | GET readonly mostra canal/dia/grade/quantidade; operador confirma os alvos amplos. Token HMAC sela linhas, padrões/hash, proprietários, configuração/cadência e versões de todas as grades no mesmo snapshot. Aplicar revalida sessão, permissões e revisão original dentro da transação imediata; ausência 428/superado 409 não grava nem cria undo. Edição exclusiva de outra grade invalida token mesmo sem alterar versão da origem. Conferência em outro processo com mesmo cofre é válida, mas não autorização adicional. Undo sela hash do estado dos usuários existentes do padrão, não só IDs, e recusa alteração posterior mantendo ação pendente. 31 testes sobre SEC-12: suíte 105 arquivos/787; ensaio eQQDv3 anterior e XBAfbI atual passaram. XBAfbI acrescentou padrão 25fps herdado em canal 50fps e corte amplo convertido/desfeito. SQLite compartilhado e transporte SIMULATED, não replicação/HA. Pendência ampla descrita em SEC-12 é superada por esta linha; publicação/rollback e demais comandos continuam em auditoria |
| SEC-12 | Corte/áudio conservam a revisão e os campos da edição | Revisão da grade fonte e confirmação conjunta implementadas; revisão de todos os alvos amplos pendente | If-Match obrigatório no corte e nível, conferido dentro da transação imediata após autorização de todos os proprietários. 428 ausente/400 inválido/409 superado não grava campos, trilha, contadores ou histórico. Dois pedidos com a mesma revisão têm um vencedor. Cliente conserva ItemView/revisão da abertura; áudio conserva também perfil do canal. Diálogos esperam resposta aceita antes de fechar; recusa conserva pontos, ganho e trilha com alerta explícito, sem busca automática de revisão nova. Escolha de trilha agora é local ao formulário e só grava junto com nível, no mesmo commit/desfazer; mesmo com nível amplo, trilha altera somente o item de origem. Falha no nível reverte trilha preparada. Controles de chaveamento/pares SDI que não eram conectados ao engine foram desativados e deixaram de anunciar multiplexação fictícia; integração multicanal permanece pendente. 47 testes canônicos, 13 de escopo, 8 da API cliente; rodada integral 103 arquivos/756 testes passou, tipos/build/diff check passaram. EiT2Ps validou dois servidores compilados, recusa cega e undo conjunto de trilha/nível. QA 4041 atualizado para PID 18932, JS index-C1qHs16-.js/CSS index-DsAAE4YL.css HTTP 200; POST sem revisão recusa corte/áudio com 428 e conserva 14 itens/revisão 25494162001859. Ainda não há fingerprint revisado pelo operador para mudanças exclusivamente em outras grades alcançadas por ALL_RUNDOWNS/ASSET_DEFAULT: revisão da grade fonte não substitui essa proteção. Publicação/rollback e demais mutações, inspeção visual e pacote final continuam pendentes |
| SEC-11 | Histórico selado, importação e montagem editorial atômicos | Implementado e validado; guardas restantes continuam pendentes | Captura antes/depois selada na transação original, registrada somente após commit. Desfazer/refazer compara o resultado exato da operação com linhas, padrões/hash do acervo, vínculos novos, cadência e eventos atuais; revisão nova não autoriza sobrescrever edição posterior. Falha SQL/409 conserva dados, contadores e ação pendente; dois pedidos com mesmo If-Match desfazem um só passo. Histórico permanece local ao processo, não durável/replicado. Undo estrutural não pode remover o item no ar. Undo/redo/importação/autofill/dia exigem revisão de abertura, autorização atual e transação imediata. Importação preserva PGM, revalida QC por canal, insere itens/ordem/histórico de importação juntos; evento EDITORIAL_PLAYLIST_IMPORTED/editorial-playlist.imported não anuncia publicação operacional. Assinaturas antigas playlist.published/playlist.inserted devem ser revisadas, não há equivalência fictícia. Montagem lê pauta, mídias/QC, cadência, preferências e as-run no mesmo snapshot de gravação; não reutiliza taxa antiga do runtime de outra data. Formulários de importação/montagem mantêm campos e exibem recusa. 40 testes canônicos, 18 de histórico e 7 da API cliente; rodada integral 103 arquivos/745 testes passou, tipos/build/cargo check/diff check passaram. Servidores compilados DvBjOJ confirmaram recusa de undo/redo superados mesmo com header atual e conservaram ação pendente. Engine VfuVoS confirmou PGM 25/50 FPS, bloqueio ativo e republicação; saída null, sem publicação física/PVW. QA 4041 atualizado para PID 24400, 14 itens/revisão 25494162001859 preservados, JS index-Cui802la.js/CSS index-DsAAE4YL.css HTTP 200. Não houve inspeção visual nova. Trim/áudio com revisão/escopo amplo, publicação/rollback e demais mutações ainda pendentes; autofill recalcula ao aplicar, não há identidade persistida de proposta aprovada. Posterior ao pacote r21 |
| SEC-10 | Revisão do que foi exibido aplicada às edições canônicas da grade | PATCH, inserir, mover, agrupar/desagrupar e remover implementados; demais comandos pendentes | Leituras de runtime, grade por ID, calendário e grade recém-criada associam linhas, mídias/QC, timing e revisão na mesma transação de leitura. If-Match obrigatório (428 ausente/400 inválido/409 superado), sessão e proprietário reconferidos na transação imediata, escrita estrutural e contadores atômicos. Formulário/arrasto conservam revisão de abertura; não buscam versão nova para forçar gravação. Inserção mantém campos e mostra erro; MAM só confirma sucesso após resposta aceita. Remoção só desaparece após aceitação e não limpa CUE em erro, nem ao apagar somente PRÓXIMO com outro CUE manual. Captura de undo só após commit; remoção/restauração inclui eventos secundários. Migração 18 corrige invalidação por QC global @all, valida proteção atual e invalida contadores antigos uma única vez. 21 testes de API canônica, 8 de header e 2 adicionais da API do navegador. Rodada integral: 103 arquivos/715 testes, tipos/build/cargo check/diff check passaram. Servidores compilados lGSQYq confirmaram conflito/reinício/rollback; engine nativo WarsRZ reconferiu carga e conversão de cadência. Recuperação nativa NlcQHr confirmou crash no frame 25, retomada no 25 e reinício pelo checkpoint 52 sem duplicar evento secundário; saída null, não prova publicação física. QA 4041 atualizado, 14 itens preservados, revisão 25494162001859, JS index-D6w8xTSf.js/CSS index-DsAAE4YL.css com HTTP 200. Não houve nova inspeção visual. Trim/áudio amplo, desfazer contra alteração superada, publicação/rollback, importação/autofill e demais mutações ainda precisam de guardas equivalentes |
| SEC-09 | Corte/áudio com escopo amplo e desfazer/refazer respeitam todos os proprietários | Implementado; domínio, API autenticada e dois servidores compilados validados | Alvos e sessão/permissão são conferidos dentro da transação imediata. Conta restrita pode aplicar escopo amplo somente se todos os usos forem autorizados; padrão de acervo considera todos os canais que o usam, inclusive arquivados. Padrão/override/revisões mudam juntos ou são revertidos juntos. Captura de desfazer lê o mesmo snapshot e só é registrada após commit. Desfazer/refazer revalida vínculos salvos, atuais e novos usos do asset; não altera canal estrangeiro/arquivado, conservando a ação pendente. Auditoria registra todos os canais afetados. 3 testes adicionais de atomicidade e 7 de rotas; ensaio compilado 1TBWcy passou com falha SQL deliberada, sem padrão/revisão/desfazer parcial, recusa de escopo e undo arquivado e restauração autorizada. Histórico continua em memória; proteção contra desfazer uma edição superada e guardas globais de edição permanecem complementares |
| SEC-08 | Revisão editorial durável e edição colaborativa atômica | Banco e API colaborativa implementados; aplicação em todas as edições da tela pendente | Migração 17 mantém contadores por grade/linha no mesmo commit dos escritores: item/ordem, mídia, QC por canal, grafismos, eventos e configuração. Tombstones impedem reutilizar ETag após excluir/restaurar item ou grade; upgrade legado ganha nova base, sem inventar contagem histórica. Snapshot /api/v1/rundowns/:id/revisions e timeline associam dados/revisão na mesma leitura. PUT/merge validam e escrevem na transação imediata, recusa cega 428/conflito 409; header antigo não é neutralizado por corpo atual e DISCARD_MINE não escreve. Backup/startup recusam tabela/trigger modificados, contador ausente ou inválido. 13 testes de banco e 4 de rotas adicionais; duas conexões e dois servidores compilados/reinício passaram. Locks de presença continuam locais ao processo; não é replicação/HA. PATCH/add/move/delete/trim/audio/publicação e demais edições canônicas da interface ainda precisam de precondição enviada pelo cliente e verificada atomicamente; não anunciar prevenção global de sobrescrita como concluída |
| REC-08 | Conversão explícita e revisada de FPS, preservando histórico | Implementada; software, backup e engine compilado validados | Migração 16 guarda snapshot protegido e exige publicação nova. Simulação identifica quantidades, cortes herdados e arredondamento; fingerprint impede aplicar plano superado. Transação converte horários, zonas, cortes, durações e eventos por taxa racional; acervo/outros canais e payloads históricos intactos. STOP/CUE limpo e retorno de VT resolvido são obrigatórios. Publicações incompatíveis ficam somente para consulta; rollback/runtime/cache/contingência recusam FPS errado ou legado desconhecido após conversão. Checkpoint fica parado; erro de rebuild é informado como conversão aplicada, não rollback fictício. Formato e Settings abrem revisão; Master mostra bloqueio; null de execução não vira editorial; histórico de desfazer e revisão colaborativa anterior invalidados. 28 testes novos/estendidos; ensaio nativo J2itvo confirmou PGM 25 FPS recusando conversão ativa, novo engine parado, republicação e PGM 50 FPS/as-run por cadência. Saída null, sem PVW ou emissão física. Posterior ao pacote r21; concorrência durável global e inspeção visual permanecem complementares |
| SEC-07 | Respostas e comandos assíncronos cercados por sessão/canal; propriedade nas rotas indiretas/legadas | Implementado nesta continuação; contratos, API e compilação validados | Requisições verificam contexto antes/depois do corpo; 401 antigo não revoga sessão nova. Fila descarta CUE/TAKE ainda não enviados após troca, sem repetir/alegar cancelamento dos já enviados. Snapshot precisa de proveniência atual; WebSocket verifica sessão. Autofill da timeline abre revisão sem mutação silenciosa; rota v1 só propõe materiais aprovados por canal, não insere item fictício nem declara gap resolvido. V1/alias mapeiam grade/item; PUT/merge validam pertencimento, limites, ETag e revisão; lock usa identidade real. Grafismos globais podem ser usados, não sequestrados por conta restrita; destinos/convidados/deixas/blocos mapeiam proprietário e barram arquivado. 18 testes novos de contexto/API + 20 rotas autenticadas. Não fecha auditoria global de segurança, versão durável multi-host nem validação visual. Posterior a r21 |
| LIVE-07 | Monitor reconhece NDI/OMT/SDI em CUE de item e PGM, sem inventar sinal por cadastro | Implementado; software validado; inspeção visual/física complementar | Engenharia antes só considerava sonda SRT e PVW de fonte direta. Agora correlaciona fonte canônica/identidade protegida, item ativo por barramento e medições nativas recentes; NDI/OMT/SDI mostram formato/FPS/áudio reportados. Cadastro não ganha CUE nem “sem sinal”; distingue não monitorada, simulado, aguardando quadro, medição indisponível e ausência recente. Mesma fonte no QC não apaga vínculo PGM; programa usa monitor baixo consumo e heartbeat mon, preview usa pvw, sem segundo decoder de entrada nem TAKE. 12 testes de monitor e contrato ampliado entre os 45 testes do transporte. Posterior a r21; WHEP/placa/emissor externo não homologados nesta continuação |
| SEC-06 | Troca/revogação de sessão não conserva operação da conta anterior | Inicialização protegida e testes de contrato passaram; auditoria global/visual complementar | Login/revogação limpam view/execução/Live/monitores/seleção/canais/alertas locais. Inicialização cancelada não reinstala sessão, canais nem snapshot atrasado; conta sem grade autorizada não herda Master anterior. WebSocket encerrado descarta novas mensagens. Isso limpa somente a tela, não manda STOP ao engine. 4 testes do inicializador; revisão de demais pedidos assíncronos e validação visual permanecem complementares. Implementação posterior à build r21, não incluída nela |
| REC-07 | Retirada de canal sem apagar histórico e reativação explícita sem TAKE | Implementado; software e engine compilado validados | DELETE passa a arquivar, não executar cascata. Migração 15 mantém canal/grade/publicação/as-run/auditoria; exige OUTPUT_CONTROL, STOP e CUE limpo na fila nativa, além de proteger o último canal ativo dentro da transação. Encerra runtime/sonda e remove distribuição/pins próprios. Checkpoint deixa de solicitar retomada ao reativar; reativação não instancia engine nem autoriza TAKE, mas reaplica distribuição configurada. APIs de histórico continuam consultáveis por permissão; Master/boot/cache usam somente ativos. Settings oferece Arquivar/Reativar parado; Aired e conta sem ativo autorizado podem consultar arquivos sem transformar a seleção em operação. 6 testes de domínio/rotas. Ensaio mTDhJR retirou PID real, preservou as-run/publicação e não iniciou engine/repetiu comando ao reativar. Interface nova não homologada visualmente por bloqueio da aba |
| SEC-05 | Auditoria limitada aos canais autorizados e exportação segura | Implementado; validação software e API compilada | Filtro de canal ocorre antes do limite; paginação por data/ID conserva eventos com mesmo timestamp. Eventos sem proprietário administrativo somente para ADMIN irrestrito; associação cruzada exige todos os canais. Canal arquivado conserva sua trilha. Registros HTTP carregam IDs mapeados sem copiar corpo/endereço/segredo; legado recebe máscara na resposta. UI informa erro/permite atualizar, não chama solicitação de execução física nem anuncia cadeia assinada. CSV compartilhado com as-run escapa separadores/aspas/quebras e neutraliza fórmulas, inclusive com prefixos. 4 testes auditoria, 2 CSV, permissões HTTP e ensaio mTDhJR. Mapeamento de outros endpoints e auditoria de segurança global permanecem complementares; UI sem inspeção visual nova |
| REC-06 | Restauração de projeto ordenada, configuração realmente reaplicada e histórico preservado | Implementada; software e ensaio compilado passaram | Exige OUTPUT_CONTROL (Supervisor/Administrador), PGM parado e CUE limpo; estado revalidado dentro da fila nativa. Banco restaurado seguido de checkpoint/retirada/rebuild, distribuição reaplicada antes do novo engine. STOP não vira retomada automática. Publicações de grades mantidas não são mais apagadas por DELETE/cascade: restaura editorial por upsert sem substituir a revisão congelada. Recusa remover grade com qualquer histórico publicado e recusa reinterpretação de cadência histórica. Auditoria registra identidade do projeto/canal sem segredos. UI explica interrupção, necessidade de republicar e permissão; novo texto/botão ainda não inspecionados visualmente por bloqueio da aba. 22 rotas operacionais e teste de domínio preservam publicações/outro canal/gráficos/eventos, barram OPERATOR e reinterpretação histórica. Temp/RPlayout-device-automation-VimDPt confirmou PGM ativo recusado, nova geometria/engine após STOP, publicação original intacta e ausência de replay. Exclusão de canal continua em auditoria separada |
| REC-05 | Reconfiguração segura de canal e topologia das saídas | Implementada nas rotas de configuração; validação de software e engine compilado | Formato, criação/remoção/desativação de saída e aplicação de preset compartilham a fila nativa com CUE/TAKE. Recuperação/contingência pendente bloqueia antes da escrita; runtime antigo é retirado somente após checkpoint, novo solicita retomada real. PATCH de slot RTMP/SRT/FILE já ativo aguarda ACK antes de gravar o banco, sem reentrar na fila; slot antes desativado ou SDI/NDI/OMT exige rebuild. Cadência diferente em canal com itens é recusada para não reinterpretar cortes/horários em quadros; conversão/republicação de grades permanece pendente. Novos checkpoints guardam cadência; legado sem esse campo não recebe cadência inventada. Auditoria central registra canal/IDs/campos/forma de aplicação, sem destino privado; ACK não comprova saída física. 45 testes transporte, 22 rotas operacionais, 4 rotas de credenciais, 4 checkpoints. Ensaio Temp/RPlayout-device-automation-A52RWh confirmou PGM após geometria/criação/desativação/remoção, troca FILE sem novo PID, crash e ausência de replay. Duas primeiras inicializações isoladas expiraram sem diagnóstico; repetição passou, estabilidade longa não homologada. Restore de projeto coberto por REC-06; exclusão de canal ainda em auditoria separada. Pacote r18 antecede REC-05 |
| LIVE-01 | Selecionar input antes do nome; nome padrão da fonte; edição consistente | Implementado; validação de software e página | 4 testes de nome/configuração; seleção NDI, troca SRT e apelido preservado no QA. Em 01/10, troca NDI→OMT indisponível limpa nome e bloqueia salvar; retornar NDI conserva apelido cadastrado. Screenshot artifacts/qa-20260930/input-selecao-nome-abaixo.png |
| LIVE-02 | Identificar DeckLink, separar entradas/saídas, diagnóstico real | Implementado; homologação física pendente | `device-number` é `G_TYPE_UINT`; portas de vídeo/direção em 5 testes Rust; processo de descoberta/UTF-8/timeout em 5 testes |
| LIVE-03 | Estados explícitos por fonte, sinal/áudio/formato/estabilidade | Implementado no transporte nativo; medição física complementar | Estados independentes PGM/PVW, largura/altura/FPS/interlace da entrada antes da escala, canais/taxa de áudio, idade de buffer e perda de sinal recente. Variação de chegada no decoder não é jitter de pacotes nem latência ponta a ponta. 35 testes de transporte e 2 de estatística nativa |
| LIVE-04 | CUE/PVW, TAKE seguro, Próximo, QC independente | Software e OMT loopback nativo validados; emissores externos pendentes | TAKE usa somente CUE confirmado, sem fallback silencioso para Próximo; 40 testes do transporte. Publicação/rollback/ajuste live compartilham fila nativa; revisão ou contrato do CUE alterados exigem novo CUE sem cortar PGM. Retomada pode refazer preroll uma única vez se somente o caminho mudar para cópia SHA verificada da mesma mídia/revisão. Arquivo exige quadro real no preroll e após seek; áudio sem vídeo e Mark In além do EOS preservam PGM. OMT percorreu CUE/PVW e TAKE/PGM com vídeo/áudio; remover PVW conservou PGM. QC abriu proxy real sem Master |
| LIVE-05 | Live prioritário, corte auditado, compensação rápida em segundos/minutos | Implementado base; validação física e timing complementar | FIXED/HARD_TIME disparam prioridade, preroll antes do prazo; falha conserva PGM; interrupção persiste somente após confirmação. ±5/30/60s gera revisão; conflito e ações existentes em auditoria complementar |
| LIVE-06 | Mesmo contrato TAKE no navegador e controle de transporte externo | Implementado e validado em software/engine nativo | Resolvedor comum: sem item explícito usa o CUE, nunca Próximo; MAM/QC não vira programa; fonte direta precisa de um único evento publicado. CUE antigo/item de outra revisão recusados. Integrações conservam suporte a ID explícito publicado. PARK sem item não anuncia sucesso. Serviço informa accepted/NATIVE/SIMULATED/nativeProgramConfirmed/awaitingSignal/physicalOutputValidated=false. 6 testes de domínio + rota autenticada; Temp/RPlayout-device-automation-BM9LwB passou nativo. r18 antecede esta correção |
| OMT-01 | Receptor nativo e descoberta oficiais | Implementado; loopback completo nativo passou | Descoberta SDK, appsrc e canal real: vídeo 320×180/25fps e áudio 2ch/48kHz; PVW e PGM usam buffers recebidos, não apenas ACK. Corrigida conexão de pads estáticos antes de caps negociados. Emissor externo e estabilidade longa pendentes |
| OMT-02 | Transmissor nativo no engine | Implementado; loopback nativo passou | libomt/libvmx oficiais; UYVY e FPA1; conta vídeo realmente entregue. Homologação externa e longa duração pendentes |
| PLAN-01 | Schedule editorial separado da playlist publicada | Implementado no runtime; software validado | Transporte/Master consomem execução publicada; mídia, SVG/campos, deixas e eventos secundários congelados; edição de outra data usa contexto editorial próprio. Eventos têm ledger durável por passagem/revisão; FIRING incerto não reenvia comando externo. Edição/manual no Master e registro consultável; migração 11 |
| PLAN-02 | Revisões, diferenças, rollback e ativação explícita | Implementado; software e página validados | 8 testes de domínio + 5 de rotas; simular, publicar, editar, inserir, remover, desfazer e consultar grafismos de outra data conservam PGM/CUE; comparação inclui grafismos. Publicação de revisão 1 e zero diferenças verificados na página QA |
| PLAN-03 | Publicação e comando nativo não disputam estado de execução | Publicar/rollback/ajustar live/ativar grade serializados; auditoria global complementar | 5 testes novos de transporte: TAKE retido precede publicação, CUE espera publicação, ACK live pendente bloqueia revisão ativa mas permite data futura, revisão/corte alterados recusam TAKE. Ativação explícita confere PGM/CUE dentro da fila e antes/depois de instalar; grade de outro canal e seleção superada não são anunciadas como sucesso. 2 testes de corrida + rota com STOP/limpeza de CUE; 14 testes publicação e 16 rotas. Novo botão LIMPAR CUE/PVW não muda PGM; visualização desse botão pendente porque a aba de teste foi bloqueada pelo navegador. Temp/RPlayout-device-automation-KiFRz1 conferiu bloqueio de ativação durante PGM nativo e troca após STOP sem replay. Fixture não tem publisher PVW; não usar esse ensaio para provar imagem preview. Reinício/topologia/restore globais ainda precisam de auditoria |
| TIME-01 | Timing determinístico persistido, simulação e ajustes auditados | Implementado no serviço de publicação; auditoria complementar de execução | Revisão congela plano resolvido, regras, proteções e compensações; simulação separada. Mesmo input produz mesmo resultado; mudança somente nas zonas aparece na comparação. A biblioteca continua no servidor, não é um processo de timing independente |
| TIME-02 | Zona protegida, prioridade e duração dinâmica de live | Zona formal implementada e validada em software/página; sinal físico pendente | Nome, intervalo local até 48h e prioridade 1–5; protege itens na posição nominal/atual. Prioridade igual/menor preserva; maior e FIXED/HARD_TIME podem compensar, registrando violação explícita. Edição com conferência de versão, auditoria atômica, migração 13, publicação separada de PGM/CUE. 7 testes de zonas, 12 de rotas operacionais e 2 de limites live. Página conferiu 28h–29h, revisão 1 preservada e diferença visível; screenshots zonas-protegidas-editorial.png e zonas-pendentes-publicacao.png |
| OPER-01 | Inserir próximo/agora, retorno ao VT | Implementado localmente; arquivo nativo validado; live físico e navegador pendentes | Inserção somente na edição congelada, nova revisão/timing/conflitos, sem publicar rascunhos nem copiar comandos externos. NEXT conserva PGM/CUE e política Auto Next/loop do atual; NOW aguarda identidade PGM nativa e registra cursor do VT interrompido. 17 testes HTTP + 3 novos de transporte. Temp/RPlayout-interrupted-return-m88EYU valida CUE manual conservado, mesmo PID, duplicatas, auditoria falhando após corte real e restart/reconciliação sem replay. OPER-02/SEC-20 cobrem retorno durável. Cursor é o último reportado, não precisão física. Live ACK/erro/quadro testados com protocolo controlado; não homologa NDI/SDI/OMT externos |
| MEDIA-01 | Fila durável de ingestão, estados e versões imutáveis | Implementado base; auditoria complementar | Migração 3, batches retomáveis, versões por SHA-256, cópia preservada, fila ARCHIVE/PROXY com falha explícita e reexecução; 3 testes. Arquivo Unicode real ingerido e proxy preparado no servidor QA |
| MEDIA-02 | Proxy/transcode e preview de baixo consumo | Implementado; validação complementar | Monitores 240p/15fps/450kbps; proxy nativo 426×240/10fps/220kbps + áudio 48kbps; QC não baixa original por padrão. Teste nativo decodifica vídeo/áudio e navegador reproduz proxy real |
| MEDIA-03 | QC por perfil, ressalva/reprovação e bloqueio de PGM | Implementado base; testes e interface validados | Perfil por canal: codec/FPS/interlace/áudio/duração/loudness. Decisão por canal/hash, ressalva, análise e bloqueio; versão nova não herda aprovação. Inserção/importação/autofill e engine respeitam decisão. 3 testes de contrato + 4 de workflow; codec H.264 sondado no arquivo Unicode real |
| MEDIA-04 | Pasta remota na página, caminhos Unicode, ignorados somente vídeo | Pasta/destino validados na página; filtro de vídeo validado em software | Pasta “Ação — Prévia” e destino .mkv usam navegador do servidor na página; WinForms retorna 410. Arquivo existente/traversal/nome reservado recusados, 32 testes. Ignorados segue busca e mostra apenas VIDEO: áudio/imagem/documento legado com probe falho não vira vídeo. Probe bem-sucedido não depende de lista de extensões; lista ampla serve apenas para vídeo avariado. Novos PDF/TXT/XLSX inválidos são pulados, MXF avariado é registrado; 2 testes de filtro + 10 ingestão. Screenshots pasta-remota-unicode-listada.png e gravacao-destino-remoto-unicode.png. Importação universal permanece v2.5 |
| UI-01 | QC com imagem maior e safe area no vídeo 16:9, desligado por padrão | Implementado; página validada | QC direto após recarga, vídeo 839,2×472,05 (16:9), safe 90/80% sobre a imagem; desligado por padrão e após o teste. Screenshot em artifacts/qa-20260930/qc-proxy-safe-off.png |
| UI-02 | Scopes e áudio responsivos, renderização econômica | Implementado base; calibração broadcast não alegada | Amostra 160×90, scopes até 10Hz/4Hz parado, áudio L/R/phase real no proxy; 2 testes de análise. Fonte sem arquivo/quadro não mede thumbnail de erro. Labels distinguem preview aproximado de loudness do original |
| REC-01 | Checkpoint durável e recuperação PGM após engine/servidor cair | Engine, runtime e crash completo do servidor compilado validados em fakesink | scripts/verify-engine-recovery.mts: watchdog/novo runtime conservam posição/revisão/identidade e apenas um evento. scripts/verify-server-recovery.mts: servidor próprio 1068 encerrado abruptamente; engine 19080 encerrou sem órfão; servidor 7284/engine 7340 retomaram quadro 51, revisão e passagem. Snapshot WebSocket, STOP persistido e duas linhas as-run RESTART/STOP conferidos. Evidência Temp/RPlayout-server-recovery-A8Lolx. Não homologa saída física |
| REC-02 | Contingência real acionada pela sonda, cache e mídia ausente | Slate e loop implementados; loop nativo e retorno/crash validados; host B pendente | Seleção explícita de revisão publicada, vídeos aprovados/cópia local verificada, loop contínuo sem live/âncora/hold/comando externo. Preparação não carrega a grade no runtime; commit após identidade PGM nativa, antes de checkpoint/as-run. QC/revisão alterados durante preroll impedem o corte. Origem/cursor preservados no checkpoint, retorno manual validado e quota protegida no reinício. Automático desligado por padrão; host B não é anunciado pronto. Ensaio compilado Temp/RPlayout-server-recovery-rxZkvC fez ciclo de dois arquivos, crash do loop e retorno ao VT no cursor 55. Interface recusou grade incompatível sem PGM/CUE; screenshots contingencia-configuracao-sem-corte.png e contingencia-reserva-incompativel-bloqueada.png. Homologação física/ensaio longo pendentes |
| REC-03 | Gravação não sobrescrita em início/reconfiguração/reinício | Implementado no engine; teste nativo passou | Reserva atômica create-new e filesink append; destino existente recusa somente a gravação, conserva bytes e mantém compositor. 8 concorrentes obtêm uma única reserva em teste Rust. Falha permanente de arquivo agora informa failed/ação necessária, sem promessa de reconexão automática; rede mantém retry. Ensaio nativo Temp/RPlayout-recording-safety-jg8itI sondou MKV real e conferiu SHA preservado na recusa e reinício. Operador escolhe novo nome |
| REC-04 | Reinício explícito ordenado e retomada do checkpoint real | Implementado; engine compilado e testes validados | /channels/:id/restart compartilha fila nativa, aguarda comandos e recusa live sem confirmação. Salva posição antes de retirar o runtime; comandos antigos após retirada são recusados. Runtime novo solicita recoverCheckpoint; simulação não se anuncia recuperada. Resposta declara interrupção controlada, pedido de recuperação e erro. Ensaio inicial comprovou que o fluxo anterior recriava canal sem retomar PGM; correção passou em Temp/RPlayout-device-automation-ICITxy, com novo engine/PGM e sem replay, seguido de crash completo. 1 teste transporte + rota; total 41 transporte/17 rotas operacionais. Ainda não cobre mudanças de formato/topologia/restore global; r18 antecede esta correção |
| AUTO-01 | Controle manual e programado de equipamento identificado e confirmação persistente | Videohub implementado; protocolo, eventos, engine e página validados com receptor local | PING não roteia; crosspoint exige equipamento/portas explícitos, ACK e consulta posterior. Publicação congela cadastro; somente PGM nativo da passagem autoriza evento. Cadastro/PGM alterados antes do envio bloqueiam comando. Ledger compartilhado por manual, evento e serviço legado: incerteza bloqueia novo roteamento e não reenvia no crash. Serviço exige deviceId e requestId UUID explícitos; consumidores antigos precisam adaptar, sem equipamento implícito. 15 testes driver/gateway, 8 ledger, 6 rotas manuais/serviço, 7 automação e 4 rotas programadas. Temp/RPlayout-device-automation-0HkDTK aprovou vídeo nativo, duração STOP, duplicata, serviço sem bypass e recuperação sem replay. Página evento-videohub-editorial-portas-explicitas.png. Não homologa hardware; ATEM/GPIO permanecem bloqueados |
| ASRUN-01 | Histórico e exportações com duração e proveniência verificáveis | Implementado; migração, testes, engine nativo, página e PDF validados | Migração 14 persiste cadência/ocorrência, transporte e evidência. Cursor final menos inicial mede duração nativa; preset atual não reinterpreta legado. Cadência ausente é nula; relógio fechado pode gerar estimativa explícita; aberto/invalidado não ganha duração. NEXT/TAKE/STOP/RESTART não viram PLAYED_FULL por atingir 95%; EOF/EOS são distintos. CSV servidor também neutraliza fórmulas; XML legado preserva contrato mas declara schemaValidated=false/rascunho, sem prometer SMPTE. Totais avisam durações ausentes. Removidos certificados/assinatura aleatória/aprovação fictícios. 4 testes evidência servidor, 5 cliente, 3 relatório; PDF de 60 registros/três páginas reinspecionado. Screenshot asrun-cortes-cadencia-historica.png. Não comprova saída física/NTP/apuração legal |
| CACHE-01 | Pré-cópia das revisões publicadas de 48h/7d, proteção por canal e atualização de caminhos | Implementado; testes e painel QA validados | Data/timing/hash congelados, QC por versão/canal, arquivo arquivado preferencial, deduplicação SHA, proteção por canal sem remover PGM/CUE de outro canal. Limpeza e contabilização limitadas aos arquivos gerenciados: não removem originais/documentos estrangeiros numa pasta compartilhada. Não troca data/revisão/transporte. 6 testes de planejamento + 2 de API + 8 de cache + 3 de sequência. Screenshot artifacts/qa-20260930/cache-futuro-48h-7d.png |
| HA-01 | Segundo host/standby, replicação, failover e as-run | Parcial: estado, mídia, concessão nativa e ensaio de restauração validados localmente; failover completo pendente | Dois servidores compilados com bancos/cofres distintos replicam publicação/checkpoint/as-run e continuam sequência após crash. Reserva não abre engine, mesmo com canal local e binário nativo configurado. HA-02 acrescenta mídia retomável por SHA; HA-03 acrescenta testemunha independente e expiração nativa; HA-04 restaura edições/cursor/QC em banco isolado. Promoção, fencing externo da saída, RPO/RTO e homologação entre máquinas permanecem pendentes. Não chamar espelho, ensaio, A/B preroll ou preferência de fonte SRT de redundância física |
| HA-02 | Replicação de mídia publicada para o reserva | Implementado; software e dois servidores compilados locais validados | Vídeo/áudio/imagem das edições ativas ou referenciadas pela execução/contingência, deduplicados por SHA. Blocos de 256 KiB criptografados/autenticados com finalidade MEDIA distinta de STATE, offsets SQLite FULL após fsync, quota incluindo parciais, limite de rede sobre bytes reais do envelope. Origem conferida por handle/hash, caminhos remotos nunca são usados para gravar; receptor único/pasta vinculada ao banco, sem sobrescrita. Publicação exclusiva por hardlink no mesmo volume; filesystem sem hardlink não confirma cópia. SHA errado/parcial não vira disponível nem autoriza PGM. 22 testes de domínio/HTTP e um de markup novos; suíte integral 157 arquivos/1229 passou. NczT7O confirmou interrupção do reserva aos 262144 bytes, restart/retomada/SHA, VT nativo no primário, bancos/cofres/seq distintos. Sem prova de host físico, takeover, fencing, codecs de áudio/imagem no reserva ou política automática de remoção de cópias antigas |
| HA-04 | Restaurar edição recebida antes de promover reserva | Ensaio isolado e reconciliação de crash implementados/validados; ativação/promoção pendentes | Pedido UUID sela canal/seq; ledger durável consulta duplicata sem repetir trabalho. Revalida mídia READY por SHA sem criar parciais; recusa seq superada/cursor inválido/revisão duplicada/mídia referenciada ausente/loop ausente/SHA inválido em edição exigida. Histórico legado não exigido permanece para consulta. Reconstrói publicações imutáveis, política QC, zonas, cursor parado e decisões QC em DB novo exclusivo com integrity/FK. Contexto/as-run/journals ficam cifrados como proveniência, não comandos executáveis. Canal arquivado, saídas/contas/inputs ausentes; marcador impede runtime mesmo após desarquivamento. APPROVED legado sem decisão por hash vira PENDING; sonda local necessária. 24 testes de domínio/4 checkpoints/10 fronteira HTTP e suíte 159 arquivos/1281 testes passaram. ilf9nA confirmou servidores compilados/testemunha/PGM nativo primário, mídia retomada/restauração, criador independente vivo recusado, crash/reconciliação/restart, workspace preservado e novo ensaio com novo UUID. CHECKING só é reconciliado com morte local comprovada; dono desconhecido/legado/vivo/host estrangeiro/EPERM não é liberado. Sem promoção/failback/host físico; API administrativa, sem botão de takeover ou ensaio na UI. Posterior ao r23 |
| HA-05 | Decodificação local e perfil técnico da mídia recebida no reserva | Implementado; H.264 progressivo/estéreo/R128 e recusa por áudio ausente validados com binários reais locais | Ensaio usa RPLAYOUT_PROBE, uma sonda por SHA, prioridade baixa, ambiente sem credenciais RPlayout, limite 15 minutos/1 MiB e cancelamento com fechamento do filho próprio. Contadores nativos de buffers diferenciam caps de decodificação real. Conferência SHA/identidade/tamanho/mtime/ctime antes/depois recusa alteração mesmo com bytes restaurados. Executável identificado por SHA e mudança recusada; isso não identifica cada plugin/DLL. Resultado cifrado por SHA em ha_recovery_media, sem alterar payload publicado ou aprovar mídia. localProbeRequired=false não equivale a perfil PASSED, QC aprovado ou promoção. Campos locais/duração/loudness são obtidos da sonda, não do primário. 160 arquivos/1303 testes, tipos, build servidor e 11 testes Rust da sonda PASS. llCguk comprovou 1800 buffers de vídeo/3376 de áudio e R128; oSRON4 comprovou decodificação do VT sem áudio e recusa pela política obrigatória. Sem tomada de PGM no reserva, trims/mixes alternativos, todos os codecs, áudio/imagem isolados ou homologação física. Posterior ao r23; pacote final pendente |
| OBS-01 | Saúde central por fonte/saída/engine/host e incidentes reconhecíveis | Persistência e correlação base implementadas; auditoria complementar | Mudanças de estado por fonte/bus geram histórico e eventos externos. Host/engine/saída têm incidentes e reconhecimento. Tally não fica verde por cadastro, simulação ou ausência de erro; execução do processo não comprova sinal físico |
| OBS-02 | Histórico CPU/GPU/RAM/disco/rede, recuperação e alertas externos | Histórico e fila externa implementados; destino real não configurado no QA | Coletor único 10s/14 dias; dados ausentes N/D. Outbox criptografada, reenvio progressivo até 8 tentativas, timeout 5s, ID estável e confirmação HTTP; sem promessa exactly-once. 5 testes de fila + 3 de API; UI das últimas 100 entregas e reenvio manual. Falha de retenção gera incidente local; histórico resolvido retido 30 dias |
| SEC-01 | Expiração/revogação, CORS, permissões por canal/estação e auditoria | Implementado base; auditoria complementar | Sessões hasheadas/expiração/revogação, restrição canal/IP, origem, proteção de primeiro/último administrador, limitação de tentativas; 8 testes. Controle externo exige comparação constante do token |
| SEC-02 | Proteção de segredos em repouso e respostas redigidas | Cofre, diagnóstico e referências de entrada implementados; auditoria complementar | AES-256-GCM por coluna, DPAPI CurrentUser fora do SQLite. Entrada com credencial usa referência autenticada no HTTP/WebSocket; endereço de exibição mascarado não vai ao decoder. Cadastro, CUE, TAKE, grade e edição resolvem URI original no servidor; referência anterior continua válida após reinício com o mesmo cofre. Identidade HMAC estável conserva a correlação QC/PVW mesmo com novo envelope aleatório. Nome NDI/OMT Unicode e URI sem segredo são preservados literalmente. 5 testes de fronteira + 4 de rotas + 3 de cliente; servidor compilado Temp/RPlayout-source-wire-AzXsr2 conferiu snapshot/tick WebSocket, HTTP, apelido, reinício e identidade estável. Teste usa transporte simulado, não comprova quadro físico. UI conferiu apelido e URI privada inalterada: artifacts/qa-20260930/input-conexao-protegida-apelido.png. 3 testes adicionais de saídas/destinos e 1 de presets impedem substituir segredo por máscara ou reaproveitar máscara em outro protocolo. Proteções de processos/configuração em SEC-03/04; auditoria dos demais endpoints ainda pendente |
| SEC-03 | Endereço privado entre servidor, engine e relays; ambiente sem segredo administrativo | Implementado; testes e processo nativo validados | Bootstrap por stdin, não argv/variável de ambiente; mesmo leitor bufferizado mantém comandos seguintes. Watchdog/reconexão reenviam a configuração privada. Helpers nativos só herdam as opções RPLAYOUT de runtime OMT/encoder, não cofre/admin/token/destino. Legacy CLI explícita permanece disponível para testes manuais. 5 testes do servidor e 6 execuções dos 3 casos Rust compartilhados; Temp/RPlayout-private-startup-hGQbZm conferiu linha de comando real de dois PIDs próprios no Windows, destino SRT literal nos dois processos e ACK após bootstrap. Registry novo é previamente sondado uma vez; isso não testa recepção física |
| SEC-04 | Configuração gerada do MediaMTX restrita e revogação consistente | Implementado; ACL Windows e recarga nativa isolada validadas | Arquivo temporário vazio é restrito ao usuário do servidor/SYSTEM antes de receber chaves, Unix 0600; substituição atômica preserva original/hardlink em erro. Configurações são serializadas e respeitam janela de 1s do watcher nativo quando em execução. 5 testes conferem ACL real, Unicode, preservação de hardlink, recusa de diretório, ordem de revogação e espera do watcher. Temp/RPlayout-private-mediamtx-BfH3Tt adicionou/removeu chave na configuração nativa sem reiniciar PID; todos os listeners de sinal ficaram desativados. Não é prova de continuidade física PGM |
| DB-01 | Migrações formais e backup validado por restauração | Implementado; legado protegido testado | Migrações 1–18, WAL FULL; restauração isolada com integrity/FK/contagens e autenticação. Backup protegido anterior às tabelas 10/11 e diagnóstico 12 é reconhecido antes do upgrade; tabela faltando com migração registrada e campo atual desprotegido são rejeitados. Histórico pré-14 conserva duração/cadência ausentes e proveniência UNKNOWN em teste de arquivo SQLite reaberto. Migração 15 adiciona archived_at sem apagar histórico; 16 conserva conversões e 17 valida estrutura/proteções/contadores editoriais, sem recriar revisão fictícia em banco atual incompleto. 18 atualiza triggers de QC global e invalida revisões anteriores uma vez, com teste de upgrade de arquivo 17 para 18 e backup antes/depois. Projetos restauram deixas/eventos editoriais e são recusados durante PGM/comandos pendentes |
| PKG-01 | Pacote autossuficiente Node/módulos nativos e engine atual | Pacote r23 validado localmente; final do escopo pendente | release/RPlayout-1.1-broadcast-20261004-r23 inclui estado/mídia HA, testemunha/concessão nativa e correção de partida fria. Não exige tsx/tsc/pnpm operacional. Integridade/Node/SQLite/plugins/scanner/engine/PATH portátil/MSVC app-local passaram; manifesto EAFD52DCBC09141563B12C830B0F753FD72F0168A295A68707D68710F3BE6304. W14tJI validou testemunha empacotada/termos/expiração; R4pWad validou Node/engine/plugins do pacote, partida 13,9s sem stalls/restarts, crash/VT/as-run/STOP/WebSocket e ciclo/crash/retorno da contingência de dois arquivos. Saída null, sem homologação física ou failover de host. r22 preservado com defeito de prazo de startup observado; não usar como candidato final. r21 preservado com provas aC4j6J/2QmyHz, não reatribuir seus ensaios ao r23. Documentos embalados refletem o instante da build, não validações posteriores; pacote manifestado não foi alterado. Objetivo geral e pacote final após demais implementações continuam pendentes |
| TEST-01 | Matriz homologada de sinal físico NDI/SDI/OMT | Pendente externo | Necessita hardware/emissor; separar de testes automatizados |

## Critério de encerramento

Leitura da matriz: REC-07 substitui a pendência de exclusão mencionada nas
notas históricas de REC-05/06. SEC-05 cobre a consulta da auditoria, não fecha
a revisão global de todos os endpoints. Pacotes são snapshots imutáveis;
implementações posteriores não entram numa revisão já manifestada.

Cada requisito deve apontar testes, artefato ou limitação comprovada. Nenhum
requisito pendente será ocultado sob “build validada”. Mudanças que interrompem
PGM devem ser explicitamente indicadas como interrupção controlada. O pacote
final só deve ser gerado após recompilar o engine e testar seus fluxos reais.

## Validações adicionais desta continuação

- Continuação SEC-15/DB-02 em 02/10 às 08h: zonas/deixas/eventos e seus formulários corrigidos, sem concluir o escopo inteiro. Rodada final passou em 112 arquivos/865 testes, iniciada 08h34, 86,76s; typecheck/build servidor/web/cargo check/diff check passaram. O ensaio compilado inicialmente encontrou um header JSON vazio incorreto no DELETE do verificador, corrigido; a repetição encontrou uma falha real de startup SQLITE_BUSY_SNAPSHOT no cofre, corrigida no produto sem apenas reiniciar ou aquecer o fixture. BG85Qi passou com HTTP 53869/53870, processos próprios 18028 e 11696→9432→22728, cobrindo revisão/scope/publicação/rollback, zonas, GC/eventos e undo entre dois processos. DcIBl9 passou com HTTP 53978/receptor 53977, publicação 3c043ad5-ae31-4e8a-af69-27a07656e7ad: engine nativo, comandos sem replay, reconfiguração/restore/arquivamento e histórico conservados; saída null/publisher PVW desligado, não hardware físico. Instância QA antiga 24272 foi encerrada somente após conferir PID/executável/comando/listener. Novo PID 12912, session 90207, em 127.0.0.1:4041, conserva banco/cofre, 14 itens/revisão 25494162001859. GET de automação entrega revisão/owner correspondentes; zonas, deixas e eventos sem If-Match devolvem 428 sem alterar ItemViews/revisão. Build index-dyAs7YqB.js/index-D9GOEo6B.css respondeu HTTP 200 e está no HTML; isso não é inspeção visual. Processos dos verificadores foram encerrados por eles, QA permanece disponível. r21 continua imutável e anterior às mudanças. Permanecem proposta congelada de autofill, revisão de modelos/comandos restantes, matriz/pares reais de áudio no engine, virada operacional, banco separado, HA entre hosts/replicação/fencing, pacote final e homologação física/visual.

- Revalidação final do engine/automação após SEC-14: wfSyqh passou com HTTP 53020/receptor local 53019, publicação ea1f8215-718f-45d0-b8c7-4e206c1cbebe. Confirmou PGM nativo, ativação sem troca implícita de PGM, comando manual não repetido, bloqueio por crosspoint incerto, restart/recuperação sem replay, reconfiguração/restore e arquivamento preservando publicação/as-run. Saída null, publisher PVW desativado e receptor de protocolo local: não é homologação de hardware nem redundância entre hosts. Os processos temporários deste ensaio e de VF1aAv/Np9GU4 foram encerrados por seus próprios verificadores; somente o QA 4041 permanece disponível.

- Continuação SEC-14 em 02/10 às 08h: publicação/rollback revisados e implementados, sem declarar concluído o relatório inteiro. Rodada integral final: 110 arquivos/840 testes, 08h05, 88,82s; typecheck/build servidor/web/cargo check/diff check aprovados. Servidores compilados VF1aAv, portas 52868/52869, processos próprios 13620 e 19644→17208→23104, passaram os contratos de edição e publicação entre processos/reinício; nenhuma saída física ou replicação foi validada. Engine nativo Np9GU4, HTTP 52999, PIDs próprios 23140→21532, passou corte/cadência 25→50fps, proteção do PGM, histórico preservado e exigência de republicação, com saída null e sem publisher PVW. Ensaio anterior sMm5jA passou automação/PGM/reconfiguração/restore/arquivamento com receptor Videohub local, não placa real. QA 4041 substituiu apenas seus próprios processos 12856→6372→32, session atual 31723, preservando migração 19, banco/cofre, 14 itens e revisão 25494162001859. Build atual index-DXNHH8Mq.js/index-D9GOEo6B.css respondeu HTTP 200 e está referenciada pelo HTML. A grade QA contém automação de equipamento ausente/desativado: simulação/publicação recusam com 409 e preservam ItemViews/revisão; não se removeu o evento para fabricar sucesso. Fixtures isolados válidos provaram 428 para ausência de revisão/prova e 409 para superação. Consulta HTTP não foi confundida com inspeção visual. Pacote r21 não foi alterado. Permanecem guardas equivalentes de zonas/grafismos/eventos e demais comandos, proposta congelada de autofill, matriz/pares reais de áudio no engine, virada operacional, banco separado, HA entre hosts/replicação/fencing, pacote final e homologação física/visual.

- Continuação SEC-13/TIME-03/MEDIA-05 em 02/10 às 07h: a retomada encontrou cópia de quadros sem conversão entre canais e dois consumidores que ainda carregavam vídeo original. Corrigidos e registrados acima, sem reinterpretar padrões legados de FPS desconhecido. Rodada integral final passou em 108 arquivos/818 testes; typecheck, build servidor/web, cargo check e diff check passaram. Ensaio compilado XBAfbI usou portas 51664/51665, PIDs próprios 21256 e 17180→1480, revisão 2→19: revisão ampla superada, rollback SQL, undo de usuário existente alterado, taxa do padrão/undo e corte 25→50 por outro processo conferidos. Ensaio nativo DXkuO5, HTTP 51405, engines próprios 16084→3804, confirmou publicação/PGM 25fps, bloqueio de conversão ativa, engine convertido parado, republicação/PGM 50fps e cortes com mesmo tempo; saída null/sem PVW, não homologação física. Instância QA 4041 conferida por PID/executável/comando/listener antes de atualizar; agora PID 12856, session 97886, migração 19, mesmo banco/cofre e 14 itens/revisão 25494162001859. HTTP readonly de revisão 200 e recusa sem token 428 preservaram ItemViews/revisão; o schedule é recalculado pelo relógio e não foi confundido com alteração editorial. Assets index-BV02PZ0E.js/index-D9GOEo6B.css HTTP 200. Proxy MP4 real de 113221 bytes respondeu range 206; identidade antiga 409, sem original. Transporte QA simulado/MediaMTX desativado, sem nova inspeção visual. Pacote r21 permanece imutável e anterior a estas mudanças. Permanecem publicação/rollback/proteções/eventos e demais mutações equivalentes, proposta persistida de autofill, matriz/pares reais de áudio no engine, virada operacional de data, banco separado, redundância entre hosts/replicação/fencing, pacote final e homologação física/visual. Fonte e build avançaram; nenhuma dessas pendências foi chamada de pronta pela suíte verde.

- Continuação SEC-12 em 02/10 às 06h09: 103 arquivos/756 testes passaram (11 adicionais sobre SEC-11), tipos e build servidor/web passaram. Os três testes novos de preservação de trilha tinham assumido zero em vínculos cujo legado era null; passaram a comparar antes/depois, sem converter o dado original. Última build inclui alertas de formulário e desativação explícita de seletores SDI que não enviavam configuração alguma ao engine; inspeção visual segue pendente. Ensaio EiT2Ps, HTTP 50118/50119 e PIDs próprios 24428/9608→13460, confirmou revisão durável 2→17, recusa de trim/audio sem header, rollback de padrão/contadores e undo conjunto do nível/trilha, além dos casos SEC-11. Transporte SIMULATED, não áudio físico, replicação ou HA. QA próprio 24400 foi conferido por executável/comando/listener e substituído por 18932, session 47604, banco/cofre e 14 itens/revisão inalterados; assets index-C1qHs16-.js/index-DsAAE4YL.css HTTP 200, MediaMTX desativado. Recusas reais HTTP 428 de corte e áudio no QA não alteraram ItemViews ou revisão. Próxima proteção necessária é revisão/fingerprint da lista de todos os alvos amplos, apresentada antes da confirmação: o If-Match da origem não detecta edição exclusiva de outra grade. Também permanecem publicação/rollback e demais mutações, proposta persistida de autofill, vínculo real de canais/pares de áudio no engine, virada operacional de data, banco separado, HA/replicação/fencing, pacote final e homologação física/visual. r21 preservado, não contém SEC-12.

- Continuação SEC-11 em 02/10 às 05h: suíte integral passou em 103 arquivos/745 testes (30 adicionais sobre SEC-10); typecheck, build e cargo check passaram. Erro de retorno da montagem foi corrigido; um teste novo lia payload criptografado como JSON e foi ajustado para a leitura protegida do domínio. Outra rodada apresentou salto de cerca de 3h no relógio de execução e timeout de TAKE; o teste passou em repetição direcionada (65 testes), sem ampliar limites, e a repetição integral passou em 71s. Ensaio DvBjOJ usou dois servidores compilados no mesmo SQLite isolado, portas 62882/62883, PIDs próprios 1692 e 16500→12640, revisão 2→14: edição posterior impede undo com revisão atual, mantém a ação, desfazer do escritor posterior libera o passo anterior e redo antigo é recusado. Ensaio nativo VfuVoS, porta 49763, engines próprios 21032→7948, preservou revisão histórica/as-run 25 e 50 FPS e exigiu republicação, sem TAKE automático; null e sem PVW não homologam saída física. QA próprio 19232 foi conferido por executável/comando/listener antes de parar e substituído por 24400; mesma pasta, banco/cofre e 14 itens, revisão 25494162001859. HTTP confirma health/JS index-Cui802la.js/CSS index-DsAAE4YL.css, transporte SIMULATED/MediaMTX desativado, não inspeção visual. Nome abaixo da seleção NDI/OMT e alias continuam cobertos por LIVE-01 e pelos 4 testes de protocolo; não houve alteração ou homologação física dessas fontes nesta etapa. r21 não foi sobrescrito. Além de trim/áudio/publicação/rollback e outras mutações, permanecem proposta aprovada de autofill, virada de dia, banco separado, HA/fencing/replicação, pacote final e homologação física/visual.

- QA 4041 atualizado em 01/10 às 23h20 para PID próprio 17548, backend compilado atual, assets index-BF0aCPje.js/index-D1cmGRrr.css. Banco/cofre anteriores preservados; health ok e MediaMTX desativado. API nova de revisão responde no QA sem editar a grade. Transporte simulado e leitura HTTP de assets não são inspeção visual nem sinal físico. O processo usa a pasta isolada de QA; scripts de dois servidores usam suas pastas temporárias, não a instalação operacional. Revisão r21 imutável mantida.

- Continuação SEC-08/09 em 01/10 às 23h20: 101 arquivos/682 testes passaram; typecheck, build servidor/web, cargo check e diff check passaram. Teste de alteração da tabela apontou apenas uma expectativa textual incorreta, ajustada para aceitar a mensagem específica; o gate continuou recusando o backup. Ensaio compilado repetido em 1TBWcy, HTTP 60586/60587, PIDs próprios 4792 e 21456→23340: mesma revisão aceita uma escrita, rejeita a outra, conserva versão após restart, PATCH invalida editor colaborativo e descarte não grava. Falha após mudar padrão de corte reverte padrão/item/contadores e não registra desfazer; grade compartilhada arquivada recusa corte/undo indiretos, reativação permite restauração autorizada. Servidores operaram no mesmo SQLite isolado, transporte SIMULATED, sem engine/MediaMTX/rede física. Isso não prova replicação ou standby. Pacote r21 não foi sobrescrito e não inclui SEC-06/07/08/09/LIVE-07/REC-08; pacote final, revisão de todas as mutações da UI, proteção de desfazer contra alteração posterior, virada de dia, banco separado, HA/fencing/replicação e homologação física/visual continuam pendentes. Ruflo não disponível entre as ferramentas expostas; nenhum swarm foi inventado. Nome da input continua coberto por LIVE-01, sem recadastro/reinterpretação de aliases nesta etapa.

- Fechamento REC-08 em 01/10 às 22h31: repetição integral passou novamente em 100 arquivos/655 testes após invalidar a revisão colaborativa anterior na conversão. Typecheck e rebuild finais passaram; engine compilado repetiu o fluxo com mídia SHA real em KPnX8S, HTTP 59613, PIDs próprios 10968→14076, preservando publicação antiga e as-run 25/50 FPS, sem TAKE automático. QA 4041 agora PID 18620, assets index-Ch9sthui.js/index-D1cmGRrr.css; banco/cofre originais de QA preservados, engine físico/MediaMTX desativados. Não houve modificação da estação do operador ou do pacote r21. Diff check padrão passou; uma checagem experimental com autocrlf desativado marcou CRLF Windows como espaços finais, não foi usada para reformatar arquivos nem ocultar erros.

- Continuação de 01/10 às 22h23: 100 arquivos/655 testes passaram, typecheck, build servidor/web, cargo check e diff check passaram. A primeira rodada encontrou um teste esperando apenas 15 migrações; atualizado para 16 e incluídos backup protegido pré-16 e corrupção da tabela nova. REC-08 converte FPS somente com revisão/STOP/CUE limpo e exige republicação; as revisões históricas e as-run não são reinterpretados. Ensaio compilado J2itvo, HTTP 59498, trocou o engine próprio 22520 por 1724: PGM ativo recusado; publicação byte-preservada; novo canal parado e TAKE bloqueado; após publicação, VT confirmado a 50 FPS. As-run nativo conserva 25 e 50 FPS respectivamente. Saída null e sem preview publisher: não homologa hardware/PVW. QA 4041 atualizado de PID 22548 para 9176 com banco/cofre preservados; serve index-Cbhq3zK3.js e index-D1cmGRrr.css, transporte simulado. HTTP de assets não é inspeção visual. Pacote r21 continua imutável e não inclui REC-08/SEC-07/LIVE-07. Permanecem banco separado, HA entre hosts/replicação/fencing, concorrência durável e revisão global restante, virada operacional de data e homologação física/visual. Notas anteriores de conversão pendente são históricas, superadas por REC-08.

- Continuação de 01/10 às 21h52: 97 arquivos/627 testes passaram; typecheck, build servidor/web e cargo check passaram. Bundle atual index-MsMdIFmt.js, QA 4041 atualizado para PID 22548 após validar PID/comando/porta do anterior e preservar banco/cofre. API responde saudável, MediaMTX desativado e transporte simulado; leitura HTTP de assets não é validação visual. Ensaio compilado HTTP/WebSocket/cofre NWWy6X passou com alias e identidade estáveis após reinício, sem vazamento; transporte SIMULATED, não sinal físico. SEC-07/LIVE-07 são posteriores ao pacote r21, que não foi alterado. A rodada de 19h50 anterior ao monitor passou 96 arquivos/615 testes. Permanecem pendentes conversão explícita de cadência, banco separado, redundância entre hosts/replicação/fencing, revisão global restante e homologação física/visual. Nenhuma dessas pendências foi reclassificada como concluída pela suíte verde.

- Fonte atual após SEC-06, 01/10 às 19h21: rodada integral passou em 92 arquivos/577 testes, typecheck/build servidor/web e diff check passaram. Quatro testes do inicializador cobrem conta sem canal autorizado, sessão não autenticada, sessão atrasada e snapshot atrasado após substituição. QA 4041 serve a build web atual com backend 17464; este teste é de contrato/compilação, não inspeção visual. r21 permanece válido para REC-07/SEC-05 e ensaios nativos registrados, mas não contém SEC-06; não foi sobrescrito. Escopo completo continua ativo: redundância entre hosts/fencing/replicação, separação do banco, conversão explícita de cadência, auditoria assíncrona/global e homologação física/visual ainda não encerrados.

- Encerramento da rodada de 19h14: 91 arquivos/573 testes passaram; typecheck, build servidor/web, cargo check e diff check passaram. Restauração com arquivamento passou sem alterar backups operacionais. Em revisão posterior apareceu um estado antigo no login de conta sem canal: SEC-06 agora limpa a sessão local e cancela respostas atrasadas do bootstrap, com 4 testes adicionais aprovados. A build r21 permanece imutável e antecede essa correção da tela; build/suíte atuais serão registradas separadamente. Não declarar segurança assíncrona global encerrada apenas por esses quatro testes.

- Pacote r21 concluído e verificado em 01/10 às 19h13: manifesto 367CD7FF131F4251CE3990F8D91D0E7A0BA5BD9B4738380E4B8006732ED64A52. Ensaio aC4j6J, HTTP 57176/receptor 57175, revisão d4195cfa-8f71-4d8d-8776-a9f446d92e5a, passou usando Node/engine/runtime incluídos: reconfiguração/restore e queda retomam PGM sem replay; arquivamento encerra engine/preserva publicação/as-run e reativação não inicia engine/TAKE. HTTP/WS 2QmyHz passou com credencial protegida, alias e identidade estáveis após reinício e envelope renovado; transporte SIMULATED, não sinal físico. Backup novo restaurado e reaberto passou nos 8 testes de arquivamento, conservando migração 15/canal retirado/checkpoint parado/histórico/publicação/auditoria autenticada. API 4041 continua PID 17464 e serve assets da build atual; inspeção de conteúdo HTTP não é validação visual. Matriz atualizada no workspace após a build, sem modificar documentos do pacote manifestado.

- Consolidação de 01/10 às 19h09: 91 arquivos/572 testes passaram, incluindo 7 testes de arquivamento (Supervisor com apenas um canal visível) e conservação do gate no WebSocket. Typecheck e diff check passaram. Uma nova revisão r21 será gerada sem modificar r20 para incorporar também os últimos ajustes da tela; validação do pacote r21 ainda não deve ser presumida neste snapshot documental.

- Ajuste final de contrato da tela, posterior a r20: WebSocket agora conserva reconfiguration ao atualizar Live (antes descartava o campo recebido); teste do mapeador passou. Arquivar o único canal autorizado da conta limpa a visão antiga e libera acesso ao Histórico/Auditoria sem manter Master do canal retirado. O bloqueio do último canal é exclusivamente global e transacional no servidor, não inferido pela quantidade visível no navegador. r20 foi verificado e passou o ensaio nativo próprio QYXfWc (HTTP 56953/receptor 56952, revisão 3bf4119e-ffb2-4e7b-b172-4eda86082cc0), mas antecede esses últimos ajustes de tela e não é a build final desta etapa.

- Rodada final desta etapa, 01/10 às 19h01: 90 arquivos/570 testes passaram; typecheck passou e build servidor/web passou. QA 4041 foi atualizado após conferir PID 22300/porta/executável/comando: novo PID 17464, banco existente preservado, API publica o gate reconfiguration e transporte permanece simulado. Nada na máquina de operação ou hardware foi alterado. Auditoria, arquivamento e histórico exclusivo de conta sem canal ativo ainda não têm inspeção visual, pois a aba está bloqueada por política. Engenharia passa a exibir o motivo e desabilitar reinício enquanto recuperação está pendente; essa adição entra na build consolidada seguinte.

- Continuação REC-07/SEC-05, 01/10 às 19h: migração 15/arquivamento e auditoria por canal implementados. Rodada anterior desta etapa passou 89 arquivos/565 testes; testes adicionais de CSV, conta restrita e gate explícito de recuperação estão na rodada final. Typecheck passou; build servidor/web passou antes da extensão de Aired para conta sem canal ativo (nova build final será conferida). Ensaio nativo mTDhJR passou com HTTP 56639/receptor 56638, revisão 95dcc0ef-a940-4a91-80b9-618ae6724d69: arquivou/encerrou engine, preservou histórico e publicação, reativou sem engine/TAKE, auditou ambos, não repetiu comando. Tentativa anterior terminou em conflito 409 legítimo: estado PGM chegou antes da conclusão da promessa de recuperação. Acrescentado gate explícito reconfiguration.ready à telemetria e diagnóstico N+1, fora do hash canônico; ensaio aguarda esse gate, não reenvia mutações. r19 é anterior a REC-07/SEC-05/migração 15 e não foi modificado. Redundância de outro host, banco separado, conversão de cadência e auditoria global restante continuam pendentes; homologação física/visual permanece distinta.

- Consolidação de 01/10 às 18h15: 87 arquivos/557 testes aprovados, typecheck, build servidor/web, cargo check e diff check passaram. Pacote r19 compilado/verificado sem sobrescrever r18; manifesto EE3705A9D2A2D5F9F029B03D93614D983DFC1F9597FCCBEDDBFAC16A0830437B. Ensaios do pacote passaram com Node/runtimes incluídos: UYe3ER reconfiguração/restore/automação; a7zMBD proteção HTTP/WebSocket e referência após reinício (SIMULATED); 9FmJQc bootstrap/linha de comando privada; S2wKdD crash/PGM quadro 53; WGCrKh crash/loop de dois arquivos/retorno quadro 62. Nesta última prova, loop sobreviveu à troca de servidor/engine sem replay e retomou origem publicada. Nenhum deles homologa saída física ou HA entre hosts. Ambiente QA 4041 respondeu com PID 22300/backend novo e transporte simulado, não engine físico. Atualizações desta matriz após a build não foram copiadas sobre o pacote manifestado. Permanecem pendentes a redundância entre máquinas, separação do banco operacional, auditoria global restante, exclusão de canal, conversão explícita de cadência e homologação física/visual bloqueada.

- Continuação REC-06, 01/10 às 18h05: ensaio compilado Temp/RPlayout-device-automation-VimDPt passou, HTTP 55375/receptor 55374, revisão 1b98a99d-c67a-4805-ac73-46d8d9e5f361. Restaurar durante PGM foi recusado; após STOP o engine foi recriado, geometria retornou de 800 à largura 640 salva, publicação original permaneceu e PGM continuou parado, sem replay. 68 testes direcionados passaram após corrigir o fixture que omitia loop obrigatório. A rodada integral anterior passou em 87 arquivos/556 testes; teste adicional de PATH está na rodada final em andamento. Montagem do PATH GStreamer corrigida para raiz sem barra final. O fixture aquece agora o mesmo registry privado na geração de mídia e preserva diagnóstico de engine sem sobrescrevê-lo com health repetido; não é medida de cold-start nem prova de causa definitiva dos timeouts anteriores. PID 5748 do QA 4041, iniciado às 16h52 com backend antigo, foi encerrado após conferir executável/porta/comando e substituído pelo backend compilado atual, usando o mesmo banco isolado. Máquina de operação e hardware não foram alterados. UI nova de restauração ainda sem inspeção visual por bloqueio da aba.

- Repetição final REC-05 passou na build atual com auditoria: Temp/RPlayout-device-automation-H4ASyo, HTTP 55014/receptor local 55013, revisão 783d9819-fb18-4ec2-8fca-3bdfbab0e071. Geometria, criar/desativar/remover gravação, troca FILE hot sem novo PID, recusa de cadência, reinício explícito, crash completo e automação sem replay aprovados. Publisher preview deliberadamente ausente; não prova PVW nem saída física. Typecheck final e diff check passaram; build web avisou bundle acima de 500kB, sem erro de compilação. Não foi alterado pacote já manifestado nem a estação do operador.

- Continuação de 01/10 às 17h50: rodada integral passou em 87 arquivos/554 testes; build servidor/web e typecheck passaram. REC-05 amplia a proteção de reinício para formato e saídas; operações hot não persistem configuração antes do ACK. Auditoria dessas mutações é consultável em /api/audit sem gravar destino/chave. Teste específico confere ausência de PRIVATE_ e nenhuma linha de edição em tentativas inválidas. Ensaio A52RWh passou antes da adição dos registros de auditoria; repetição da build atual foi iniciada separadamente. Duas tentativas anteriores TFgUEm/ZEcMkg expiraram aguardando servidor pronto, sem mensagem nativa; não descartadas nem chamadas aprovadas. Mudança de cadência com grade preenchida permanece bloqueada até existir conversão explícita de quadros/publicação; não equivale a suporte dinâmico de alteração de FPS.

- Continuação de 01/10 às 17h11: rodada integral aprovou 87 arquivos/546 testes, após ajustar o novo teste de retirada para verificar shutdown (encerramento gracioso), não kill imediato. Typecheck, build servidor e diff check passaram. Resolvedor TAKE unificado entre página/serviço, sem inferir Próximo. Ensaio nativo BM9LwB confirmou contrato externo. Reinício controlado inicialmente não recuperou PGM porque somente o bootstrap chamava recoverCheckpoint; fluxo explícito corrigido e ensaio ICITxy passou sem replay, seguido de crash do servidor e STOP. Manual no workspace corrigido para pasta remota/CUE/histórico, posterior a r18; não sobrescrever cópia manifestada.
- Pacote r18 verificado e quatro ensaios próprios concluídos; não exige instalação manual de módulos. Crash hgGSw8 retomou cursor 52; contingência de dois arquivos preservou origem após nova queda e retornou ao cursor 28. Não é homologação física nem prova de redundância de dois hosts.
- Continuação de 01/10 às 16h53: 86 arquivos/537 testes aprovados, typecheck/build atualizados e diff check passaram. Ativação explícita de grade entrou na fila nativa, revalida estado antes da instalação e recusa seleção superada/PGM ativo/CUE da grade anterior. Novo controle LIMPAR CUE/PVW liga à rota existente, com teste de API conservando PGM/seleção. Conferência visual nova não concluída: navegador recusou a aba por política de URL; não contornada. Automação/reinício/STOP/ativação nativa passaram em Temp/RPlayout-device-automation-KiFRz1. Tentativa de provar CUE nesse fixture sem publisher preview foi recusada pelo engine; o script agora declara essa ausência, mantendo prova de preview no loopback OMT e rotas próprias.
- Continuação de 01/10 às 14h44: 86 arquivos/534 testes passaram na rodada integral, typecheck/build atuais e diff check passaram. A primeira rodada da revisão final identificou expectativa antiga de PLAYED_FULL/NEXT e nome do XML; testes passaram a exigir INTERRUPTED e aviso de rascunho, sem alterar o fixture de rota para fingir EOF. Ignorados e serviço legado durável implementados. Publicação/rollback/live-duration compartilham fila com TAKE/CUE, mas auditoria de todos os carregamentos ainda não encerrada. PDF de 60 registros/três páginas reinspecionado, sem perda/corte de títulos. Página recompilada confirmou legado estimado e cortes distintos de EOF.
- Recuperação nativa da automação inicialmente recusou TAKE porque o caminho passou do original à cópia SHA verificada durante preroll. Correção refaz o preparo uma única vez para a mesma mídia/revisão e somente sem CUE manual existente; não tolera mudança de cortes/hash/QC/revisão. Cinco testes novos e ensaio nativo Temp/RPlayout-device-automation-0HkDTK passaram com recuperação, STOP e serviço legado incapaz de contornar incerteza.
- Continuação de 01/10 às 14h: automação programada Videohub, migração 14 e ASRUN-01 implementados. Rodada às 13h52 aprovou 85 arquivos/522 testes; teste adicional de atualização de banco antigo passou às 14h00. Typecheck/build passaram. Ensaio compilado às 14h confirmou duração nativa e cadência persistidas além de recuperação sem repetição de comando. Exportação por botão ainda não confirmada no navegador: o observador de download expirou; conteúdo CSV/XML/TXT tem testes, mas isso não é prova do download. PDF de teste renderizado com Poppler e três páginas inspecionadas. Sem emissão física no QA.
- Notas abaixo são histórico das etapas, não declaração de pendências já resolvidas: automação DEVICE_AUTOMATION foi integrada ao ledger durável; configurações/argumentos privados foram concluídos em SEC-03/04. ATEM/GPIO reais, auditoria global restante, host B e pacote final continuam pendentes.
- Build web/servidor gerada; ainda não é o pacote final.
- Suíte completa em 01/10, às 13h03: 81 arquivos / 501 testes aprovados, incluindo controle externo, pedidos duráveis, referências protegidas de entrada, identidade estável após reinício, edição segura de saídas/destinos/presets, bootstrap privado e ACL/janela do watcher. Typecheck e build web/servidor passaram. Engine: 75 testes Rust aprovados, um OMT ignorado na rodada normal; executado explicitamente nesta continuação com libomt.dll do pacote r15 e passou com vídeo/áudio no receptor/transmissor/canal (delivered=2, quadros fonte 320×180 em compositor 640×360). Isso é loopback nativo, não homologação de emissor físico externo.
- Engine release recompilado com a correção de ligação OMT; 66 testes Rust aprovados. Teste OMT normalmente ignorado foi executado explicitamente e passou com vídeo/áudio atravessando o canal.
- QC aprovado por canal agora libera inserção/importação/autofill apenas naquele canal; decisões globais e quarentena são gravadas atomicamente com conferência de hash.
- As-run nativo registra eventos de TAKE/saída confirmados; polling não duplica linhas. Foram removidos LUFS/true peak padrão, contrato fictício e origem nacional presumida. Campos sem evidência permanecem nulos; resumo de classificação não equivale a homologação regulatória.
- Permanecem pendentes, entre outras frentes: standby/fencing/replicação de outro host, auditoria final de todos os endpoints com credenciais, automação externa de dispositivos, separação do banco operacional e pacote final de todo o escopo. Proteção formal de timing, loop local de contingência e pré-cópia futura de cache foram implementados; isso não implementa comutação automática entre dias nem redundância de máquina. Homologação de DeckLink/NDI/emissor OMT externo depende da máquina de operação.
- Controle manual de GC agora consulta o servidor; removidos ticker/notícia/nome de exemplo, timers SCTE no navegador, promessa de PTS/PID/VANC físico e indicadores estáticos de estabilidade. O estado lógico de GC não equivale a prova de pixels na saída.
- Disparo manual de evento devolve o resultado persistido: FAILED/FIRING retornam conflito, não sucesso. Duplicata não repete o efeito. SVG local executado pode ser recomposto após reinício, exceto quando encerrado; SCTE/hardware incertos não são repetidos. Diferença de publicação inclui mudança somente no SVG secundário.
- As-run captura posição de saída e motivo TAKE/EOS/LIVE_PRIORITY antes de resetar o PGM. VT continua avançando durante preroll de live; a última posição reportada é registrada após sinal confirmado. Dois testes adicionais do transporte passaram.
- Empacotamento agora inclui scanner nativo GStreamer, e launcher aponta registry/scanner/plugins para o runtime incluído. Verificador confere carregamento de codecs/NDI/DeckLink/SVG e handshake do engine com PATH portátil; isso não comprova placa instalada nem sinal físico.
- MSVC x64 oficial é incluído ao lado de launchers, engine/auxiliares, Node e scanner. Assinatura Microsoft e arquitetura x64 conferidas; verificador inspeciona o módulo carregado no engine e exige caminho dentro do pacote. Deploy é copiado sem hardlinks antes do manifesto; scripts copiados têm UTF-8 BOM para PowerShell 5.1.
- A primeira repetição do crash r5 junto da suíte/Rust expirou numa chamada HTTP de 5s; repetição isolada passou (Temp/RPlayout-server-recovery-60wNK5). Coletor de processos foi então substituído: uma consulta Windows de até 1,5s, cache de 2s e chamada compartilhada entre clientes; falha mostra N/D, não zero. 3 testes de coletor + 1 de rota passaram, incluindo mascaramento de destino e medição em todas as linhas do mesmo PID. Crash do servidor atual passou em paralelo à suíte (Temp/RPlayout-server-recovery-c7llxh). Não equivale a ensaio de carga de operação física longa.
- Sonda compartilha uma única intervenção enquanto preto/freeze/silêncio e pedido manual aguardam confirmação. Política diferente é recusada, falha libera nova tentativa; sem medição/PGM parado exibe N/D, sem acumular NaN/tempo negativo. 10 testes passaram. Loop local foi implementado depois; failover de host B continua pendente.
- Consulta de saúde do peer N+1 usa apenas HTTP/HTTPS sem usuário/senha na URL, não segue redirecionamentos com o token, mascara query sensível e não devolve mensagem interna de fetch. 5 testes passaram. Continua sendo consulta de saúde, não replicação/fencing/failover.
- Calendário usa a data/canal reais, não confunde hoje com a grade de ontem carregada no Master. Respostas atrasadas de outra data são descartadas; seleção antiga não autoriza remoção e é limpa na mudança de grade (5 testes). Criação local compartilha pedido pendente e verifica contexto antes de inserir; a API ainda admite múltiplas grades por data. Hoje sem grade não é anunciado como “No Ar”.
- Lista de diferenças na revisão deixou de encolher a altura zero com muitos alertas; teste visual mostrou grafismo e zona pendentes sem publicar. Mensagem de atualização editorial não anuncia mais sincronização/publicação fictícia. Removida cota regulatória estática de 3h45 e aprovação automática por quantidade de itens.
- Cópia de grade agora é uma transação editorial completa: início/loop/zonas, todas as flags e regras de live, cortes/áudio, grupos com novos IDs, grafismos e eventos secundários remapeados. Não duplica publicação/as-run/ledger. Origem ausente ou de outro canal não cria grade vazia; falha durante grafismo desfaz também a grade e os itens. 3 testes de cópia + rota com PGM/CUE/revisão preservados (13 testes operacionais).
- Atualização de runtime instala grade/revisão/mapas de mídia e grafismo juntos após todos os awaits. Load antigo ou refresh iniciado antes do corte não reinstala grade anterior. Telemetria compartilha um único refresh lento; edição explícita pode superá-lo. Dois testes de concorrência passaram; domínio de publicação possui 12 testes e rotas operacionais 15.
- O primeiro ensaio de contingência recusou o corte por comparar identidade do objeto recalculado em cada refresh; a conferência foi corrigida para identidade operacional (grade/revisão) mais vigência do QC/publicação. Repetição nativa passou com ciclo completo, novo engine após crash, origem preservada e as-run CONTINGENCY_RETURN no cursor 55. Não chamar isso de failover físico.
- A rodada integral concorrente com Rust/crash teve um timeout DPAPI de 5s no preset; repetição focada passou em 476ms e rodada integral isolada passou. O timeout do teste não foi ampliado nem o erro ocultado.
- Videohub deixou de considerar qualquer byte TCP como sucesso. ACK de PING, dump inicial e ACK isolado do roteamento não confirmam o crosspoint; fonte/destino exigem inteiros explícitos dentro do limite anunciado. Gateway não sobrescreve equipamentos de mesmo tipo e serializa pedidos por equipamento, conferindo cadastro alterado antes do envio. ATEM/GPIO sem driver físico não anunciam sucesso.
- Controle manual no navegador exige sessão/permissão OUTPUT_CONTROL; token de serviço não autoriza essa rota nem é devolvido ao navegador. Cadastro pode ser desativado sem comando físico. Pedidos sobrevivem ao reinício, com resultado incerto separado de FAILED e de EXECUTED; conferência registra nota/ator sem apagar incerteza histórica. Auditoria da rota de serviço legada e automação DEVICE_AUTOMATION ainda precisam de integração durável.
- URI de entrada exposta em listagem/snapshots foi substituída por referência autenticada, vinculada ao protocolo/contexto do cofre e resolvida somente no servidor. Máscara adulterada é recusada antes do decoder; a referência não concede sessão, papel ou canal. CSV da grade mascara o endereço; comparação N+1 mantém seu contrato diagnóstico, não tenta executar URLs redigidas. Aliases e duas fontes de mesmo host com segredos distintos têm testes; proteção de NDI Unicode conferida para não transformar nome em caminho URL codificado. Configuração gerada/argumentos de processos e a auditoria total de saídas ainda pendentes.
- Pacotes r10/r11/r12 foram interrompidos antes de verificação; não são releases utilizáveis e foram preservados. Causa: deploy fazia hardlink de esbuild em uso pelo ensaio TypeScript. Empacotador agora exige importação por cópia; tsx é ferramenta de desenvolvimento, não dependência operacional. r13 passou sem exigir pnpm/tsx/tsc ou instalação de módulos na estação do operador.
- Pacote intermediário r14 passou no verificador portátil e na versão anterior do ensaio HTTP/WebSocket (Temp/RPlayout-source-wire-G4V0yG), mas antecede a identidade HMAC estável e a proteção adicional de edição de saídas. Manifesto SHA-256 451036C944BA97916A64676D5F2BA9097C9D741BCED0028A51A55C5063D3E97D. Não é o pacote final do escopo.
- Rodada integral concorrente com compilação/testes Rust saturou a máquina e expirou o preset DPAPI em 5s e o preroll nativo; ambos passaram isoladamente, sem aumentar os prazos. Testes Windows agora usam até 4 workers (mínimo 1); rodada integral de 500 testes passou e cargo test completo passou. Esse limite organiza o ensaio, não afirma estabilidade sob carga física prolongada.
- Configuração privada usa as APIs ACL do .NET Framework já disponível no Windows PowerShell, sem instalar módulo adicional. A tentativa inicial com Set-Acl falhou na descoberta do módulo nesta estação; a implementação final conferiu permissões usando diretamente File.SetAccessControl/GetAccessControl. O conteúdo sensível não cruza os argumentos nem é enviado ao helper ACL.

## Fontes técnicas

- GStreamer DeckLink: https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-plugins-bad/sys/decklink/gstdecklink.cpp
- Open Media Transport: https://github.com/openmediatransport/libomt
- Blackmagic Videohub Ethernet Protocol: https://documents.blackmagicdesign.com/DeveloperManuals/VideohubEthernetProtocol.pdf?_v=1698822010000
- ACL de arquivo Windows: https://learn.microsoft.com/en-us/dotnet/api/system.io.file.setaccesscontrol?view=netframework-4.8.1
- Watcher MediaMTX (debounce de 1s): https://github.com/bluenviron/mediamtx/blob/main/internal/confwatcher/confwatcher.go

## Fechamento da etapa SEC-19 e QC em 03/10 às 21h32

Validação integral final: **146 arquivos / 1139 testes** passaram (21h29m37s,
118,07s). Tipos, build, cargo check e diff check passaram. Acrescentados testes
da posse durável, processo lento/unknown/remoto, falhas de journal/conclusão,
compensação/ACK perdido, revogação depois do ACK, escritor externo, atualização
do perfil de watchdog e reconciliação recusada com PGM/CUE ou prova antiga.
Esses testes não constituem fencing/HA entre hosts.

Servidor compilado SHA256
`BD86809D09E8DA4B71C77BC763BDC2250BE6F282CE351984E29BBAB78A11D5D9`;
web `index-uYZYdXSf.js` / `index-CZEXkAEj.css`. QA 4041 atualizada, PID próprio
30044, HTML/JS HTTP 200 contêm Ver em qualidade/Voltar ao preview leve e
reconciliação; ausência dos números fictícios de RTT/perda conferida no bundle.
Isto confirma entrega de código, não composição visual ou playback no navegador.
Canal 1 mantém 14 itens/revisão 25494162001883 e RW 13/revisão 1744;
ambos SIMULATED, PGM parado/CUE vazio, políticas automáticas DISABLED/version0,
configuração IDLE/revisão 168123508636337. Backup anterior ao restart preservado:
`rplayout-2026-10-04T00-27-15-595Z-361a4df9-faa0-4eb5-87d3-be278c80e02e.db`;
integridade/FKs/cofre verificados, 22 migrações, nenhum backup removido.

QC compilado em blRQs5, HTTP 49310/PID 29920: JPEG do original 3840×2160,
preview 320×180 e SHA original idêntico; QC PENDING sem decisão automática.
NE8vEu validou PGM/saídas/recuperação/automação nativos locais com arquivo real,
sem homologar destino físico. ZSfPyW validou dois servidores compilados com
SQLite compartilhado, concorrência/ABA/auditoria/restart/backup, não replicação.
Processos temporários encerrados; nenhum engine nativo remanescente após os
ensaios. Pacote r21 anterior não foi substituído nem anunciado como atualizado.

Objetivo geral permanece ativo: guardas dos controles restantes, banco separado,
HA/replicação/fencing entre hosts, pacote final atualizado e homologação
DeckLink/SDI/NDI/OMT, navegador e soak prolongado continuam pendentes.

## Continuação OPER-02 / SEC-20 — retorno de VT interrompido durável

Estado: implementação local e ensaio compilado aprovados; não homologa corte de
entrada ao vivo física nem o quadro exato no destino. Não encerra o escopo geral.

Corrigidos o reset indiscriminado RESUMING→PENDING na inicialização e a liberação
do cursor depois de qualquer falha de TAKE. Pedido, posse, decisão e estado do
retorno usam transação imediata/journal protegido. PREPARING sem despacho pode
terminar FAILED/PENDING; SWITCHING sem confirmação permanece UNCERTAIN, cercando
novas entradas, watchdog e recuperação após reinício. CONFIRMED/RESUMED são
gravados juntos. Limpeza de PVW posterior não desfaz confirmação durável.
Identificador repetido retorna o mesmo resultado sem reenviar comando.

Conferência original inclui ocorrência do PGM, edição/revisão operacional,
configuração, especificação e decisões atuais de mídia/QC. Autorização, canal,
runtime e conferência são reconferidos dentro da fila nativa, antes e depois do
preroll. O QC vigente é consultado diretamente, sem depender de refresh da
memória. Opaque proof usa o formato base64url do cofre (43 caracteres), não a
suposição incorreta de hexadecimal encontrada pelos testes de integração.

UI por canal preserva pendências/erros, distingue simulação de confirmação nativa
e não fabrica homologação física. UUID usa entropia do navegador inclusive em
HTTP LAN sem randomUUID. Reconhecimento por Supervisor/Administrador exige PGM
parado/CUE limpo, mesma posse original e prova conservadora de processos mortos
ou callback local concluído. Fecha CLOSED_UNCERTAIN, limpa checkpoint no mesmo
commit e não reabre o cursor. Consulta segue disponível na tela sem engine/grade.
Processo remoto/vivo/EPERM, pedido ativo e legado sem dono não são liberados.

Rodada final: **150 arquivos / 1172 testes**, início 22h10m36s, 120,98s. Tipos,
build servidor/web, cargo check e diff check passaram. Ensaio
`verify-interruption-return.mts` com servidor compilado/engine nativo passou em
`Temp/RPlayout-interrupted-return-Sparhh`, HTTP 50333: retorno no cursor 27,
as-run com esse cursor, duplicata sem TAKE, dono vivo não roubado, crash completo
com UNCERTAIN sem abrir engine, encerramento sem replay/cursor e novo restart
parado. Usa arquivo local/null output; incerteza é injetada duravelmente.
Não prova emissor live físico, saída física, navegador ou redundância entre hosts.
Processos próprios do ensaio encerrados; nenhum engine nativo remanescente.

Servidor SHA256 `935E759F5031DA17B8C32A1FED41A1D213F8168EA35369C23CB24E413CD59FD0`;
web `index-CuuOGjqN.js` / `index-BPf3vnmh.css`. QA 4041 atualizada, PID 19784,
preservando banco/cofre/grades e políticas. Backup verificado antes do restart:
`rplayout-2026-10-04T03-34-22-177Z-be498dc5-acaf-45ca-bd55-b5b8adb35307.db`,
integridade/FKs/cofre aprovados, 22 migrações, nenhum backup removido. A conferência
HTTP comprova entrega do bundle, não playback ou inspeção visual. Pacote r21
anterior não foi modificado; pacote final atualizado continua pendente.

## Continuação OPER-01 — inserção urgente na playlist operacional

Implementação local concluída com conferência/execução separadas na página do
Master. Escolhe vídeo ou entrada habilitada do próprio canal; nome da entrada
é congelado como título depois da seleção. Live recebe duração estimada e não
é anunciado com sinal por ter sido descoberto. Vídeo exige versão SHA, QC atual
do canal e duração/corte reproduzível. Um ativo que mudou de bytes não substitui
silenciosamente outros VTs já publicados. Cortes/áudio novos pertencem somente
ao novo item; gráficos/eventos e comandos de equipamento não são duplicados.

**PRÓXIMO** prepara e insere logo após o item corrente, preservando PGM e CUE
manual. Mantém Auto Next/loop/hold do item atual; não promete avanço automático
quando o operador desativou Auto Next. Sem PGM, insere no início. Simulação
permite esse planejamento, sem alegar confirmação nativa.

**AGORA** exige engine nativo. Uma mesma fila abrange conferência, preroll,
despacho e confirmação. Registro SWITCHING é durável antes do TAKE; ACK de live
não confirma revisão/PGM. Commit exige identidade nativa do novo item; erro de
fonte cancela TAKE pendente conservadoramente, e falta de confirmação permanece
inconclusiva. Interrupção do VT registra a última posição reportada e fica
disponível para decisão explícita de retorno.

Revisão, auditoria, pedido e fase de posse são gravados atomicamente. Timing
é recalculado no commit com relógio/ocorrência atuais; conferência mostra conflitos
e aviso de estimativa, não um cronograma prometido imutável. Rascunhos editoriais
e suas pendências não são publicados pela intervenção. Passagem já enfileirada,
contingência/slate, recuperação ou outra operação impedem inserção concorrente.
Autorização, ocorrência, revisão, configuração, fonte e QC são reconferidos antes
e depois da preparação. Sessão revogada ou fonte desabilitada não corta o PGM.

Se o PGM realmente cortou e a persistência falha, a visão mostra o item real,
sem atribuir confirmação à edição antiga. Resultado inconclusivo cerca novos
TAKEs/recuperação e não é repetido no crash/restart. Supervisor/Administrador
reconcilia a configuração com PGM parado/CUE limpo e prova de dono/processos
encerrados. A decisão original continua UNCERTAIN no histórico, sem transformar
reconciliação em sucesso retroativo. Consulta privada de pedido não carrega engine
nem envia comando; a página usa essa consulta após erro de comunicação.

Validação final: **151 arquivos / 1192 testes**, início 06h30m18s, 115,06s; tipos,
build servidor/web, cargo check e diff check aprovados. Os 17 testes de rota
cobrem concorrência, revogação, QC/fonte/bytes/ocorrência superados, rollback
atômico, identidade nativa, consulta sem runtime e reconciliação sem replay.
Os 3 testes adicionais de transporte cobrem NEXT sem TAKE/CUE alterado,
ACK live insuficiente seguido de quadro PGM e erro de fonte com cancelamento.

Ensaio compilado final `verify-interruption-return.mts` passou em
`Temp/RPlayout-interrupted-return-m88EYU`, HTTP 65005/cursor 28: arquivo Unicode
real, CUE manual preservado, NEXT/NOW sem publicar rascunho, mesmo PID, duplicatas
sem TAKE, retorno/as-run e crash integral sem replay. Falha de auditoria após
corte real também permaneceu cercada após restart; reconciliação parada e novo
restart não repetiram a inserção. Barramento preview real com publisher sob
demanda/idle; nenhum receptor MediaMTX foi iniciado. Não prova imagem no
navegador, recepção de rede, entrada live física ou saída física. O teste de
falha pós-corte é persistência injetada, não perda real de ACK na rede.

Servidor SHA256 `69557440C0E16D7A56AE22BE1A8163DC36882947D1C0BA8E74956258828E7240`;
web `index-DB7iYs_H.js` / `index-BPf3vnmh.css`. QA 4041 atualizada, PID 30612:
HTTP/bundle conferidos com painel de inserção, consulta sem replay e botão QC
Ver em qualidade. Grades preservadas: Canal 1, 14 itens/revisão 25494162001883;
RW, 13/revisão 1744. Ambos simulados, PGM parado/CUE vazio e configuração IDLE.
Conferência HTTP não equivale a inspeção visual/playback.

Backup antes do restart: `rplayout-2026-10-04T09-30-37-101Z-4e082e28-26a1-41dd-83b3-78ccd5f86844.db`;
integridade/FKs/cofre verificados, 22 migrações. Retenção automática conservou dez
backups e removeu `rplayout-2026-10-03T22-15-10-772Z-a3bef7f9-bd63-47e5-94b8-b3b77730791b.db`;
essa cópia removida não foi preservada separadamente. Processos nativos próprios
do ensaio encerrados; QA permanece simulada. Pacote r21 não foi sobrescrito.

Objetivo geral permanece ativo. Banco operacional separado, HA real entre hosts
com replicação/fencing/failover/as-run, pacote final atualizado, hardware,
navegador e soak prolongado continuam pendentes. Não anunciar toda a solução
como pronta nem confundir a cerca local desta operação com redundância broadcast.

## QC — reconferência do botão de qualidade em 04/10 às 14h40

O pedido de inspeção em qualidade foi reconferido na implementação existente:
`Ver em qualidade` abre o original da edição selecionada; `Voltar ao preview
leve` retorna ao proxy. Qualidade é opt-in por arquivo/hash/canal, não altera
PGM e não registra aprovação. Safe area permanece desativado por padrão.
Entradas ao vivo continuam no preview leve: este botão não certifica nem
habilita monitor de alta qualidade para live.

29 testes direcionados (quatro arquivos), typecheck, build servidor/web e
diff check passaram. Ensaio compilado com mídia 4K real:
`Temp/RPlayout-QC-quality-0Nr1jL`, HTTP 51330/PID próprio 17612, original
conferido por SHA256, JPEG 3840×2160 e preview 320×180; QC permaneceu PENDING
sem decisão automática. Processo do ensaio encerrado. Isto não constitui
validação visual nem playback no navegador, áudio original ou sinal físico.

QA 4041 estava sem processo/listener; foi restaurada com o mesmo banco/cofre
isolados, MediaMTX e engine nativo desativados, PID próprio 19768. HTML e
bundle HTTP 200, com os dois textos do botão. Build servidor SHA256
`1150D1F6DDC0DEC30DD0429CCBFFD2BA79AC4EB13F5E49F2C4A5DE2AE27752D6`, web
`index-hqQseIMx.js` / `index-BBx7O8R5.css`. Pacote portátil r21 não foi
substituído. A implementação geral e sua homologação continuam pendentes.

## HA-01/HA-02 — estado e mídia independentes, 04/10 às 15h

O espelho de estado conserva as edições publicadas, configuração, checkpoint,
as-run e journals operacionais. Não instala rascunhos, usuários ou chaves do
cofre no banco operacional do reserva. Cada nó usa seu banco/cofre próprio;
o pareamento tem chave separada e a sequência não é reiniciada em erro.
Perda de ACK reenvia o mesmo snapshot. Escolha de fonte SRT não equivale a
troca física de PGM e o painel não exibe heartbeat/diagrama HA fictícios.

A mídia usa um worker separado. A edição aceita pelo reserva define os hashes
autorizados, incluindo VT, áudio e imagem. A escolha da origem no primário
prefere arquivo arquivado, depois cache conferido, depois original — sempre
com verificação SHA do handle aberto. Blocos criptografados têm finalidade
própria; provas de STATE/MEDIA não se substituem, não valem como sessão/admin
e não autorizam TAKE. A transferência é retomada pelo offset remoto durável;
um arquivo completo somente é anunciado após SHA. Nenhum caminho do outro nó
determina o destino local. Arquivos estrangeiros, parciais reprovados e cópias
antigas são preservados; não há limpeza automática indiscriminada para caber
na quota. Publicação exclusiva exige suporte a hardlink no volume escolhido.

Validação integral: **157 arquivos / 1229 testes**, 129,22s. Tipos, build
servidor/web, cargo check e diff check passaram. Ensaio compilado
`Temp/RPlayout-ha-replication-NczT7O`, HTTP 51742/51743: reserva interrompido
depois de 262144 bytes, offset conservado após restart, mídia completa
`89cacfb92f643672635adff321162584a4e615e83ec968be05e4610446abcb60.media`
com SHA idêntico. O primário manteve o VT em engine NATIVE durante a parada do
reserva. Edição publicada (não rascunho), checkpoint e as-run nativos chegaram
ao espelho; restart de ambos conservou sequência e cofres distintos. Reserva
não abriu engine nem com binário configurado/canal local. Processos próprios
e listeners do ensaio encerrados. Não é prova de failover físico, RPO/RTO,
saída SDI/NDI/OMT ou promoção segura.

Build servidor SHA256
`A5BDFA65DDA3F8B06BA093E1C77DA31A83A20DF852DC00AA7352B524DDFC964F`, web
`index-Del2wNYI.js` / `index-BBx7O8R5.css`. QA 4041 permanece no processo
19768/banco/cofre isolados; essa instância ainda usa o backend anterior,
sem HA configurada. O web compilado no workspace foi atualizado. Pacote
portátil r21 permanece imutável e não contém estas alterações.

Próximas condições obrigatórias antes de assumir PGM: homologação da autoridade
entre máquinas e fencing externo de saída, promoção/restauração operacional com caminhos locais e
QC atuais, handoff de as-run, teste de partição/recuperação entre máquinas,
RPO/RTO medidos e destino físico validado. Separação do banco operacional do
processo servidor, pacote final, navegador e soak prolongado também continuam
pendentes. `failoverReady` e `automaticTake` continuam false deliberadamente;
isto é uma etapa da implementação, não redefinição do objetivo geral.

## QC — botão e build reconferidos em 04/10 às 15h36

O botão existente **Ver em qualidade**, acima do player de arquivos, foi
reconferido sem ativar download original por padrão. O retorno continua
**Voltar ao preview leve**. Hash/canal/arquivo vinculam a escolha; trocar a
seleção revoga a inspeção anterior. Aprovação e TAKE não são efeitos do botão.
Safe area permanece desligado. Live continua no preview leve.

Ensaio compilado `Temp/RPlayout-QC-quality-ShZmU7`, HTTP 52777/PID próprio
9392, passou: SHA256 do original idêntico, JPEG 3840×2160 e preview 320×180,
QC PENDING e zero decisões. Processo próprio encerrado. Não comprova playback
ou conferência de áudio no navegador. Tipos e build servidor/web passaram;
suíte integral: **158 arquivos / 1240 testes**, 121,43s. QA 4041/PID 19768
entrega `index-CtolGAPz.js`, com ambos os textos; isso é evidência HTTP/bundle,
não inspeção visual. Backend dessa instância não foi reiniciado. Pacote r21
continua anterior e preservado; pacote final e objetivo geral não estão prontos.

## HA-03 — testemunha independente e expiração nativa, 04/10 às 15h36

Nova testemunha compilada `apps/server/dist/ha-witness.cjs`, banco próprio,
chave distinta do pareamento e termos persistidos. Uma concessão por canal e
identidade de processo; renovação autenticada não aceita nonce antigo e ACK
duplicado não prolonga posse. Relógio monotônico governa validade. Reinício
sempre impõe quarentena de 6 segundos antes de conceder posse novamente.

O engine em modo protegido aguarda a primeira concessão antes de construir
pipelines. O prazo nativo começa na emissão do nonce, nunca no recebimento do
ACK: TTL 5 segundos com margem de 1 segundo. Watchdog independente do loop
de comandos/stdout encerra o processo com código 75; probes bloqueiam buffers
nos sinks após expiração. Chaves não vão para argv/env do engine. Backend
recusa Ready sem confirmação nativa; nova identidade impede usar ACK atrasado
para reativar o processo substituto. Sem testemunha configurada, não há esse
contrato: o espelho antigo continua sem promoção automática.

`Temp/RPlayout-ha-fencing-HbtQC3`, HTTP 52423: dois engines nativos e
testemunha compilada; segundo processo não publicou enquanto o primeiro
tinha posse. Suspender renovações e leitura do stdout do primeiro resultou
em exit 75; só depois o segundo iniciou VT com termo 2. Reinício da testemunha
respeitou quarentena/termo 3; concessão atrasada foi recusada. Não foi suspensão
do sistema operacional completo, nem prova de eliminação de pacotes em voo.

`Temp/RPlayout-ha-replication-Nsc9kM`, HTTP 52532/52533/52534, passou com
dois backends compilados, engine real e testemunha compilada: concessão nativa
integrada, VT, publicação/checkpoint/as-run, sequência após crash, cofres/bancos
independentes e retomada da mídia interrompida aos 262144 bytes. SHA recebido
`11ced1ec2b4247ea6627454e3153a3290e77914fd424ae22379a2bbbde9442f5`.
Reserva permaneceu sem engine. Processos próprios dos ensaios encerrados.

Sete testes de testemunha e três novos de transporte passaram; quatro testes
Rust de fencing passaram e o engine release foi recompilado. Suíte integral
inclui 158 arquivos/1240 testes. UI distingue concessão de confirmação de
saída e não libera takeover. Ainda faltam promoção operacional, importação
com mídia/QC locais, handoff, rejoin/failback, fencing externo, partição entre
hosts, saída física, RPO/RTO, soak e pacote final. Isto não completa HA-01.

Build atual: servidor SHA256
`82DEF2A2F6E5BF3F01FBE3767104C5744933619CBE41E43FF088C5D83672491A`,
testemunha `1385B809B34E7C0514739F3C456C7FCAF0A1DDDA0F8CDDE7BDEBC118B8974059`,
engine `060A8F2834A0E27953125912416C6E0BC16D57F8823D63C324DE1E7041A4E993`.
O pacote portátil ainda precisa incorporar/verificar a testemunha e os builds
atuais; não tratar o r21 como contendo estas alterações.

## Distribuição portátil e partida fria — 04/10 às 15h59

Os scripts agora exigem/copiam `ha-witness.cjs`, inicializador próprio e
verificador JavaScript sem TypeScript. A checagem roda com Node do pacote,
SQLite de produção e PATH exclusivamente portátil/Windows: posse exclusiva,
expiração 75, reinício/quarentena e termo seguinte. Testemunha não usa o banco
operacional: bancos de outro serviço são recusados antes de criar tabelas ou
alterar journal (oitavo teste de domínio). Inicializador exige pasta de dados
fora da distribuição, não substitui chave e não inicia PGM. Corrigido também
o helper do servidor: os executáveis são procurados na raiz do pacote, não
num diretório pai que poderia conter outro release.

Pacote candidato r22 gerado em `release/RPlayout-1.1-broadcast-20261004-r22`,
6607 arquivos no manifesto SHA256
`8D7D0AB16875D2E098EB6841CFADD3A5BD54D7209FF0E65B72E7FDCB63C593C2`.
Dependências, assinaturas MSVC, módulo carregado do pacote, SQLite e testemunha
passaram (`Temp/RPlayout-package-witness-qK9wvI`, HTTP 53033). **Não aprovado
como pacote final:** ensaio de recuperação `Temp/RPlayout-server-recovery-0AoDoc`
terminou sem inicialização dentro de 20 segundos. Diagnóstico adicional no
mesmo banco isolado, backend próprio PID 11520/HTTP 53113, mostrou engine ainda
starting, registro GStreamer recém-criado e watchdog encerrando a primeira
partida após 20 segundos. O processo substituto ficou Ready. Esse backend de
diagnóstico foi encerrado; não se alterou QA 4041 nem banco do operador.

Correção: partida antes de Ready nativo tem limite de 90 segundos, distinto
do primeiro quadro (20 segundos após Ready) e do travamento em regime (3).
Ordens confirmadas aguardam Ready antes de iniciar timeout de decoder/ACK.
Queda/fechamento recusa a espera, sem reenviar ao próximo processo; readiness
agora também exige processo vivo e transporte não encerrado. A cerca HA
nativa permanece independente e curta; nenhum prazo de posse foi ampliado.
Cinco testes novos de transporte/watchdog e o teste de banco estrangeiro
passaram. Suíte integral: **158 arquivos / 1246 testes**, 133,29s; tipos e build
passaram. Ensaio compilado `Temp/RPlayout-server-recovery-37yHBw`, HTTP 53297,
passou com zero stalls/restarts na primeira partida: VT real, crash/retomada
de cursor e as-run, STOP, snapshot WebSocket e ciclo de dois arquivos da
contingência, crash do loop e retorno ao VT original. Saída null, não hardware.

r21 foi preservado com manifesto SHA256
`367CD7FF131F4251CE3990F8D91D0E7A0BA5BD9B4738380E4B8006732ED64A52`.
r22 permanece preservado para reproduzir o defeito de startup; não foi
remendado nem substituído. Próxima distribuição precisa conter a correção e
repetir o ensaio com Node/engine/plugins próprios. Objetivo geral continua
ativo: promoção/HA física, banco operacional separado, browser e soak pendentes.

## Candidato r23 e QA atualizado — 04/10 às 16h08

`release/RPlayout-1.1-broadcast-20261004-r23` foi gerado sem substituir r21/r22.
Manifesto SHA256
`EAFD52DCBC09141563B12C830B0F753FD72F0168A295A68707D68710F3BE6304`,
6607 arquivos. Servidor SHA256
`2CB19DD15F6112F64F90170D499848D306383E58D0145A001C86612EE7A3B14F`,
testemunha `245DADCAF8AFAB0B65621AA337570FD7C5D410D9CE4D5B02BF93F369CE083EEA`,
engine `060A8F2834A0E27953125912416C6E0BC16D57F8823D63C324DE1E7041A4E993`.
Build, materialização sem symlink/hardlink para o workspace, manifesto,
assinaturas e carregamento MSVC app-local, Node/SQLite e plugins portáteis
passaram. `Temp/RPlayout-package-witness-W14tJI`, HTTP 53524: Node/testemunha e
engines do pacote, dono exclusivo, exit 75 e restart/quarentena até termo 3.

`Temp/RPlayout-server-recovery-R4pWad`, HTTP 53537: servidor e engine do r23
com PATH portátil/Windows e registro próprio inicialmente novo. Ready em
13931ms, zero stalls/restarts na primeira partida. VT confirmado; queda do
backend/engine seguida de retomada a partir de 50 quadros com revisão/execução
preservadas, evento secundário não repetido, as-run RESTART/STOP e snapshot
WebSocket. Reserva local de dois arquivos fez ciclo completo, sobreviveu a
crash do servidor/engine e retornou ao VT original a partir de 33 quadros.
Null não é prova de SDI/NDI/OMT, preview físico ou failover entre hosts.
Processos e listeners próprios dos dois ensaios foram encerrados.

QA 4041 atualizado de PID 19768 para PID próprio 15164 (wrapper/session 46433),
mesmo banco/cofre/pastas. Revalidados os dois canais SIMULATED, PGM parado/CUE
limpo, antes do restart. Backup pela API SQLite, integrity/foreign keys ok,
em `preserved-backups/pre-r23-a424b80e-c1fc-4b87-a5cb-f6518069778b.db`, sem
retenção ou remoção de cópias anteriores. Depois do restart: 14 itens/revisão
25494162001883 e 13 itens/revisão 1744 intactos, transportes SIMULATED parados,
PGM/CUE nulos. HTML e `index-IdfFiPoM.js` HTTP 200 contêm os dois textos de
qualidade do QC. Isto não é inspeção visual/playback. Engine, MediaMTX,
hardware e HA permanecem deliberadamente desativados nessa instância.
O contador legado `/api/health.engines` inclui transportes simulados; não
interpretar esse número como quantidade de processos nativos ou placas.
Separar essa métrica é uma correção de observabilidade ainda pendente.

r23 é candidato validado para o estágio atual, **não entrega completa do
objetivo**. Promoção/restauração do espelho, handoff/rejoin/failback, fencing
externo, falhas entre máquinas, banco operacional separado, browser/áudio e
saídas físicas e soak prolongado continuam pendentes. Documentos embalados
precedem esta validação; os arquivos do pacote não foram remendados depois
do manifesto. Resultado e matriz atualizados apenas no workspace.

## HA-04 / OBS-03 — restauração isolada e saúde sem simulação, 04/10 às 16h37

`/api/health.engines` conta agora apenas EngineTransport nativo pronto.
`nativeEngines` informa os transportes nativos criados (não sinal físico), e
`simulatedChannels` separa a simulação. A pendência do contador apontada na
seção anterior foi corrigida no workspace/QA, não por remendo do pacote r23.

O espelho leva decisões de QC do canal **e @all**, ordenadas por rowid como
o resolvedor efetivo. Aprovação/revogação no mesmo timestamp não é reordenada
por UUID. Banco HA indicado sobre DB de outro serviço é recusado antes de
mudar journal/criar tabelas. A testemunha também não confunde prefixo alheio
`sqlitex_` com tabelas internas SQLite; casos de preservação testados.

GET/POST `/api/ha/rehearsal` exigem autorização administrativa normal e
acesso ao canal. Prova de pareamento não substitui sessão. POST aceita apenas
UUID, canal e sequência atual; não aceita TAKE/caminho de destino. Reserva
persistente gera banco novo em pasta exclusiva sob `rehearsals`, sem afetar
seu banco operacional nem o primário. SHA é revalidado em leitura, cursor e
referências são conferidos, publicações mantêm JSON/IDs originais. Decisões
QC explícitas são conservadas, mas aprovação legada sem decisão por versão
não libera a mídia. Nenhum arquivo remoto é usado como caminho local.

O banco do ensaio tem canal arquivado/cursor parado, sem saídas, contas,
inputs cadastradas ou jobs externos executáveis. Proveniência original fica
cifrada com o cofre local do reserva; não requer copiar o cofre primário.
`ha_recovery_origin` impede criação de runtime mesmo após desarquivamento.
`RESTORED` significa apenas banco isolado reconstruído, nunca PROMOTED:
`promotionReady=false`, `automaticTake=false`, `localProbeRequired=true`.
Repetição de UUID consulta o ledger; outro canal/seq com mesmo UUID recusa.
Um CHECKING deixado por crash não é reexecutado nem liberado implicitamente;
reconciliação controlada desse estado permanece por implementar.

53 testes direcionados passaram; suíte integral passou com 159 arquivos/
1264 testes. Depois foi acrescentada a guarda de runtime do banco de ensaio,
com revalidação dos 11 testes de restauração. Typecheck do workspace e build
servidor passaram. Ruflo/ToolSearch continuam ausentes dos tools expostos;
nenhum substituto ou pacote foi instalado.

Ensaio compilado inicial `Temp/RPlayout-ha-replication-Tya3aM` restaurou o
banco, mas falhou na reabertura posterior do main.db temporário com
SQLITE_IOERR_TRUNCATE. **Não conta como PASS completo.** Ambos os bancos
main/mirror passaram em integrity/FK por leitura após falha; arquivos
preservados. O verificador agora aguarda evento close do próprio processo
antes de reabrir seu banco. Isso não prova definitivamente a causa do I/O.

Nova rodada `Temp/RPlayout-ha-replication-rWYWHU`, portas 54320/54321/54322,
PASS: dois servidores compilados/bancos/cofres distintos e testemunha
independente; VT nativo no primário com concessão, parcial interrompido aos
262144 bytes e retomado. SHA 8f6b55e6c1248a2bd67b23ceacf2a95d30bdd8a1e6b663f78bff0d9ba3b37d87
confirmado. Ensaio pedido 60a8cc3e-8ea9-439d-be62-f66c7f0bb340 restaurou
seq 9/uma publicação/um arquivo/checkpoint, com QC PENDING (legado sem
decisão). DB integrity/FK ok, cursor parado, sem contas/saídas/as-run local;
payload decifrado com cofre do reserva conservou PUBLICADO, não RASCUNHO.
Reinício conservou relatório e repetição não criou outro banco. Primário
continuou sequência após restart. Processos/listeners próprios encerrados.
Saída null local: não prova host remoto, saída física, promoção ou failback.

QA 4041: backup preservado `pre-ha-rehearsal-fa0fd520-e34c-4a83-b030-9b8a5d4718be.db`
por API SQLite com integrity/FK ok, sem retenção/deleção. PID próprio 15164
substituído por 11388 (session 49287) somente após revalidar simulação/STOP/
CUE vazio. Mesmos banco/cofre/pastas; 14 itens/revisão 25494162001883 e
13 itens/revisão 1744 intactos. Health agora engines=0/nativeEngines=0/
simulatedChannels=2. Engine/hardware/MediaMTX/HA desativados nessa instância.
Servidor compilado SHA E8ADF58A0C3D4B2F4937983B106399A9DA7FCDC3312C80B1C89C62AD5F8ACF35.
Web/QC do r23 permanece, sem alegar inspeção visual nova ou áudio no browser.

O objetivo segue ativo. Não foram entregues promoção/handoff/rejoin/failback,
fencing externo, banco operacional separado, browser/saídas físicas ou soak.
r23 é pacote candidato anterior a HA-04/OBS-03; pacote final continua pendente.

Revalidação final 04/10 às 16h41: suíte integral **159 arquivos/1264 testes**
PASS após a guarda `ha_recovery_origin` (122,15s). Segundo ensaio compilado
consecutivo PASS em `Temp/RPlayout-ha-replication-6WFoHJ`, portas
54556/54557/54558, parcial 262144 bytes e SHA
9c54db8aa1bf3cf8270449389689cfae3fdb274c1a2d728f4d4030a9a7d3ad83.
Pedido a1e5847d-4cce-409a-a179-9dcba95f15e4 restaurou seq 9 em
`reserve/rehearsals/recovery-GInyIg/operational.db`, mesma proteção/QC
PENDING/cursor parado; reinício e repetição só consultaram o resultado.
Fencing nativo da testemunha habilitado no primário; sem takeover/host físico.
Processos/listeners temporários encerrados pelo verificador.
HTTP do QA e bundle `index-IdfFiPoM.js` responderam 200 e conservaram
“Ver em qualidade” / “Voltar ao preview leve”. Isso não é inspeção visual
nem comprovação de playback/áudio no browser. Diff check passou.

## HA-04 — reconciliação de crash e integridade de referências, 04/10 às 17h05

Continuação anterior classificada como progresso: restore isolado real,
health corrigido, testes e dois ensaios compilados. O objetivo amplo segue
ativo; esta etapa não substitui promoção, failover, banco separado ou físico.

Ledger HA agora registra criador `{host,pid,boot}`. Upgrade acrescenta coluna
sem remover relatórios/workspaces; CHECKING anterior fica com dono desconhecido,
não com PID inventado. Atualizações do builder exigem sua posse original.
POST `/api/ha/rehearsal/reconcile`, com UUID/canal/seq original, só transforma
CHECKING em REFUSED/reconciliado após ESRCH de processo local. Não usa relógio
ou timeout como prova de término, não mata criador, não modifica parcial e
não executa TAKE. Processo atual/vivo, PID reutilizado, outro host, EPERM ou
dono ausente/corrompido recusam liberação. Resultado cifra ator/horário;
duplicata consulta o mesmo resultado. Novo ensaio exige UUID novo.

Fronteira HTTP mantém login normal/ADMIN/canal/estação/origem: prova HA não
vira autorização administrativa; OPERATOR, SUPERVISOR e ADMIN fora do canal
recusados. Requisições válidas têm canal associado à auditoria HTTP. Comparar
intenção considera valores validados, não ordem das propriedades JSON.

Checkpoint recebido é validado com o mesmo parser de leitura/escrita local,
antes de parar o cursor de ensaio; não mascara PGM sem grade/item mudando
playing para false. Contingência exige loop/grade presentes. Itens devem ter
metadados para referências de mídia/fallback; duplicatas e SHA inválido em
edição ativa/executada/futura são recusados antes de gerar workspace. Revisão
histórica não exigida mantém metadados legados sem tentar tocá-los/copiá-los.
Política QC e zonas congeladas permanecem no banco isolado; vínculos físicos
estrangeiros continuam removidos e sonda local continua obrigatória.

38 testes dirigidos (24 recuperação, 4 checkpoints, 10 HTTP) PASS. Suíte
integral **159 arquivos/1281 testes**, 124,81s; typecheck do workspace/build
servidor/diff check PASS. Ruflo/ToolSearch continuam sem tools expostos;
não foi instalado/inventado substituto. Nenhum agente delegado.

Ensaio compilado `Temp/RPlayout-ha-replication-ilf9nA`, portas
54943/54944/54945, PASS. Mantém testemunha independente, VT nativo no
primário, mídia retomada após 262144 bytes, bancos/cofres/seq próprios e
reserva sem engine. Restore seq 9 preservou PUBLICADO/cursor parado; não
copiou rascunho nem aprovou automaticamente legado. Criador independente
real PID 17552, executando domínio HaRecovery, pausou após CHECKING; API do
servidor compilado recusou reconciliar enquanto vivo. Após SIGKILL desse
filho próprio, pedido 792144fa-7e5b-4c37-a298-1b72aa2c9045 foi reconciliado,
duplicatas não repetiram trabalho e novo UUID fez novo restore. SHA do
workspace completo anterior não mudou. Reinício manteve relatório/resultado.
O helper é fixture de teste, não runtime de operação nem engine de PGM.

Repetição após limitar helper à sua pasta temporária e inspecionar identidade
em leitura antes de pragmas: `Temp/RPlayout-ha-replication-x0UCry`, portas
55175/55176/55177, PASS. Pedido interrompido
be1f306c-806e-4ea8-bcfb-09f75899a89b/criador 18116 reconciliado; restore seq 9
1f4b6bb9-3859-4fd2-a337-c2ec59cd2de4 em recovery-2aqS5t. SHA de mídia
ce857de6a3a1c1cb12585f324ae0f9b0ea2f78c788303a52332607a145874964,
mesma prova de mídia/workspace/replay/restart/ausência de engine no reserva.
Processos/listeners próprios dos dois ensaios encerrados. Null local e
criador de domínio: não comprova troca de PGM entre hosts, routing externo,
falha física, áudio/imagem externos ou disponibilidade contínua.

QA 4041: preservado backup `pre-ha-reconcile-c0be7d79-46a8-404f-bfcb-8b0620453a8e.db`
por API SQLite/integrity/FK, sem retenção/deleção. Revalidados SIMULATED,
PGM parado/CUE vazio, antes de trocar PID próprio 11388 por 10844
(session 63828). Banco/cofre/pastas iguais, 14 itens/revisão 25494162001883
e 13 itens/revisão 1744 intactos. Health engines/nativeEngines=0,
simulatedChannels=2. Backend SHA
3332B6C1777808E1F222CF881D0E96D262C689E037039C84E97DEABBB9640000.
Engine/MediaMTX/hardware/HA desativados deliberadamente nessa instância;
não inferir placa ou recuperação nativa pela simulação. Web/QC não mudou.
r23 não foi alterado e antecede estas implementações; pacote final pendente.

Próximos requisitos ainda obrigatórios: validar mídia/codec/QC no reserva,
vincular hardware/saídas locais com revisão, restaurar execução efetiva sob
concessão nativa, handoff/retorno/replicação reversa, fencing externo e
homologação entre hosts. API de ensaio/reconciliação não possui botão na UI
nem autorização de promoção nesta etapa. Demais pendências amplas da matriz
permanecem; não concluir o objetivo com estes testes.

## HA-05 — sonda local real e QC da cópia, 04/10 às 17h35

A análise local citada como pendência em HA-04 passou a integrar o ensaio
quando RPLAYOUT_PROBE está configurado no reserva persistente. Repetir UUID
continua apenas consultando o relatório. Sem sonda, não se inventa análise.
O arquivo usado é exclusivamente a cópia READY do receptor por SHA; caminhos
do primário nunca são abertos pela sonda. Mídia e executável são conferidos
antes/depois por identidade/tamanho/mtime/ctime e SHA; mudanças de sequência,
shutdown ou alteração/restauração dos mesmos bytes recusam o trabalho.

A sonda Rust agora conta buffers raw não vazios na primeira trilha de vídeo
e áudio decodificadas, incluindo BUFFER_LIST. Não basta receber ok/caps. Os
campos são adicionais e não mudam o contrato de ingestão existente. A sonda
local roda serialmente/priority LOW, sem shell, sem thumbnail, sem credenciais
RPlayout do servidor e com limite de resposta de 1 MiB/15 minutos por arquivo.
Falha, saída inválida, timeout ou cancelamento não retornam stderr/caminhos
privados para a API; a conclusão aguarda close do filho próprio.

O perfil técnico é avaliado com codec, geometria, razão de FPS, varredura,
áudio, duração e loudness locais. Não reaproveita probe/R128 do primário para
passar a análise, nem preenche loudness/pico ausentes com números fictícios.
localValidation informa runtimeHash, required, decoded, technicalBlocked e
PASSED/FAILED. localProbeRequired=false quer dizer que todos os arquivos
comprovaram decodificação; pode coexistir com FAILED por conflito técnico.
qcBlocked é a união por edição/hash de bloqueio técnico e falta de decisão
QC explícita. Decodificar não aprova: APPROVED legado permanece PENDING.

Banco isolado conserva publicações exatas, contas/saídas/comandos ausentes,
canal arquivado e cursor parado. Metadados locais ficam em media_assets e
evidência completa cifrada por SHA em ha_recovery_media; payload publicado
não é reescrito. O marcador continua impedindo runtime após desarquivar.
Preservar o cofre é necessário para ler os resultados. A descoberta de
outras trilhas não prova decodificação ou loudness individual delas; mixes,
trims e níveis operacionais continuam separados desta análise de arquivo.

Testes dirigidos iniciais: 54 PASS. Após proteção contra alteração com SHA
restaurado, suíte integral **160 arquivos/1303 testes**, 161,07s, PASS;
typecheck workspace, build servidor, diff check e cargo test da sonda
(11 testes) PASS. Uma primeira execução do teste de link de arquivo recebeu
EPERM no Windows; passou depois de usar junction de diretório controlado
para testar recusa de destino vinculado, sem requerer elevação. Esse erro
não foi contado como teste aprovado. Ruflo/ToolSearch indisponíveis ([]),
sem substituição/instalação nem delegação.

Ensaio inicial antes da proteção de timestamps: lScHQL, portas
55672/55673/55674, PASS, estéreo e R128. Não atribuir a esse primeiro ensaio
a proteção acrescentada depois. Build atual:
server.cjs SHA **6C56B13BEA8D2CECFAD7955396C2E5451285F50FF7731324BADB4628496A7E1B**;
probe.exe SHA **FAF1099CF73C802603190BF687244F917767B619BB8DBFEC38E3AC999DB61DF0**.
Dois novos ensaios integrados dessa build passaram:

- llCguk, portas 55886/55887/55888: servidores compilados e testemunha
  independentes, PGM nativo/null no primário, retomada aos 262144 bytes,
  mídia SHA ede3ed5ab2bbb94018d46f77328a234c43d3c6e1a6f75b3c46f3ef693ccbfb8f.
  Ensaio seq 10/4a87efb2-1476-4dc4-a974-fc7a7ca0e946, recovery-c3PqdP:
  H.264 320x180 progressivo/25:1, 1800 buffers de vídeo e 3376 de áudio,
  estéreo/48000 Hz, R128 -26,7135 LUFS e -25,0996 dBTP. Perfil de teste
  explícito aceita -40 a -15 LUFS; não é aprovação broadcast automática.
  PASSED técnico, decoded=1, technicalBlocked=0, qcBlocked=1/PENDING.
- oSRON4, portas 55889/55890/55891: VT sem áudio, política de canal alterada
  apenas na fixture própria após publicação e chegada ao espelho confirmada.
  SHA 9b2c82bacae9a6fc423b7014469fa64fdb0535649a7dba9bdfacbf59c108fe81.
  Seq 11/698ce829-2101-4bed-8b96-ba66669ea515, recovery-VHLPTk:
  decoded=1/localProbeRequired=false, mas FAILED técnico/technicalBlocked=1
  por áudio obrigatório ausente. Nenhuma aprovação ou PGM no reserva.

Ambos preservaram publicação PUBLICADO (não rascunho), cursor parado,
cofres/bancos/seq próprios, replay somente consulta, reconciliação de criador
de domínio vivo/morto e restart. Criadores próprios 3456/10212 foram
encerrados/reconciliados; todos os processos/listeners de fixture terminaram.
Não é promoção efetiva, perda de host físico, saída externa ou teste visual.

QA 4041: backup preservado por SQLite API/integrity/FK,
pre-ha-local-probe-86279ab0-7e63-4bfe-9470-8eeb6c31acd6.db. Revalidados
SIMULATED/STOP/CUE vazio antes de substituir PID próprio 10844 por 19552
(session 95419). Mesmo banco/cofre/pastas e 14 itens/revisão 25494162001883,
13 itens/revisão 1744. Health engines/nativeEngines=0, simulatedChannels=2;
engine/MediaMTX/dispositivos/HA desativados. Web não mudou: QC já contém
Ver em qualidade/Voltar ao preview leve, apenas para arquivo; não atribuir
HQ de live nem validação de navegador a HTTP/compilação. r23 foi preservado
sem alteração; antecede essas funcionalidades e não é pacote final.

Próximas etapas obrigatórias: prova de trims/mixes/fontes live no reserva,
vínculos revisados de hardware/saídas locais, recuperação executável sob
concessão nativa, handoff/replicação reversa/rejoin/failback e fencing externo.
Separação do banco operacional, todos os formatos, soak, pacote final e
homologação física/visual continuam na matriz; objetivo amplo permanece ativo.

## UI-04 — inspeção de live antes do preview reduzido, 04/10 às 19h32

O pedido Ver em qualidade agora inclui fontes live. O pipeline de PVW abre
um tee depois do deinterlace, antes do crop/escala/cadência do monitor. O
ramo de inspeção conserva o raster real; fila leaky de dois buffers, valve
fechado por padrão e sink sem espera impedem que encoder/rede bloqueiem o
decoder. Não há outra abertura de DeckLink/NDI/OMT nem LOAD/TAKE por qualidade.
Áudio da inspeção usa o mesmo barramento de áudio selecionado do PVW.

O consumidor QC é independente/on-demand, H.264/Opus, progressivo. Ao ativar,
caps negociadas determinam geometria/PAR/cadência, até 4K/60 e 6–50 Mbps.
Não deriva resolução da grade: fonte 720p em canal 360p mantém 720p no QC.
É representação codificada de inspeção, não original sem perdas, monitor de
referência, certificação de cor ou loudness. Fonte acima dos limites é reduzida
com aviso explícito; fonte menor não é ampliada por causa do canal. Formato
desconhecido e ausência de quadro recente recusam ativação. Encoder aguarda
buffer real no ramo raw antes de publicar e expira com deadline monotônico
nativo após 15s sem renovação, mesmo sem timeout do backend.

POST /api/channels/:id/qc/inspection recebe somente viewerId UUID, sourceRef
e watching. URI cifrada é resolvida na fronteira privada. Autoridade normal
de sessão/canal/estação/origem continua necessária e é revalidada dentro
das filas de QC e engine. Leases são por sessão/viewer/fonte, limitadas a 16,
sem segredos no registro HTTP. Uma janela não revoga a outra. CUE de outra
fonte fecha o ramo antigo e não herda qualidade; requisição atrasada é recusada.
Heartbeat a cada 5s, off na saída e deadline nativo limitam recurso órfão.
ACK é ativação aceita, não confirmação de playback WHEP no navegador.

UI mantém preview leve por padrão, botão de retorno/tela cheia e escuta
explícita. SOURCE e PVW_READY da seleção são necessários: PGM pronto não
autoriza mostrar outra entrada como QC. Cada ativação tem identidade nova;
resposta anterior não monta player da nova ativação. Scopes/áudio são limpos
quando seleção/rendição/player/prontidão mudam. Falha não exibe proxy como
qualidade. Safe area permanece desligada por padrão.

Suíte integral: 163 arquivos/1332 testes PASS, 57,07s às 19h27m55; tipos,
build servidor/web e diff check PASS. Engine: 72 testes PASS, um loopback
OMT ignorado (não contabilizado como prova OMT nesta rodada), 67,78s.
Novo teste nativo mostrou deadline fechando valve/publicador sem callback
do servidor; três testes de caps cobrem raster/fração FPS/limites/recusa.

Ensaio compilado inicial icRNcE, HTTP 63871: PGM nativo/null, entrada local
RTSP via MediaMTX, H.264 + áudio do emissor; inspeção decodificada H.264/Opus
1280×720 contra preview 428×240. Antes de aceitar prova foram corrigidos:
captura do IDR preto inicial; latência do mux da fixture, que às vezes só
declarava áudio; padrão de 1 pixel eliminado pelo 4:2:0; e métrica de contraste
global, que aceitava aliasing. Fixture final usa xadrez de 2 pixels/I420,
decodifica 50 quadros e mede bordas horizontais, não só tamanho do JPEG.
Essas tentativas iniciais falharam e não foram contadas como PASS.

Após seguir caps da fonte: YDoso1, HTTP 64249, PASS. Canal 640×360, input/HQ
1280×720, preview 428×240. Detalhe horizontal 59,5020 contra 40,3503 no raster
menor (ampliar o menor não recupera bordas); áudio Opus real decodificado,
RMS 0,02366. PGM live permaneceu ativo; duas conexões de input (PGM/PVW)
antes/depois do HQ, sem terceira. Fechar um viewer preservou o outro, fonte
errada recusada, última janela encerrou encoder e ausência de heartbeat
expirou. Processo/folders/bancos do ensaio isolados; filhos/listeners próprios
encerrados. Não foi reprodução de navegador, hardware físico ou teste 4K live.

Backend SHA 8EA8F56C3DEF30BC04BCF28A026EE6A4A9F7B1D4F85B5C39DF7713AE2E1D1EAB;
engine SHA 5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009.
Web final index-B6zPtRcP.js/index-BBx7O8R5.css; aviso de chunk grande continua.
QA foi recuperado em 18h44, PID 14372, com backend anterior. Mesmo banco,
cofre e pastas; canais SIMULATED, STOP/CUE vazio; 14 itens/revisão
25494162001883 e 13/revisão 1744. Backup direto por API SQLite
pre-qc-live-quality-2e414306-839e-4ecc-afbe-73aae2b26926.db passou integrity/FK,
sem retenção/deleção. A tentativa de substituir esse processo pelo backend
novo foi bloqueada pela política do ambiente antes da execução; PID 14372
continua respondendo, não se contornou o bloqueio. Não atribuir endpoint QC
novo ao QA antigo. Ruflo/ToolSearch não expostos ([]); sem delegação.

Objetivo integral permanece ativo. Pendentes nesta área: WHEP/escuta visual
no navegador, calibração de cor/scopes, emissor 4K/live e hardware externo;
demais requisitos incluem promoção efetiva HA/failback/hosts, banco separado,
guardas remanescentes, soak e pacote portátil final. r23 permanece imutável
e anterior às alterações. UI-03 registra qualidade de arquivos; UI-04 é a
evolução live, não reinterpretação dos ensaios anteriores como live homologado.

## SEC-20 — decisão QC e perfil conferidos, 04/10 às 20h03

O turno anterior consultou status sem alterar estado (no progress); a
continuação revalidou worktree/QA e implementou a próxima guarda disponível.
Ruflo/ToolSearch não expostos ([]); sem instalação alternativa ou delegação.

Antes, POST de QC conferia apenas hash e metadados atuais: duas avaliações
do mesmo arquivo podiam sobrescrever o estado uma da outra. A auditoria
detalhada era inserida depois do commit. PUT de perfil também não exigia
a revisão que o supervisor abriu, e gravava sua auditoria separadamente.
PATCH de ignored/status global permitia neutralizar uma avaliação nova sem
prova da conferência original. Essas rotas agora possuem precondições.

Migração 23 cria qc_review_versions com CHECK de inteiro seguro e seis
triggers (mídia/decisão × insert/update/delete). Todo UPDATE de mídia,
inclusive ingestão/loudness, invalida a conferência conservadoramente.
Decisões de outros canais também invalidam a revisão daquele arquivo;
esta é uma recusa conservadora, não mudança do estado QC desses canais.
Tombstones sem FK sobrevivem à remoção/reinserção/ABA. Migração de 22
preserva registros existentes com baseline novo, sem contagem histórica
inventada; reabertura não repete a migração. Startup e restore recusam
tabela/trigger/counter ausente, alterado ou inválido, sem autorreparo.

GET /api/assets/:id/qc retorna snapshot privado/no-store com hash, checks,
perfil, decisões aplicáveis do canal e globais por ordem de inserção, e
review com revisões monotônicas de arquivo e configuração. ETag de decisão
vincula arquivo/canal; global usa ETag do arquivo. Lista do acervo entrega
qcRevision junto com mídia/estado no mesmo snapshot. GET qc-profile fornece
revisão e ETag do canal. PATCH global, POST QC e PUT perfil conferem provas
originais no commit imediato: 428 sem header, 400 malformado/outro alvo,
409 superado, inclusive hash/perfil restaurados aos mesmos valores.
Hash do corpo continua obrigatório e não substitui a revisão.

Sessão, identidade, papel, canal/estação e arquivo do canal são reconferidos
no commit. Uma conta restrita pode decidir no seu canal, mas não alterar
quarentena compartilhada. Perfil exige OUTPUT_CONTROL. QC não chama
reconfiguração do engine, CUE ou TAKE. Mídia/decisão/perfil e auditoria
detalhada são atômicos; counter editorial também reverte em falha SQL.
Falha posterior na atualização da visão retorna commit realizado com aviso,
não rollback fictício. API_MUTATION continua auditoria HTTP complementar.

UI usa prova da conferência, não leitura automática antes de autorizar
um rascunho. Perfil captura baseline próprio ao abrir seu editor; uma
consulta/decisão posterior não troca esse baseline silenciosamente. Ressalva
e perfil editados são preservados na recusa, bloqueando repetição até
Reabrir conferência (confirma descarte). Trocar arquivo/canal invalida a
prova; resposta anterior não aplica feedback à seleção nova. Ações por
linha primeiro selecionam para conferir, não aprovam arquivo não conferido.
Aprovar/Rejeitar padrão ficam indisponíveis enquanto há ressalva/perfil em
edição ou outra ação pendente. Quarentena global é identificada como tal.
Falha de rejeição deixou de ser sobrescrita pelo falso aviso de sucesso.
Compilação/SSR não provam interação de navegador; isso permanece pendente.

41 testes novos: seis de DB (ABA, writers, rollback/overflow, migração,
restart, backup/adulteração), 22 de HTTP (oito formatos de revisão, snapshot,
concorrência, perfil, global, três rollbacks, refresh e quatro revogações de
acesso), 13 de cliente/revisão. Primeira suíte integral encontrou só a
expectativa legada de 22 migrações no teste de checkpoint; atualizada para
23 e repetida. A primeira prova de cache privado do QC falhou por header
ausente; as consultas de conferência/perfil passaram a defini-lo explicitamente.
Tentativas com falha não foram contabilizadas como PASS.

scripts/verify-qc-reviews.mts passou em hnJK7a, HTTP 50889/50890; servidores
compilados próprios PIDs 1572 e 4320→20868→17512. Mesmo snapshot entre
processos, um vencedor entre approve/block, revisão superada após restart,
ABA de hash, alteração de perfil invalidando decisão, global invalidando
canal e histórico incluindo @all passaram. Três triggers deliberados de
falha de auditoria reverteram dados/decisões/todos os contadores. Backup
validou integrity/FK/contrato 23 e revisão persistiu no restart. Processos
e listeners próprios encerrados; verificação Windows posterior encontrou
somente o QA 14372 entre os PIDs conferidos.

A fixture usa metadados técnicos sem sonda/decoder e placeholder local
explícito para disponibilidade, não vídeo real. Não é prova de aprovação
física, transmissão, browser ou HA; dois processos usam SQLite compartilhado.
Primeira execução parou por alias de protocolo não resolvido fora do app;
segunda por cofre da fixture não isolado; terceira por reconciliação correta
de caminho inexistente. Import relativo, cofre próprio e placeholder de
disponibilidade corrigiram o verificador, não retiraram guardas do produto.

Integral final: 166 arquivos/1373 testes PASS, 62,60s às 19h58m57; typecheck
workspace, build servidor/web e diff check PASS. Backend SHA
290425D74E37B48054FDC3DA1B2AF4050BE6A2F9E0806737C728DD694ECE4177;
web index-ohG5_16B.js/index-BBx7O8R5.css (aviso de chunk ~925 kB permanece).
Engine não mudou nesta etapa: SHA
5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009;
72 PASS/1 OMT ignorado pertence à rodada UI-04 anterior, não novo teste nativo.

QA 4041 preservado: health 23h00m11Z, PID 14372 desde 18h43m57, canais
SIMULATED, engines/nativeEngines=0, MediaMTX disabled. Não houve nova
tentativa de contornar o bloqueio da atualização desse processo. Backend
em memória é anterior; não atribuir as novas guardas ao QA. Releases
r21/r22/r23 não foram alteradas; pacote final não produzido.

Objetivo integral continua ativo: guardas de projetos e acervo fora das
decisões QC; banco operacional separado; promoção HA executável, vínculos
locais/handoff/rejoin/failback/fencing externo; prova de mixes/trims/live
no reserva; formatos, soak/falhas, navegador e DeckLink/NDI/OMT físicos;
pacote portátil final em Windows limpo. Esta etapa não substitui nenhum
desses requisitos nem declara publicação 100% validada.

### Pausa após QC — 04/10/2026, 20h12 BRT

Operador solicitou fechar esta etapa e guardar pendências para continuação.
Retirado somente o scaffold incompleto de revisão de projetos iniciado após
SEC-20 (dois arquivos novos e referências); nenhuma migração 24 foi aplicada.
Domínio de projetos e alterações anteriores preservados. Diagnóstico e proposta
de proteção estão no arquivo de continuação, não declarados como implementados.

Após essa retirada: typecheck PASS, 6 arquivos/56 testes PASS às 20h12m24
(5,99s), diff --check PASS. Suite completa 166/1373 e build permanecem evidências
da SEC-20 anterior, não novas execuções nesta pausa. Hashes do servidor compilado
e engine preservados. QA4041 e releases não foram atualizados/reiniciados.
Objetivo fica pausado por solicitação do operador, com escopo restante intacto.

## SEC-21A — integridade e isolamento da restauração de projetos, 05/10/2026

Retomada explícita do operador. O turno anterior fechou checkpoint e enviou
código/evidências ao GitHub (progresso verificável); nesta retomada o worktree
estava limpo fora do estado local Ruflo. Ruflo/ToolSearch não expostos ([]),
sem delegação/instalação alternativa. Objetivo integral ativo e sem redução.

Captura agora é síncrona dentro de transação IMMEDIATE: canal, entidades e
snapshot são uma visão consistente. Hook da rota reconfere sessão/identidade,
papel, canal/estação e arquivamento dentro do commit. Snapshot e auditoria
CHANNEL_PROJECT_SAVED são atômicos. A listagem de metadados é private/no-store;
não entrega payloads com conexões/credenciais.

Restauração consulta snapshot, valida e grava dentro da mesma transação
IMMEDIATE, protegida pela fila/lease de configuração existente. Donos, IDs,
colisões com registros de outro canal/compartilhados, tipos escalares/colunas,
seções obrigatórias, IDs repetidos e referências a grades, itens, modelos,
slate, pares de fontes e mídia são verificados antes de apagar dados. Ausência
de mídia recusa restauração, não aprova nem disponibiliza o arquivo ficticiamente.
Seções cues/eventos podem faltar em snapshots v1 anteriores, mas não as demais.
Validação de armazenamento/referências não é QC nem validação semântica completa
de todos os campos JSON de cada subsistema; esse detalhamento ainda é necessário.

Removido upsert indiscriminado de rundown: atualização é explicitamente
limitada a ID+canal já conferidos; grade nova é INSERT normal. Deixas/eventos/
slates de outro canal usando modelos locais impedem restauração destrutiva.
Histórico operacional continua intocado; também se recusa remover grade com
histórico de importação/as-run. Cadência diferente em canal publicado continua
recusada. Eventos secundários do canal são removidos antes de reinserir os do
snapshot, corrigindo colisões/dados antigos que o fluxo anterior deixava.

Sessão/identidade/papel/canal são reconferidos após aguardar configuração;
estado PGM/CUE é conferido novamente no commit. Dados, contadores acionados
por triggers, auditoria detalhada CHANNEL_PROJECT_RESTORED e fase da lease
PROJECT_RESTORED são atômicos. Erro SQL reverte antes de fechar o runtime.
Falha posterior de rebuild/refresh retorna applied:true com engineError,
automaticTake:false e estado de configuração inconclusivo bloqueado: não
anuncia rollback nem aplicação física. UI diferencia esse aviso do sucesso.

Não se declara esta frente completa: ainda faltam prévia de impacto, revisão
monotônica original/ETag vinculado à conferência, consumo/fencing da decisão,
contratos de concorrência entre escritores e UI de confirmação que preserve
rascunhos e ignore respostas antigas. Migração 24 NÃO foi adicionada nesta
etapa. Os handlers atuais ainda não exigem revisão conferida da restauração.

39 testes novos: 35 de domínio e 4 HTTP. Cobrem colisões nas 12 seções,
payloads/referências incompatíveis, efeitos de cascata entre canais, histórico,
eventos repetidos, rollback de captura/restauração, counter de configuração,
sessão revogada e commit seguido de rebuild incerto. Rodada direcionada antes
dos quatro últimos casos: 59/59 PASS; tipos finais PASS e build servidor/web PASS.

Ensaio compilado scripts/verify-project-isolation.mts PASS em
C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-zQICxO,
HTTP 65025, filho próprio PID 5512. Recusou ID de grade estrangeira; dois
rollbacks reais de auditoria conservaram dados/counters; restaurou eventos
locais sem alterar eventos do outro canal; backup restaurável com integrity/FK.
Filho/listener próprios encerrados. Primeira tentativa falhou por resolução
de Drizzle fora do app; corrigido para usar dependência instalada do servidor.
Fixture SIMULATED, sem mídia decodificada, browser, hardware, revisão stale ou
replicação validados; nenhuma dessas provas é atribuída ao ensaio.

Build: server.cjs SHA-256
60CC364BD2C18973B6B824AF7D088207B480D3EA00E59F7C9A43E640ED5A9133;
web index-67OhS3t8.js/index-BBx7O8R5.css, aviso de chunk ~925 kB permanece.
Engine SHA inalterado
5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009;
não houve novo teste nativo/homologação física. QA4041 e releases antigas não
foram atualizados/reiniciados. Não houve novo commit/push automático.

Primeira integral desta etapa falhou: 163 arquivos PASS/3 FAIL,
1401 testes PASS/7 FAIL (1408 total, 192,66s). Timeouts de sonda HA/preset
e falhas do helper ACL Windows, com build concorrente; uma falha subsequente
do preset ficou sem resposta esperada. Não foram contadas como PASS nem
atribuídas definitivamente à carga sem prova. Repetição integral, incluindo
os quatro casos novos de dependências/histórico, iniciada com um worker
e sem build concorrente; resultado registrado a seguir quando terminal.
Nenhuma proteção ou prazo foi ampliado para fazer a suíte passar.

Um temporário .mediamtx.yml.private-* vazio ficou no workspace durante os
ensaios; preservado e incluído no ignore para não publicar possíveis conteúdos
privados futuros. Não foi apagado arquivo do operador, cofre, banco ou mídia.

Pendências integrais preservadas: prévia/revisões de projetos e outros mutadores,
banco separado, promoção HA/handoff/rejoin/failback/fencing físico, mixes/trims/live
no reserva, browser remoto e formatos/soak/falhas, DeckLink/NDI/OMT reais e pacote
portátil final em Windows limpo. Esta etapa não homologa publicação 100%.

Repetição integral terminal: `pnpm exec vitest run --maxWorkers=1 --minWorkers=1`
PASS, 166 arquivos/1412 testes, início 13h46m24, duração 683,44s. Sonda HA,
presets e helper ACL que falharam na primeira rodada passaram nesta rodada.
Resultado indica sensibilidade do ensaio à carga/concorrência de helpers,
não prova desempenho de produção nem elimina necessidade de soak. Typecheck
final PASS, build e ensaio compilado acima preservados, diff --check PASS.
Conferência elevada confirmou mediamtx.yml sem diff: indicação de modificação
na leitura restrita não foi tratada como autorização para reescrever o arquivo.
Novo código permanece local; repositório remoto continua no checkpoint c0e350e.

## SEC-21B — conferência original de restauração, 05/10/2026

Implementado: migração 24 com contador monotônico e tombstone por canal,
atualizado via triggers SQL por todos os escritores de projetos, grades/itens,
fontes, saídas/perfis, regras, grafismos/deixas/eventos, destinos, convidados,
multiview, snapshots, publicações/importações e as-run. Mídia/QC/equipamentos
e modelos compartilhados invalidam conservadoramente todas as conferências;
isso pode exigir reabertura durante ingestão. Overflow falha com rollback.
Startup/backup recusam counter/tabela/trigger ausente ou adulterado, sem
reparar silenciosamente uma proteção já marcada como aplicada. Banco 23
recebe baseline uma vez sem reescrever a grade/configuração.

GET restore-review é somente leitura e requer autorização fresca. Retorna
formato antes/depois, quantidades das 12 seções, grades removidas, publicações
preservadas e saídas/destinos/chaves habilitados; não devolve payload, endpoints
ou credenciais. Também confere o roteamento de áudio antes de qualquer escrita.
POST exige If-Match específico ao canal/projeto e prova da conferência original,
vinculada a ator, configuração e snapshot privado; verifica novamente dentro
da transação IMMEDIATE. Ausência 428, prova malformada/alvo errado 400,
stale/ABA/reuso/conflito 409. Nunca escolhe uma revisão nova para autorizar
uma confirmação antiga. Sessão, posse da configuração e STOP/CUE continuam
revalidados no commit. Auditoria registra as revisões efetivamente conferidas;
rollback conserva dados/counters/prova, sem rebuild. Commit seguido de erro
do engine conserva applied:true/configuração inconclusiva, sem replay/TAKE.

UI: painel remontado por canal, consulta atrasada descartada, campo de nome
preservado em falha, dupla ação imediata bloqueada, impacto explícito antes de
confirmar. Confirma a prova exibida; rejeição exige reabrir, sem retry ou
renovação implícitos. Sucesso não anuncia sinal físico; erro pós-commit não
é apresentado como rollback. Markup não é homologação visual de navegador.

37 testes novos (18 domínio, 3 HTTP, 7 migração, 7 envio da prova, 2 markup).
Direcionados iniciais 92/92 PASS, HTTP 30/30 PASS, migração 7/7 PASS.
Primeira integral: 169 arquivos, 168 PASS/1 FAIL; 1448 PASS/1 FAIL,
526,42s, início 14h25m04. Cenário que fabricava backup pré-editorial removia
tabelas antigas, mas conservava marca/triggers 24; proteção corretamente
recusou banco danificado. Corrigida somente a fabricação desse legado para
também retirar migração 24. Não flexibilizado startup/backup nem prazos.
Repetição direcionada terminal 3 arquivos/94 testes PASS, 25,55s, incluindo
10 testes de cofre/legado. Tipos finais PASS; build servidor/web PASS.

Servidor compilado scripts/verify-project-isolation.mts PASS, diretório
C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-HLwUgB,
HTTP 63104/PID próprio 26160. Preview cache privado; payload com ID estrangeiro
recusado antes de restaurar, revisão anterior recusada após alteração/reversão,
prova consumida não reutilizada, dois rollbacks reais de auditoria conservaram
dados/counters, eventos locais restaurados sem tocar outro canal e backup
restaurável com integrity/FK. Filho/listener próprios encerrados.
SIMULATED: não decodificou mídia nem validou navegador, saída física ou HA.
Teste com duas conexões ao SQLite/reinício valida counter durável; não é
replicação ou promoção distribuída. Script de automação nativa adaptado ao
contrato, mas não reexecutado nesta etapa; provas anteriores não reatribuídas.

server.cjs SHA-256:
686152428A9D227EDE616F46A2D0D1E7E3926DF565019C3528E65BD7A7CD7CF2.
Web index-C4PYu_Yd.js/index-BVhaDLlm.css; aviso de chunk 928,82 kB permanece.
Sem alteração Rust/novo teste nativo; QA4041 não reiniciado, releases existentes
e remoto c0e350e não alterados. Build local não equivale a pacote portátil final.

Repetição integral terminal: `pnpm exec vitest run --maxWorkers=1 --minWorkers=1`
PASS, 169 arquivos/1449 testes; início 14h37m00, duração 638,06s. Executada
sem build ou servidor de ensaio concorrente. A falha da fixture na primeira
integral passou após a correção; primeira rodada permanece registrada acima.
Tipos/build/ensaio compilado/diff --check PASS. SHA do engine confirmado,
inalterado: 5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009.
Nenhuma dessas provas é homologação de browser/sinal físico ou de HA.

Próximo incremento de software: SEC-21C — extrair/reusar validadores semânticos
dos subsistemas para snapshots, validar enums/limites e estruturas JSON antes
de conferir/aplicar, sem correção silenciosa e preservando compatibilidade
explicitamente suportada. Depois auditar outros mutadores do acervo/admin e
seguir banco separado/promoção HA, sem abandonar os requisitos originais.
Permanecem: validação semântica
completa dos JSONs e navegador remoto; outros mutadores/acervo/admin;
banco separado; promoção HA/handoff/rejoin/failback/fencing, mixes/trims/live
no reserva; formatos/soak/falhas; DeckLink/NDI/OMT externos; pacote final em
Windows limpo. O objetivo amplo está ativo, não pausado/concluído.

## SEC-21C — contrato semântico salvo, 05/10/2026

Implementado em `editorial-schemas.ts`/`project-contract.ts`: reutilização dos
primitivos HTTP de corte, áudio, âncora e perfil QC; validação específica do
conteúdo salvo nas 12 seções de projeto. Não substitui o payload por saída
normalizada do parser. Captura passa pelo mesmo validador usado na prévia e
no commit IMMEDIATE; erro retorna 400 indicando somente a seção, sem valores
privados. Continua aplicável a guarda original da SEC-21B.

Cobertura: enums e limites de formato/saídas/fontes/regras/layout/grafismos,
protocolo de saídas/presets, preview leve, calendário real e zonas ordenadas,
cortes/âncoras/elasticidade e duração live, estruturas estritas de áudio/matrix,
mix de pares, medição, SRT/failover/células, campos e IDs duplicados, SCTE
com PTS de 33 bits e cadência dentro de i32 nativo. Eventos editoriais não
restauram FIRING/EXECUTED nem comandos ocultos. Automação consulta equipamento
existente/habilitado por leitura; não envia comando nem grava hash operacional.
Dados válidos permanecem iguais. Legado v1 sem tipo de evento é aceito como
grafismo para validar, sem reescrever o conteúdo.

Limites: validação estrutural de medição não prova loudness/autenticidade nem
aprova AUTO; SVG/payload não foram renderizados, fontes/destinos genéricos não
foram conectados. Não é validação de conteúdo de vídeo, QC real, compatibilidade
física ou contrato de todos os mutadores ordinários. Não houve migração 25.

58 testes novos: 57 em projetos e um HTTP. Falhas durante desenvolvimento,
preservadas no registro:

- Primeiro conjunto direcionado: quatro arquivos falharam na coleta, zero
  testes executados, por `.max` usado após refinamento Zod. Corrigida composição
  dos validadores, não flexibilizada a regra.
- Direcionados seguintes: 167 PASS/1 FAIL, 59,94s. Comparação indevida do relógio
  live em duas consultas deu 13→14; teste agora exige todo o estado igual exceto
  avanço monotônico do relógio. Não pausa o runtime nem esconde comandos.
- Quatro arquivos direcionados: 225 PASS, 62,31s, início 15h02m18 BRT;
  caso adicional de captura inválida foi acrescentado depois.
- Integral terminal: 169 arquivos/1507 testes PASS, início 15h05m18 BRT,
  711,63s, um worker, sem build/servidor de ensaio concorrentes. Última correção
  durante/depois dessa rodada foi somente anotação de tipos dos testes.
- Checagem de tipos recusou callbacks de testes sem retorno anotado corretamente
  (TS7024/TS2355). Corrigidos os retornos, sem alteração de comportamento; tipos
  finais PASS em todos os pacotes. Repetição focal pós-correção: 111/111 testes
  de projetos PASS, início 15h23m21 BRT, 16,90s. Diff --check final PASS.
- Primeiro compilado 0WKcMd recusou fixture de evento sem `templateId` obrigatório;
  completada somente a fixture. Segundo, 8k7e78, comparava indevidamente toda
  a auditoria: pedido recusado grava tentativa HTTP/fencing legitimamente.
  Verificador distingue registros de sucesso de captura/restauração dessas
  tentativas; não remove auditoria ou enfraquece a guarda de produção.

Build servidor/web PASS. Ensaio compilado final
`scripts/verify-project-isolation.mts` PASS, evidência em
`C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-ZlsA6p`,
HTTP 62383/PID próprio 27352. Recusa semântica tanto no GET como no commit
com revisão atual, captura inválida sem snapshot/sucesso auditado, IDs estrangeiros,
ABA/reuso, dois rollbacks de auditoria/counters, eventos locais/estrangeiros
e backup integrity/FK passaram. Filho/listener próprios encerrados.
SIMULATED: mediaDecoded/browserPlaybackValidated/physicalOutputValidated/
replicationValidated são false; automaticTake false. Não reatribuir ensaios
nativos anteriores a esta etapa.

SHA-256 server.cjs:
`C7AAE95C4C590EA16EF571466D689516ED2C866E9D262C6002989A05DA707A92`.
Web `index-Dp5KE_UO.js`/`index-BVhaDLlm.css`; aviso de chunk 928,82 kB
(gzip 244,99 kB) permanece. Engine inalterado:
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Sem mudança Rust, ensaio nativo novo, atualização do QA4041, release portátil,
commit ou push nesta etapa. Remoto permanece c0e350e.

Próxima frente de software, confirmada por leitura das rotas: CRUD normal de
fontes live, multiview, regras e templates/slate ainda não exige a revisão
original nem acopla autorização fresca/escrita/auditoria na mesma transação.
Os contadores de projeto invalidam conferências de restauração, mas NÃO tornam
essas rotas concorrentes seguras sozinhos. Implementar contratos e UI por
alvo/canal/global, preservando rascunhos e mostrando conflito, sem atualizar
automaticamente a prova de uma ação antiga. Inventariar acervo/admin depois.

Objetivo original permanece ativo: banco operacional separado, promoção HA
com fencing/handoff/rejoin/failback, mídia/áudio/cortes/live no reserva, testes
de falha/soak e restauração real, DeckLink/NDI/OMT externos, operação no navegador
remoto, pacote Windows novo sem dependências de desenvolvimento e homologação
em Windows limpo. Sem indicação de 100% ou encerramento global.

## SEC-22A — cadastro de entradas ao vivo conferido, 05/10/2026

Implementado: migração 25 com revisão monotônica por canal e tombstones, seis
triggers SQL de canais/fontes cobrindo todos os escritores, mudança de dono,
ABA e mesmo valor regravado. Baseline de bases existentes é criado uma vez;
startup/backup recusam tabela, contador ou trigger ausente/adulterado de uma
migração já aplicada. Não há reparo silencioso ou revisão presumida.

GET `/api/channels/:id/live-source-review` lê autorização, canal, fontes e
revisão no mesmo snapshot, com ETag e cache privado/no-store. As rotas CRUD
`/api/sources/live` e `/api/v1/sources/live` exigem esse If-Match original.
Transação IMMEDIATE reconfere sessão/conta/estação/acesso ao canal/arquivo e
grava dados, revisão e auditoria juntos. Ausência 428, prova malformada/alvo
errado 400 e stale/ABA 409, sem escrita de sucesso. PUT não muda o canal dono.
Recusa campos desconhecidos, limites de SRT/failover inválidos, conexão de
protocolo incompatível e pares estrangeiros/mesmo papel. Remover uma entrada
referenciada como reserva exige desvincular explicitamente. Auditoria contém
IDs/revisões/campos, não endpoint, passphrase ou stream ID privados.

Cadastro, edição e remoção não chamam rebuild/CUE/TAKE nem alteram PGM/PVW.
Erro de atualização depois do commit conserva `applied:true`, com aviso, sem
fingir rollback ou repetir a gravação. Nome segue abaixo da seleção da entrada:
NDI/OMT/SDI usam a seleção para sugerir o nome, com alias manual e ação explícita
para voltar ao nome da fonte. Renomear preserva a conexão protegida, inclusive
envelope de outra instância; identidade estável não depende do ciphertext.

UI de Configurações é remontada por canal. Master e Configurações separam
lista atual da revisão de abertura do formulário; não buscam revisão nova
na confirmação. Recusa preserva rascunho e exige Reabrir lista, com confirmação
antes de descartar campos. Bloqueio imediato impede dupla ação; respostas
obsoletas/fora do canal são descartadas. Falha de recarga após cadastro gravado
também exige reabertura, evitando repetir a ação. A inserção de linha na grade
e o cadastro opcional no acervo continuam ações distintas: não são uma transação
atômica entre subsistemas. Falha do cadastro informa que a linha já foi inserida.

46 testes novos: domínio 23, HTTP 9, migração 6, prova da UI 7 e markup 1.
HTTP verifica revogação de conta, estação, canal e sessão entre a autorização
inicial e o commit; todas recusadas sem cadastro. Markup não é homologação de
interação visual. Registro das rodadas e reparos:

- Primeiro typecheck recusou estreitamento TypeScript por helper `never` em
  arrow e tipo de Object.keys; corrigidas anotações, não a regra de proteção.
- Direcionados iniciais: 74 PASS/1 FAIL. Fixture usava papel VIEWER não suportado,
  que o parser existente trata como OPERATOR; por isso não revogava edição.
  Corrigida a fixture para desabilitar a conta e ampliados os quatro casos de
  revogação. Produção não flexibilizada. HTTP repetido: 6/6 PASS, 8,52s.
- Direcionados finais: 10 arquivos/79 testes PASS, início 16h31m47 BRT, 36,96s.
- Integral terminal: 174 arquivos/1553 testes PASS, início 16h32m49 BRT,
  516,49s, um worker, sem build/servidores de ensaio concorrentes. Ajuste final
  de recarga UI feito nessa rodada antes da coleta dos testes de markup.
- Typecheck final de todos os pacotes PASS; build servidor/web PASS;
  diff --check PASS. Aviso de chunk web permanece: 933,48 kB/gzip 246,35 kB.

Ensaios executados na nova build, usando apenas processos/bancos próprios:

1. `verify-live-source-reviews.mts` PASS: diretório
   `C:\Users\fsda\AppData\Local\Temp\RPlayout-live-source-reviews-2KXPI5`,
   HTTP 62578/62579, PIDs próprios 27652 e 7348→19040. Dois escritores da mesma
   revisão produzem um único vencedor (201/409); ausência/ABA/dono errado
   recusados; três falhas reais de auditoria revertem CREATE/UPDATE/DELETE,
   contadores e registros de sucesso. Renomear preserva credencial privada,
   PGM tocando e PVW distinto; restart preserva revisão, backup integrity/FK
   passa. Filhos/listeners próprios encerrados.
2. `verify-project-isolation.mts` PASS: diretório
   `C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-w1pnvi`,
   HTTP 56592/PID próprio 26912. Regressão SEC-21 com migração 25: isolamento,
   semântica GET/commit, captura inválida, ABA/reuso, dois rollbacks de auditoria,
   eventos estrangeiros preservados e backup restaurável. Filho/listener fechado.
3. `verify-source-wire.mts` PASS: diretório
   `C:\Users\fsda\AppData\Local\Temp\RPlayout-source-wire-chl6OA`.
   HTTP/WebSocket não vazam o marcador privado; alias preserva URI, referência
   anterior funciona após restart, identidade permanece/ciphertext gira e
   referência malformada é recusada. Processo próprio encerrado.

Os três ensaios são SIMULATED: não decodificam vídeo, homologam navegador,
saída/entrada física, replicação ou promoção HA. TAKE do verificador é apenas
ação explícita da fixture, nunca ação automática do cadastro. Force-failover
e demais comandos operacionais de fontes não ganharam este contrato de CRUD.

SHA-256 server.cjs:
`61AD19BCD178538C9BC5E08ED559889BA9DE2D44C781E66E0DF61B03CC552FBD`.
Web `index-BIMHElju.js`/`index-23ov0gFQ.css`. Engine conferido e inalterado:
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Sem alteração Rust/ensaio nativo novo, atualização QA4041, pacote portátil,
commit ou push. Remoto permanece no checkpoint c0e350e; mudanças são locais.

Próxima frente: mutadores normais de multiview/regras/templates/slate e
acervo/admin, com revisão original, autorização fresca, auditoria atômica e
UI consistente. Não reimplementar o CRUD de fontes como se ainda estivesse
sem proteção. Banco separado, promoção/fencing/handoff/rejoin/failback,
mixes/trims/live no reserva, hardware externo, browser remoto, testes de
falha/soak e pacote Windows final continuam no objetivo amplo ativo.

Achado para a auditoria de autorização/admin: a API de usuários restringe
OPERATOR/PROGRAMMER/SUPERVISOR/ADMIN, mas `parseRole` atribui OPERATOR a valores
desconhecidos já persistidos/configurados. Recusa fail-closed para legado ou
dado corrompido ainda precisa ser implementada/testada; não foi corrigida
implicitamente ao reparar a fixture de revogação desta etapa.

## SEC-22B — papéis inválidos e sessão atômica, 05/10/2026

O achado histórico ao final da SEC-22A foi corrigido: `parseRole` só aceita os
quatro papéis exatos. Espaços, diferenças de caixa, valores desconhecidos,
arrays/objetos e propriedades de prototype não viram OPERATOR. `DENIED` é
resultado diagnóstico sem nenhuma ação concedida, não novo papel de usuário.
APIs de cadastro continuam limitadas aos quatro papéis anteriores. `can` usa
propriedade própria, recusando papel desconhecido sem exception/concessão.

AccessControl recusa identidade com papel persistido inválido; autenticação
continua obrigatória quando existem contas, sem abrir modo anônimo. Sessão
inválida/não autenticada em ambiente protegido mostra Acesso não autorizado.
No modo local sem conta, DEFAULT_ROLE inválido ou header inválido também
resulta DENIED para todas as ações; header ADMIN não eleva configuração menor.
Leituras anônimas já permitidas no modo sem contas não se tornaram privadas por
essa mudança. Corrigir configuração inválida exige um papel válido explícito;
não há conversão silenciosa nem criação automática de administrador adicional.

Emissão de login em `login-session.ts`: depois de verificar a senha, a
transação IMMEDIATE reconfere a conta original por ID/nome/hash verificados,
enabled, papel e política de estação atual. Troca de senha não permite usar a
verificação antiga para emitir sessão nova. Mudança para papel válido retorna
somente o papel atual. Política malformada/estação recusada retorna 403; conta
desativada/removida/renomeada/hash/papel inválido retorna 401, sem cookie.
Sessão de 12h guarda somente SHA-256 do token. SESSION_CREATED e sessão são
gravados juntos, com auditoria sem senha/hash/token; falha reverte ambos.
Cookie só é enviado após commit. Fluxos administrativos e bootstrap inicial
de criação de conta não ganharam atomicidade/revisão compartilhada nesta etapa.

47 novos testes: permissões 15, acesso HTTP 12, cadastro live 1, sessão
transacional 12, configuração local 6 e controle externo 1. Casos HTTP alteram a conta/política
entre verificação e commit; cadastro live agora também recusa revogação por
papel inválido. Preservados os contratos válidos e testes de continuidade.

Rodadas/reparos, sem ocultar falhas:

- Primeiro direcionado: seis arquivos, 51 PASS/18 FAIL, início 16h52m28 BRT,
  17,68s. Novo helper tentou ler `$client` no objeto de transação Drizzle,
  que não expõe esse campo, causando recusa indevida de políticas válidas.
  Typecheck também detectou TS2339. Corrigida leitura pelo `$client` do banco
  pai, mesma conexão síncrona já sob o lock IMMEDIATE; não foi removida a
  revalidação nem ampliada permissão. Direcionados seguintes 69 PASS, 24,75s,
  início 16h53m48; depois acrescentados os casos HTTP restantes.
- Direcionado final: seis arquivos/76 testes PASS, início 18h13m08 BRT,
  34,69s. Typecheck final PASS em todos os pacotes; build servidor/web PASS.
- Primeiro compilado parou porque createRequire pelo junction de pnpm não
  localizava ws; terminal incluiu assertion de fechamento libuv/Windows.
  O finally aguardou o encerramento do próprio filho. Corrigida apenas a
  resolução de realpath da dependência já instalada, sem instalar módulo,
  enfraquecer autenticação ou usar navegador/headless. Repetição PASS abaixo.
- Primeira integral terminal: 176 arquivos, 175 PASS/1 FAIL; 1598 testes
  PASS/1 FAIL, início 18h17m19 BRT, 520,03s, um worker, sem build ou ensaio
  compilado concorrente. Registrar repetição terminal antes de declarar
  regressão completa validada nesta etapa.
  Um teste antigo de controle externo fabricava VIEWER como conta válida sem
  OUTPUT_CONTROL, esperando 403. O novo contrato corretamente recusou identidade
  inválida com 401. Fixture passa a usar OPERATOR válido para testar falta de
  permissão (403); caso separado exige VIEWER inválido sem autenticação (401),
  sem gateway executado nem elevação por header/token de serviço na rota da página.
  A primeira integral foi preservada. Direcionados finais após o reparo:
  sete arquivos/84 testes PASS, início 18h26m36 BRT, 41,71s. Typecheck final
  de todos os pacotes PASS. Repetição integral iniciada sem build/ensaio concorrente.
- Repetição integral terminal: 176 arquivos/1600 testes PASS, início
  18h27m58 BRT, 518,94s, um worker, sem build/ensaio concorrente. Controle
  externo corrigido e caso novo passaram. Nenhuma mudança de produção após
  a build/ensaio compilado; reparo posterior alterou somente testes e documentação.

`scripts/verify-auth-role-boundary.mts` na nova build PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-auth-role-boundary-jSBHVN`,
HTTP 51515, PIDs próprios 29084→31048→456 (restart e fixture local separada).
Conta com VIEWER/ADMIN com espaço/prototype inválido: login 401 sem cookie,
identidade não autenticada/required:true e leitura protegida 401, mesmo com
header ADMIN. WebSocket previamente autenticado encerrou com código 4401.
Falha SQL real em SESSION_CREATED retornou 500 e não deixou sessão/sucesso
auditado/cookie. Conta válida emite sessão válida após reparar a fixture,
e essa sessão continua após restart. Segunda base sem usuários, configuração
VIEWER, recusou criar canal com e sem header ADMIN; não modificou os canais.
Processos/listener próprios encerrados, não atuou no QA4041 ou em conta real.

Ensaio SIMULATED valida contrato HTTP/WebSocket/SQLite, não a interface visual,
decodificação, hardware, replicação, promoção ou HA. Não houve CUE/TAKE no ensaio.
SHA-256 server.cjs:
`495BEA2C80B676734472DFAB6B260DA94174FBE0ABB707D8CC632A1F43C6F161`.
Web `index-BLd7k0ug.js`/`index-23ov0gFQ.css`; aviso chunk 933,48 kB/gzip
246,35 kB permanece. Engine conferido e inalterado, SHA-256
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Sem alteração Rust/novo ensaio nativo, deploy do QA, pacote portátil, commit
ou push. Último checkpoint remoto registrado c0e350e; não houve nova consulta
ao GitHub nesta etapa. Objetivo amplo continua ativo.

Diff --check global chegou a ser recusado por falta de leitura de mediamtx.yml.
Conferência restrita a apps/packages/scripts/docs PASS; não foi inspecionado,
reescrito ou usado bypass para esse arquivo protegido. Mudanças de políticas
do workspace e dados/configurações existentes permanecem fora desta edição.

Próximo software: multiview/regras/templates/slate e acervo/admin com revisão
original, autorização fresca e auditoria atômica. Read atual do multiview
sem dados gera timestamp novo; PUT atual não faz revisão/commit auditado.
A UI de Engenharia só troca layout local, sem integração com config salva;
ao implementar, não transformar tally/telemetria salvos em prova de sinal.
GET/PUT atuais também usam `mv-default` tanto para escopo global quanto para
canal cujo ID seja `default`; leitura/escrita precisam conferir dono e evitar
essa colisão de namespace, sem sobrescrever conteúdo legado/estrangeiro.
Continuar banco separado, promoção/fencing/handoff/rejoin/failback,
mixes/trims/live no reserva, hardware/browser externos, falhas/soak e pacote
Windows final. Não confundir esta correção de permissão com conclusão global.

## SEC-22C — layout multiview compartilhado e isolado, 05/10/2026

Corrigidos os achados históricos da SEC-22B: GET sem configuração não fabrica
timestamp, e a leitura/escrita procura o dono real, nunca um ID sintetizado.
Global e canal `default` têm namespaces distintos; ID legado `mv-default`
continua pertencendo ao seu dono. Inserção global usa UUID sem sobrescrever
esse registro. Configurações duplicadas/semanticamente inválidas são recusadas
explicitamente, também antes de capturar projeto; não há merge ou descarte
silencioso. Fonte cadastrada, tally e telemetria salvos não equivalem a sinal.

Migração 26 cria counters monotônicos por escopo com tombstones e nove triggers
para canais/fontes/configurações. Alterar e reverter, mesmo valor e troca de
dono invalidam a conferência. Contrato de tabela/triggers/counters é validado
na abertura e restauração; danos não são reparados presumindo uma revisão.
Upgrade da migração 25 preserva conteúdo/IDs e inicializa baseline uma única vez.

GET e seus aliases retornam snapshot privado/no-store com ETag. PUT exige
If-Match original, reconfere sessão/papel/estação/canal/arquivo sob IMMEDIATE
e grava configuração, revisão e MULTIVIEW_EDITED juntos. Conta restrita não
consulta/escreve escopo global ou outro canal. Prova ausente é 428, malformada
ou de outro escopo 400, conflito 409. Auditoria inclui IDs/layout/contagens,
sem URL privada ou medição. Falha de auditoria reverte criação/atualização e
counters. Falha posterior de refresh informa applied:true com aviso, não
finge rollback nem repete escrita. Não reinicia engine nem envia CUE/TAKE.

A aba Multiview da Engenharia agora confere e salva layout do canal.
Seleção local e gravação compartilhada são explícitas; revisão original não
é renovada pelo polling de sinal. Recusa conserva layout em edição e exige
Reabrir conferência, com confirmação antes de descartar alteração local.
Editor remonta por canal e ignora respostas antigas/desmontadas; ações ficam
bloqueadas enquanto ocupadas ou sem conferência. Dashboard permanece local.
Este editor cobre layout, não ordenação/alias/vinculação completa de células.
Cards de sinal continuam derivados do engine, nunca da telemetria histórica
do banco. Salvar só layout omite cells e preserva conexões/células privadas.

Evidência desta build, sem ocultar tentativa malsucedida:

- 44 testes novos em cinco arquivos. Direcionados: seis arquivos/159 PASS,
  início 18h47m03 BRT, 34,07s; HTTP/UI três arquivos/18 PASS, início 18h49m03,
  8,49s; migração sete PASS, início 18h50m16, 4,91s. Total dez arquivos/184.
- Typecheck final de todos os pacotes PASS; build servidor/web PASS.
  Aviso chunk web permanece: 936,50 kB/gzip 247,21 kB. Markup SSR confirma
  controles iniciais bloqueados; não é interação visual em navegador.
- Primeiro compilado terminou com exit 1 ao reiniciar o segundo filho próprio,
  depois das demais asserções. Mensagem antiga não expunha o log do filho;
  acrescentado diagnóstico sanitizado, sem alterar proteção de produção ou
  implementar retry que esconda recusa. Repetição terminal PASS abaixo; causa
  do primeiro encerramento não estabelecida. Segunda repetição também PASS
  (Gpj95u abaixo), sem retry nem mudança de produção; não apaga a ocorrência.
- Integral terminal: 181 arquivos/1644 testes PASS, início 19h30m38 BRT,
  545,96s, um worker, sem build/verificador concorrentes. Nenhuma mudança
  de produção após a build compilada ensaiada; documentação atualizada à parte.

`scripts/verify-multiview-reviews.mts` PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-multiview-reviews-6pc34o`,
HTTP 53582/53583, PIDs próprios 30332 e 28640→27608. Dois escritores compilados
da revisão original produzem 200/409 e um sucesso auditado. Recusa edição cega,
ABA e prova de outro dono; global/default isolados, metadados históricos
marcados como tais, dois rollbacks SQL reais de auditoria, células privadas
preservadas ao salvar layout. CUE/TAKE somente explícitos na fixture SIMULATED;
PGM tocando e PVW distinto preservados. Reinício conserva revisão; backup
integrity/FK PASS. Filhos/listeners próprios encerrados.

Segunda repetição do mesmo multiview compilado PASS, após a integral terminal:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-multiview-reviews-Gpj95u`,
HTTP 65075/65076, PIDs próprios 19032 e 24396→15892. Mesmas asserções passaram,
incluindo restart do segundo filho, backup e fechamento dos próprios processos/
listeners. SHA-256 idêntico a 6pc34o; não é build nova ou prova física/HA.

Regressão `verify-project-isolation.mts` na build SEC-22C também PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-zvW4sb`,
HTTP 65233/PID próprio 20052. Isolamento, conteúdo semântico, captura inválida,
ABA/reuso, rollbacks de captura/restauração, preservação de eventos estrangeiros
e backup passaram com migração 26. Filho/listener fechado, sem TAKE automático;
SIMULATED, não decodificação, browser, hardware, replicação ou promoção HA.
Diff --check restrito a apps/packages/scripts/docs PASS; arquivo protegido
mediamtx.yml não foi inspecionado nem usado bypass.

SHA-256 server.cjs:
`651AE1F987BFB09AE4EB7C4316411693D0BC7B69E63245092974F85FD44D445F`.
Web `index-CNnzYpV6.js`/`index-23ov0gFQ.css`. Engine conferido e inalterado:
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Sem Rust/novo ensaio nativo, QA4041/release/pacote final/commit/push atualizados.
Último checkpoint remoto registrado c0e350e; sem nova consulta ao GitHub.
Não contornar bloqueio anterior de QA/navegador com execução alternativa.

Próximo: guardas ordinárias de regras/templates/slate e acervo/admin;
editor completo de células se requerido e comandos force-failover com contrato
operacional próprio. Continuam banco separado, promoção/fencing/handoff/
rejoin/failback, mixes/trims/live no reserva, hardware e navegador externos,
falhas/soak e pacote Windows final. Objetivo amplo ativo, não 100% homologado.

## SEC-22D — faixas editoriais e propostas diárias conferidas, 05/10/2026

CRUD normal de faixas agora usa o ETag original da lista do canal. POST/PATCH/
DELETE reconferem sessão, papel, estação, dono real e canal não arquivado sob
lock IMMEDIATE. Schema estrito recusa owner mass assignment, campos ocultos,
PATCH vazio, dias repetidos, limites/categorias inválidos e término antes do
início. Sobreposição é verificada dentro da mesma transação que grava; duas
estações da mesma revisão têm um único vencedor. Horários encostados e dias
distintos são permitidos. GET é privado/no-store, estável, sem escrita;
consulta de canal arquivado continua histórica, sem autorização de mudança.
Guardas indiretas PATCH/DELETE também consultam o dono real, sem aceitar spoof
de canal. Captura/prévia/restauração de projeto recusam coleção sobreposta.

Migração 27 cria counter durável por canal, seis triggers de canais/faixas,
tombstones e baseline de upgrade uma única vez, sem mudar IDs/conteúdo legado.
Todo escritor SQL invalida a revisão, inclusive mesmo valor, ABA e troca de
dono. Contrato de tabela/triggers/counters é verificado no startup/backup.
Dados/counters/projeto e SCHEDULE_RULE_EDITED são atômicos. Falha SQL real de
auditoria reverte criação/edição/remoção. Falha posterior de refresh informa
applied:true com aviso; não inventa rollback, reinicia engine ou dá TAKE.

Achado adicional corrigido: proposta DAY antes comparava apenas conteúdo das
faixas. Alterar e reverter podia restaurar o hash e autorizar proposta velha,
sem mudar a revisão da grade. Dependência DAY agora inclui counter da pauta,
no mesmo snapshot da proposta/commit; recusa ABA/mesmo valor, não renova a
proposta nem refaz seleção na confirmação. Legado inválido/sobreposto não é
normalizado nem proposto. Propostas DAY anteriores a esse vínculo precisam
de nova conferência; WINDOW não recebeu dependência de faixas. Alteração de
outro canal não invalida indevidamente DAY local. Montagem permanece editorial,
com aprovação/publicação operacional separadas e sem TAKE automático.

AutoFill usa editor de faixas mantido montado ao trocar abas, guardado por
canal. A abertura confere lista/prova; erro preserva lista anterior, não afirma
ausência de faixas. Formulário permite nome, horário, dias, categorias e
evitar reprise. Falha conserva todos os campos e bloqueia repetição até
Reabrir conferência, com confirmação antes de descartar rascunho. Respostas
antigas/desmontadas são ignoradas, e ações ocupadas bloqueadas com ref imediata.
Remover outra faixa atualiza a lista do próprio commit, não a prova de edição
já iniciada; salvar rascunho conhecido como stale fica bloqueado. Só o próprio
save ou início explícito de novo rascunho avança sua base; rascunho novo vazio
sem intenção anterior pode acompanhar a própria remoção. Proposta diária
também depende da conferência disponível/revisão visível, sem auto-publicação.

Verificações e reparos preservados:

- 65 novos testes: domínio de faixas 27, HTTP/montagem 18, migração 7,
  API original 7, markup 2 e projetos 4. SSR/API não é interação visual real.
- Primeira direcionada: oito arquivos, 181 PASS/1 FAIL (182 testes), início
  19h53m01 BRT, 55,46s. Mock devolvia o mesmo objeto Response para três chamadas;
  corpo já consumido causou Body is unusable. Corrigida fixture para resposta
  nova por chamada, sem alterar API/renovar prova para fazer teste passar.
- Segunda: três arquivos, 83 PASS/4 FAIL (87 testes), início 19h55m59,
  31,91s. Quatro novos casos DAY não informavam loop obrigatório da grade;
  corrigidos com loop:false, sem mudar constraint de produção.
  Repetição HTTP/API: 25/25 PASS, início 19h58m30, 12,74s.
- Direcionada seguinte: nove arquivos/248 PASS, início 20h01m01, 76,36s.
  Depois completada recusa de sobreposição em projeto: quatro casos novos,
  arquivo com 115/115 PASS, início 20h02m35, 20,95s. Tipos finais de todos
  os pacotes PASS. Build servidor/web PASS; aviso chunk permanece: 936,98 kB/
  gzip 247,92 kB, 153 módulos. Integral terminal: 186 arquivos/1709 testes PASS,
  início 20h08m45 BRT, 444,18s. Um worker, sem build/verificador concorrentes.

Primeiro compilado falhou ao conferir a proposta DAY: metadata apontava para
arquivo inexistente. Diagnóstico no próprio DB m6SLBn confirmou probe_error
"o arquivo não está mais na pasta". Uma consulta diagnóstica tentou coluna
available inexistente, depois foi corrigida; não houve mudança de produção.
Adicionado arquivo de presença placeholder fora das raízes de scan da fixture,
sem decoder/probe habilitados, como no ensaio QC existente. Asserção de plano
não vazio foi mantida; não se desativou reconciliação/QC para aceitar sumiço.
Repetição terminal PASS abaixo. Isso não é vídeo decodificado/aprovado real.

`scripts/verify-schedule-rule-reviews.mts` PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-schedule-rule-reviews-8WyocI`,
HTTP 65015/65016, PIDs próprios 13944 e 6460→22048. Dois escritores compilados
da mesma revisão têm um único vencedor; CRUD cego, prova de dono errado,
transferência de owner, sobreposição e ABA são recusados. Dias distintos/
horários encostados e canal Unicode funcionam. Falhas SQL reais em CREATE/
UPDATE/DELETE revertem dados/counters/sucesso auditado. Proposta DAY não entra
na grade após alterar e reverter a pauta. CUE/TAKE só explícitos na fixture;
editar/remover faixa preserva PGM tocando/PVW distinto. Restart conserva revisão,
backup integrity/FK passa, próprios filhos/listeners encerrados.
SIMULATED/metadata placeholder: não decodifica/homologa mídia, browser,
DeckLink/NDI/OMT, replicação, HA ou entrega física.

Regressões compiladas depois da integral, sequenciais, na MESMA build:

- Projetos `C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-bvhDba`,
  HTTP 60312/PID próprio 27364 PASS. Verificador ampliado com faixas adjacentes
  reais no DB de fixture; captura/prévia/commit recusam faixas sobrepostas,
  restauração válida conserva as adjacentes. Rollbacks também conferem counters
  das migrações 25/26/27, além dos anteriores, e toda a captura em falha SQL de
  auditoria. Contrato semântico, isolamento, ABA/reuso, eventos e backup PASS.
  Filho/listener próprios encerrados. Primeiro GzD2Av falhou na captura inicial:
  fixture usou weekdays:[1], mas o contrato salvo é string "1". Corrigida apenas
  fixture; produção preservada. Houve também assertion do runtime Node/libuv no
  encerramento dessa tentativa com falha; não atribuída causa adicional nem
  tratada a primeira tentativa como PASS. Repetição terminou exit 0 e limpeza
  própria conferida.
- Multiview `C:\Users\fsda\AppData\Local\Temp\RPlayout-multiview-reviews-qG8G1M`,
  HTTP 60360/60361, PIDs próprios 12976 e 11756→22320 PASS. Vencedor único,
  revisão cega/ABA/dono errado recusados, global/default isolados, dois rollbacks,
  células privadas e PGM/PVW preservados, restart e backup PASS. Filhos/listeners
  próprios encerrados.

Ambos SIMULATED: não são replicação/HA, mídia decodificada, browser ou placa.
Não atribuir ensaios históricos a esta build: estas duas repetições são novas.

SHA-256 server.cjs:
`EA03B13D60609A35E412E281ECE8F655B3358490CD65E5C86ECEEEF516316119`.
Web `index-BI2sPBEy.js`/`index-DJjEZI1i.css`. Engine conferido, inalterado:
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Diff --check apps/packages/scripts/docs PASS; arquivo protegido mediamtx.yml
não inspecionado nem contornado. Último checkpoint remoto registrado c0e350e,
sem nova consulta ao GitHub. Não atribuir ensaios SEC-22A/B/C a esta build.

Não há novo pacote final, atualização QA4041/release/commit/push ou ensaio
nativo/Rust nesta etapa. Homologação de navegador/DeckLink/NDI/OMT, editor
completo de células multiview, templates/slate/admin/acervo, force-failover,
banco separado, promoção/fencing/handoff/rejoin/failback, mixes/trims/live no
reserva, recuperação/soak e pacote Windows limpo continuam no objetivo ativo.

## SEC-22E — templates e apresentação técnica conferidos, 05/10/2026

CRUD ordinário de artes agora usa revisão original por dono real. CREATE
confere escopo explicitamente escolhido; PATCH estrito não permite transferir
owner, ID ou campos ocultos. Consulta `/api/graphics/review` é privada/no-store,
estável e transacional, distinta da coleção legada filtrada `/api/graphics`.
Lista de um canal contém suas artes e compartilhadas; escopo global contém
somente compartilhadas. Conta restrita pode usar/ler arte global, mas não
reescrevê-la: autoria, papel, estação, sessão e acesso são reconferidos dentro
de IMMEDIATE. Canal arquivado permite consulta histórica, não escrita.

Migração 28 cria counters G/C:id e seis triggers de canais/templates, com
tombstones e upgrade único que preserva conteúdo/IDs. Canal `G` não é global.
ETag combina a revisão local com a compartilhada; mudança/mesmo valor/ABA em
template global invalida seleção antiga de slate em qualquer canal. Outro
canal sem mudança compartilhada não invalida a revisão local. Contrato de
tabela/triggers/counters é verificado na abertura e restauração de backup;
proteção marcada mas danificada não é recriada silenciosamente.

Nome, SVG como texto, campos únicos, fade e hold são conferidos. Placeholders
visíveis derivam os campos na criação/alteração de SVG, preservando rótulos e
defaults declarados; renomear não refaz os campos. Validação é de armazenamento,
não parser/renderizador SVG ou aprovação de saída. Projeto passa a usar o
mesmo contrato semântico de artes. Legado inválido não é omitido/certificado
por consulta; correção legada explícita ainda precisa de fluxo dedicado.
Excluir arte vinculada a apresentação técnica, cue ou evento secundário é
recusado. Não apaga referência, payload operacional publicado ou histórico.

PATCH slate exige revisão original e template válido global ou do canal.
Atualização, counters e SLATE_CONFIGURATION_CHANGED são atômicos; mesma regra
para GRAPHIC_TEMPLATE_EDITED. Auditoria não copia SVG, defaults ou payload.
Falha de auditoria reverte tudo ANTES de tocar no runtime. Pós-commit com
falha de aplicação/aviso retorna applied:true, não rollback/replay fictícios.
Runtime existente recebe apenas configuração de slate, sem reconstrução ou
TAKE. Política de slate do canal vazio permanece existente; não é homologação
de entrega. GRAPHIC show/hide/layers e slate de emergência são comandos
operacionais separados: ainda precisam de sua própria revisão/ledger/ACK.

UI do GC confere lista/escolha original ao abrir, sem renovar por props ou
polling. Marcar é local; **Salvar apresentação técnica** confirma. Cadastro
de artes separado do disparo: nome/SVG/campos/fade/hold, escopo canal/global,
criar/editar/excluir. SVG fica em textarea escapado, não inserido/executado no
DOM. Cadastro continua montado ao ocultar, preservando rascunho. Alterar a
lista não renova a prova do formulário antigo; remover outra arte conserva a
prova e bloqueia save stale. Reabrir/trocar escopo/iniciar novo rascunho é
explícito, com confirmação de descarte. Respostas antigas/desmontadas são
ignoradas; refs bloqueiam ações duplas e ocupação é compartilhada entre GC e
cadastro. Cleanup permite nova leitura em StrictMode sem aplicar resposta
antiga. Falha preserva lista/campos e exige reabrir, nunca afirma lista vazia.
Disparo/retirada não são rotulados como no ar confirmado por mero HTTP aceito.

Verificações e reparos:

- 67 testes novos: domínio 33, HTTP 17, migração 7, API 8, markup 2.
- Primeira direcionada: 3 arquivos, 161 PASS/4 FAIL de 165, início 20h30m28
  BRT, 45,09s. Quatro snapshots de rollback foram feitos antes de runtimeFor,
  que semeia as três artes padrão. Snapshot movida para depois da inicialização;
  nenhuma guarda/counter/asserção de rollback de produção foi enfraquecida.
  Projetos 115/115 e domínio 33/33 passaram já nessa tentativa.
- Repetição: 8 arquivos/112 PASS, início 20h32m14 BRT, 49,55s, incluindo acesso,
  vault/backup, checkpoints e todos os novos casos. Tipos finais PASS.
- Build servidor/web PASS, 156 módulos; JS 945,59 kB/gzip 250,29 kB. Aviso de
  chunk permanece; não é prova de desempenho/scopes/áudio. Integral iniciada
  com um worker sem build/verificadores concorrentes. Primeira integral terminal:
  191 arquivos (189 PASS/2 FAIL), 1776 testes (1773 PASS/3 FAIL), início
  20h36m42 BRT, 805,19s. Todos os 67 novos passaram. Preset excedeu timeout
  5000ms e o seguinte não teve preset na resposta; teste usava configuração real
  e podia descobrir runtimes/destinos da instalação apesar de verificar DB/HTTP.
  Fixture passou a desativar engine/MediaMTX/dispositivos como as outras rotas,
  com asserção de transporte não nativo e status antes de ler resposta. Título
  corrigido para aplicação ao perfil, não prova de engine físico. Sem mudança
  de produção ou aumento do timeout para esconder falha.
  Ensaio privado Windows recusou publicar por não confirmar ACL em ~5s; causa
  exata não comprovada pelo erro genérico existente. Guarda/ACL/deadlines não
  foram afrouxados. Repetição isolada: 2 arquivos/8 PASS, início 20h51m06 BRT,
  43,10s, incluindo permissões REAIS e watcher. Presets 1179ms, configuração
  privada 31242ms. Não eliminar o registro da primeira falha nem declarar raiz
  diagnosticada por uma repetição verde. Repetição integral PASS registrada abaixo.

`scripts/verify-graphics-reviews.mts` PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-graphics-reviews-JihJIy`,
HTTP 62054/62055, PIDs próprios 30908 e 26824→29236. Dois processos compilados,
mesma revisão/vencedor único, CRUD/slate cegos, transferência de owner e prova
estrangeira recusados. Unicode, ABA local e ABA global da escolha de slate,
quatro rollbacks SQL reais CREATE/UPDATE/DELETE/SLATE e remoção vinculada
recusada. CUE/TAKE só explícitos na fixture SIMULATED; editar/template/slate
preserva PGM tocando e PVW distinto. Restart conserva ETag e backup integrity/
FK passa. Próprios filhos/listeners encerrados. Sem navegador, SVG renderizado,
mídia decodificada, DeckLink/NDI/OMT externos, replicação ou promoção HA.

Regressão compilada de projetos na mesma build SEC-22E também PASS:
`C:\Users\fsda\AppData\Local\Temp\RPlayout-project-isolation-xWEU0z`,
HTTP 49695/PID próprio 2352. Verificador inclui graphics_versions (migração 28)
nas snapshots de rollback, além de counters 21/24/25/26/27/editoriais. Contrato
semântico, faixas sobrepostas recusadas em captura/prévia/commit, adjacentes
restauradas, isolamento/ABA/reuso, dois rollbacks, eventos e backup PASS.
Filho/listener próprios encerrados, SIMULATED, sem navegador/mídia/hardware/HA.
Tipos finais após reparar a fixture de presets PASS. Segunda integral terminal:
191 arquivos/1776 testes PASS, início 20h54m33 BRT, 733,26s. Um worker,
sem build/verificador concorrente. Presets 3/3 e configuração privada 5/5 PASS;
a primeira recusa de ACL continua sem causa exata comprovada.

SHA-256 server.cjs:
`96A588FA4B52F1CD5FAAD81273B32921DF4909C7792B408418AF460D4264786C`.
Web `index-CGJ4Iwwl.js`/`index-DJjEZI1i.css`. Engine inalterado/conferido:
`5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
Diff --check apps/packages/scripts/docs PASS; não inspecionado arquivo protegido
mediamtx.yml nem contornados bloqueios anteriores de QA4041/navegador.
Sem Rust/novo ensaio nativo, QA4041/release/pacote final/commit/push atualizados.
Último checkpoint remoto registrado c0e350e; sem nova consulta ao GitHub.

Próximo: administração de usuários/acesso/sessões/bootstrap, depois acervo/
integrações e comandos operacionais com contrato próprio. Inspeção read-only
das rotas atuais confirmou auditoria de criação/revogação fora da alteração:
precisa revisão original, autorização fresca/lock e auditoria atômica, não só
mais logs. Preserve último admin e reconfira bootstrap após hash assíncrono.
Achado adicional para continuidade de artes: ensureDefaultGraphics ainda consulta
por nome e insere fora de uma operação atômica única. Pode recriar uma arte padrão
removida/renomeada e usa nome de arte local para deduplicar global; concorrência
de inicialização ainda precisa de prova/contrato. CRUD/revisão desta etapa não
equivale a fechar o bootstrap das artes. Corrigir inicialização única por escopo,
sem apagar/renomear dados existentes nem duplicar defaults entre processos.
Continuam banco separado, promoção/fencing/handoff/rejoin/failback, mixes/trims/
live no reserva, hardware/navegador externos, falhas/soak e Windows limpo/pacote
final. Objetivo permanece ativo, não 100% homologado.

## SEC-22F — inicialização única das artes, 05/10/2026

Fecha o achado de bootstrap de artes registrado em SEC-22E. Migração 29 adiciona
graphics_initialization compartilhado (G, separado do canal chamado G), com
PENDING/INITIALIZED e timestamp consistente. Registro final não pode ser apagado
ou reiniciado por SQL comum. Startup/backup conferem contrato exato da tabela,
dois triggers e marcador; dano marcado é recusado, não curado por recriação.

Somente banco verdadeiramente vazio antes da primeira migração pode inicializar
defaults. Instalações existentes, inclusive sem artes, com nomes alterados ou
anteriores ao controle de migrações, são adotadas sem criar/remover/modificar
templates. Não há tentativa de deduzir intenção editorial pelo nome. Duplicatas
legadas permanecem para correção explícita; IDs/conteúdo/referências preservados.
Uma inicialização interrompida antes de registrar migração 29 pode ser adotada
como existente na próxima abertura: prefere não inventar padrões a recriar dados.

ensureDefaultGraphics agora é IMMEDIATE antes da leitura de marcador/catálogo,
sem await entre check/INSERT. Deduplicação inicial só por nome compartilhado,
nunca pelo nome local. Inserts/counters/marker são um commit único; falha em
qualquer INSERT ou na marcação reverte tudo. Após INITIALIZED, chamadas,
segunda conexão, reinício e restauração não recriam excluídas/renomeadas.
Sem engine/TAKE/disparo novo, alteração de canal ou auditoria editorial fictícia.

Validação:

- 20 testes novos. Primeira direcionada: 4 arquivos/49 testes, 47 PASS/2 FAIL,
  21h09m33 BRT, 24,41s. A edição da lista de migrations omitiu chamada de timing
  (13); restaurada, sem reduzir a asserção de todas as versões. Falha de marcador
  vinha encapsulada por Drizzle: teste agora exige causa MARKER_FIXTURE e rollback
  integral, não apenas qualquer erro. Dois casos adicionais pré-baseline incluídos.
- Repetição direcionada: 4 arquivos/51 PASS, 21h11m09 BRT, 23,22s, incluindo
  vault/backup, checkpoints e 17 casos HTTP de artes. Tipos finais e build PASS.
- Build: server.cjs SHA-256
  E93A8B97DAF9EE0B9BCC9016CD624AAA3124805134B8148C92B8F2E7C0EA1168;
  web index-mMcIYN7A.js/index-DJjEZI1i.css, 156 módulos, 945,59kB/gzip250,29kB.
  Warning de chunk continua. Engine inalterado; nenhuma nova qualificação Rust.
- Primeira invocação do verificador via pnpm exec tsx não encontrou executável
  na raiz (nenhum servidor criado); usado o runtime dev já existente no servidor,
  como documentado. Não acrescenta tsx/tsc à execução do pacote de produção.
- Primeiro compilado Zti2Yu falhou na snapshot completa após restart com as-run
  ativo: só channel_project_versions de a avançou 19→20. Banco isolado confirma
  linha as_run encerrada RESTART; AsRun.reconcileAfterStartup atualiza linhas
  abertas por canal e o trigger de projetos invalida revisão. Artes/marker e
  revisions de artes permaneceram idênticos. Verificação integral de restart
  movida para ANTES de abrir as-run, conservando comparação de todos os counters;
  verificações de rollback e preservação de PGM/PVW não foram reduzidas.
- Repetição compilada a0tfx2 PASS, pasta Temp RPlayout-graphics-reviews-a0tfx2,
  HTTP 52693/52694, PIDs próprios 27580,22300,9620,28956. Dois processos iniciados
  em paralelo, catálogo inicial único, edição/exclusão preservadas após restart,
  CRUD/slate revisões/ABA/Unicode, quatro rollbacks, PGM/PVW e backup PASS.
- Compilado de projetos hYc30X PASS, Temp RPlayout-project-isolation-hYc30X,
  HTTP 52922/PID16600. Snapshot inclui graphics_initialization; captura/restore
  audit/counters, isolamento, sobreposição/adjacência, eventos, stale/reuso e
  backup PASS. Os dois ensaios são SIMULATED, próprios filhos/listeners encerrados;
  não provam SVG/renderização, navegador, mídia, sinais externos ou HA.
- Nova integral terminal PASS: 192 arquivos/1796 testes, início 21h16m04 BRT,
  682,42s, um worker, sem build/verificadores concorrentes. Todos os 20 novos
  e os casos de permissão real Windows passaram. Não reatribuir a integral 1776
  da SEC-22E à F. Diff --check apps/packages/scripts/docs e hashes finais PASS.

Pendência confirmada pela inspeção/ensaio: reconciliação de as-run fecha por canal,
sem identidade do processo dono. Outro servidor ainda ativo no mesmo banco não
é necessariamente um órfão. Fechar contrato de identidade/fencing/recuperação
antes de anunciar suporte a operação multi-processo ou HA; não anunciar os dois
processos de teste como redundância homologada. Administração/acervo/integrações,
comandos operacionais, DB separado/HA, hardware, navegador, soak e pacote final
continuam pendentes. Nenhuma publicação/push/release/QA4041 nesta etapa.

## SEC-22G — administração conferida e sessões atômicas, 05/10/2026

Migração 30 acrescenta account_versions com escopos distintos de catálogo,
conta e sessões. Nove triggers cobrem INSERT/UPDATE/DELETE, incluindo mudança
de dono, atualização igual e ABA. Tombstones conservam revisão quando ID é
reutilizado. A abertura/restauração confere DDL/triggers/marcadores e todas as
revisões referenciadas; dano marcado é recusado, não curado silenciosamente.

Consulta de contas entrega apenas identidade, papel, habilitação, política e
revisão. Consulta de sessões entrega somente datas, nunca token/digest/hash.
GETs usam snapshot e private/no-store. Criar exige a revisão original do catálogo;
perfil/acesso exigem catálogo+conta; revogar exige conta+sessões. Ausência 428,
formato/dono incorreto 400, alteração desde conferência 409. Login não invalida
o catálogo, mas uma nova sessão invalida sua conferência de revogação.

Criação/perfil/acesso/revogação/logout reconferem sessão/papel/estação/dono
dentro do writer IMMEDIATE. Hash assíncrono não estende autorização: antes e
depois são conferidos o mesmo ator e a mesma prova original. Escrita, counters,
sessões e decisão de auditoria são um commit; falha em auditoria reverte todos.
Perfil/acesso encerram somente sessões da conta alterada. Revogação vazia também
consome sua prova, sem desabilitar conta. Logout só elimina a sessão apresentada;
cookie só é apagado depois do commit. Tentativas HTTP continuam auditadas
separadamente como API_MUTATION, sem credenciais nem falso sucesso de domínio.

Último administrador ativo/acessível é protegido; candidatos desabilitados,
restritos por canal ou sem estação válida não justificam removê-lo. Não se pode
remover a própria estação nem promover conta com restrição de canais sem
retirá-la explicitamente primeiro. Bootstrap local exige instalação realmente
sem contas, loopback e papel ADMIN. Bootstrap por credenciais configuradas
reconfere ausência após hash; contas existentes, até desabilitadas/inválidas,
não abrem caminho para inventar administrador de recuperação.

UI de usuários separa editar/marcar de salvar. Campos mantêm sua revisão de
abertura; sucesso em outra operação não renova rascunho antigo. Erro preserva
lista/campos e bloqueia até reabertura explícita com aviso de descarte. Sessões
são primeiro conferidas e só depois encerradas. Escritas simultâneas/duplo clique
e respostas antigas de componente desmontado são bloqueadas. Senha digitada
não é exibida na consulta; própria revogação/bootstrap exige novo login. SSR e
contratos de requisição testados; foco/modal/navegação visual ainda não homologados.

Validação e evidências:

- 87 novos testes em seis arquivos: domínio 40, HTTP 21, migração 8,
  bootstrap 7, contrato web 10 e markup SSR 1.
- Primeira direcionada: 73 testes, 64 PASS/9 FAIL (23h31m22 BRT, 27,41s).
  Snapshots de domínio foram afetados pelos registros legítimos API_MUTATION
  de tentativas recusadas. Preservada a auditoria de produção; comparação
  separa tentativa HTTP de decisão aprovada, e testa os status 428 registrados.
- Segunda direcionada: 121 testes, 117 PASS/4 FAIL (23h34m07, 56,66s).
  Testes web liam Headers como objeto simples; corrigida somente leitura
  via new Headers(...).get('If-Match'), sem renovar prova nem alterar API.
- Direcionada final: nove arquivos/121 PASS (23h36m53 BRT, 48,49s), incluindo
  acesso, checkpoints e vault/backup. Tipos finais e build PASS. Diagnóstico
  anterior de parsed.data na closure foi corrigido com input validado capturado.
- Build server.cjs SHA-256
  07FDB985D74AAAB832921A50342360E44BB8B1DF8BC1E30AA4729A0F674A0423;
  web index-CzWsqQXh.js/index-B4rEKMaE.css, 158 módulos, 944,91kB/gzip250,63kB.
  Warning de chunk >500kB permanece. Engine inalterado, sem nova prova Rust.
- Verificador scripts/verify-account-reviews.mts corrigido antes da execução:
  Node WebSocket global não envia cookie customizado; usado ws do workspace,
  autenticado com cookie da fixture. GET /api/state não possui live: comparação
  de PGM/PVW usa telemetria WebSocket real, não snapshot HTTP fictício.
- Compilado b3GGxR PASS, Temp RPlayout-account-reviews-b3GGxR, portas
  56689/56690, PIDs próprios 9512,29772,9700. Consulta estável/sem segredos,
  quatro escritas cegas recusadas, vencedor único entre dois servidores,
  ABA/campos forjados/último admin recusados, sessão nova invalida prova,
  cinco rollbacks inclusive logout sem cookie, revogação imediata de HTTP,
  PGM/PVW preservados, revisões após restart e backup PASS. Ambos filhos e
  listeners próprios encerrados. SIMULATED, sem mídia decodificada, browser,
  sinal físico ou replicação/HA; dois processos no mesmo SQLite não são HA.
- Integral terminal PASS: 198 arquivos/1883 testes, início 23h42m33 BRT,
  240,95s, até quatro workers limitados pela configuração Windows existente.
  Casos reais DPAPI/ACL e todos os novos testes passaram.
  O início coincidiu com o fim do verificador compilado: registrar esse fato,
  não anunciar execução inteiramente isolada. Tipos/build já estavam terminados.
- Complemento compilado N0huIK PASS na mesma build, Temp
  RPlayout-account-reviews-N0huIK, HTTP54404/54405, PIDs27096/5412/1880.
  Além de repetir todas as proteções/rollbacks/backup/PGM/PVW, abriu sockets
  autenticados do operador antes de alterar política e antes de revogar sessões:
  ambos encerraram com 4401, HTTP antigo recusado imediatamente. Admin e canal
  permaneceram ativos. Verificador de autenticação ywtS43 também PASS na mesma
  build: HTTP54607, PIDs1772/11408/28432, papel/configuração inválidos recusados,
  rollback da emissão sem cookie, socket4401 e sessão válida após restart.
  Todos os próprios filhos/listeners encerrados. Esses complementos rodaram
  após a integral, em paralelo entre si, sem build concorrente; SIMULATED,
  não provam navegador/hardware/mídia/HA. Diff/check e hashes finais conferidos.

Limites/continuação: alteração bruta de senha/política por SQL externo avança
revisão, mas não possui vínculo de sessão à revisão de credenciais; API oficial
revoga atomicamente. Política JSON legada inválida bloqueia leitura sem reparo
automático: precisa fluxo explícito de saneamento/restauração. Recusa de bootstrap
configurado é resposta sem cookie, mas sua trilha LOGIN_FAILED específica ainda
precisa consolidação (API_MUTATION existe). Acervo/integrações e comandos
operacionais continuam abertos, assim como dono/fencing de as-run, DB separado,
HA, hardware, navegador/soak e pacote Windows final. Nenhuma alteração de
QA4041/release/ZIP/commit/push nesta etapa; bloqueios anteriores não contornados.

Achado read-only para próxima frente: DELETE /api/assets/:id com force=1 e
POST /api/assets/prune ainda removem itens da grade em operações separadas,
sem revisão original/decisão atômica própria. A UI confirma somente a quantidade
da primeira resposta e pode aplicar force sobre usos novos; limpeza não congela
lista de impacto. PGM/CUE/publicações/histórico/canal arquivado precisam de
proteções próprias, não presumir que refresh posterior restaura o que foi
removido. O arquivo em disco não é apagado por DELETE, mas linhas editoriais
podem ser: registrar distinção. PATCH de título/categoria também não exige
revisão de acervo (QC tem seu contrato separado já implementado).

Próxima implementação em partes: primeiro revisão de metadata/categoria;
depois conferência de remoção/limpeza com IDs, usos, revisões das grades e
estado operacional real, recusa de revisão superada/ABA/novo uso e commit de
auditoria+mudanças juntos. Bloquear itens em PGM/CUE e canais arquivados;
preservar snapshots publicados/as-run e eventos/referências. Não usar force=1
como autorização nova nem ler lista atual para aprovar confirmação antiga.
Cobrir falha entre remoções, dois operadores, revogação durante await e
preservação de arquivo/PGM/PVW. Raízes/scan e integrações vêm depois com
contratos próprios. Esta inspeção não removeu nem editou dados operacionais.

## SEC-22H — edição conferida de metadata compartilhada, 06/10/2026

Título/categoria são dados do acervo global, não aprovação QC, título editorial
da linha nem nome do arquivo no disco. GET metadata-review entrega somente ID,
título, categoria, revisão e canEdit, em snapshot privado/no-store. Não retorna
caminho, hash, declarações técnicas ou notas QC. Conta restrita pode consultar,
mas não altera dados de todos os canais por canal forjado em body/query.

PATCH metadata exige asset-metadata:<ID codificado>:<counter original>. A
migração 23 existente já avança por toda alteração de ativo/decisão QC, inclusive
mesmo valor e tombstone; usa-se esse counter real com namespace distinto.
Ausência 428; formato/arquivo/operação inválidos 400; mudança/ABA 409. Prova QC
não autoriza metadata, nem vice-versa. Conteúdo/mídia/QC editados desde a
conferência invalidam rascunho, mesmo com hash restaurado. Isso não detecta por
si só alteração em disco ainda não observada pelo ingest e não aprova mídia.

Corpo estrito com título e/ou categoria, limites 512/128, espaços exteriores
retirados somente dos valores explicitamente enviados. Categoria null remove;
campo ausente preserva. Legado salvo não é normalizado na consulta. Caminho,
hash, QC, IDs/dono e outros campos extras são recusados. PATCH legado de ativos
delega metadata ao mesmo contrato, sem await antes de capturar autoridade e
sem combinar operações. Corpo vazio ou somente expectedContentHash é recusado.

Writer IMMEDIATE antecede autorização/leitura: reconfere cookie, dono da sessão,
habilitação, papel, estação e acesso compartilhado. Atualização/counter e
ASSET_METADATA_CHANGED com antes/depois e ator real são um commit. Falha na
auditoria reverte metadata e todas as revisões; não há refresh/CUE/TAKE/rebuild,
mudança de arquivo, linha editorial ou decisão QC. Push da visão é pós-commit;
falha informa metadados gravados com aviso, sem alegar rollback.

MAM da tela de playlist e detalhe do item abrem Conferir título/categoria, sem
autosave por select/contexto/prompt. Editor carrega snapshot, mantém campos e
prova até salvar/reabrir explicitamente, recusa duplo envio/respostas antigas
após desmontagem, confirma descarte de rascunho e não presume acervo vazio em
erro. Consulta falha bloqueia, reabrir exige confirmação; sucesso próprio avança
só sua base de metadata. Atualização de lista não substitui a prova do formulário.
Título/categoria da resposta podem atualizar o rótulo local, mas não elevam
qcRevision de um asset com hash/declarações de snapshot antigo. Lista mais nova
supera override antigo. Categoria nova usa o rótulo, sem acionar cadastro de cor
ou outra mutação implícita. Explorer legado usa o mesmo editor; callback morto
de categoria automática removido de App. UI modal/foco não homologados em browser.

Validação:

- 64 testes novos: domínio 40, HTTP 15, web original-proof 8 e SSR 1.
- Primeira direcionada: sete arquivos/101 testes, 60 PASS/41 FAIL,
  23h58m26 BRT em 05/10, 49,84s. Fixture de dois ativos repetia path único;
  corrigidos caminhos distintos. Fixture live inseria source_ref plaintext
  após abrir app/cofre; passou a inserir via Drizzle/campo protegido existente.
  Não foi relaxada unicidade nem proteção de segredos.
- Segunda: 101 testes, 99 PASS/2 FAIL (00h00m25 BRT, 96,16s). Asserção esperava
  outra em vez de outro na mensagem de erro; ajustada, preservando comparação
  de dados/counters. Comparação total de transport falhou só porque elapsed
  passou 4→5 enquanto PGM continuava no ar. Teste agora exige avanço monotônico
  e igualdade de TODOS os demais campos, incluindo início do PGM, CUE e Próximo;
  não congela reprodução para fingir estabilidade.
- Direcionada final: sete arquivos/102 PASS (00h02m57 BRT, 42,60s), incluindo
  22 de revisão QC, quatro de workflow e 12 de Fase E. Acrescentado caso de
  corpo só expectedContentHash. Prova com outro writer confirma SQLITE_BUSY
  durante a própria autorização, não só inTransaction. Tipos finais PASS;
  diagnósticos anteriores de teste foram corrigidos usando comandos HTTP reais
  e runtime não nulo. A mudança final de despacho síncrono legado será coberta
  também pela integral desta build; não atribuir a rodada anterior à mudança.
- Build PASS: server.cjs SHA-256
  598AD94A0B99620AEC0CF946C20EC02CC232128D1103EE27BB0E6174675487CE;
  web index--0KAGroX.js/index-CAZIMpiP.css, 161 módulos, 948,43kB/gzip251,55kB.
  Warning >500kB permanece. Engine SHA-256
  5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009,
  inalterado, sem nova qualificação Rust/nativa.
- Compilado metadata 9c8WXC PASS, Temp RPlayout-asset-metadata-9c8WXC,
  HTTP62830/62831, PIDs17992/22480/28396. Dois processos/vencedor único,
  ambos endpoints cegos recusados, ABA/QC proof/mix recusados, rollback de
  auditoria, restart/counter inteiro antes de abrir as-run, backup,
  título editorial/QC/hash/path preservados; PGM playing=true e startedAt
  conservados, elapsed monotônico e preview distinto preservado via WS real.
  SIMULATED/asset indisponível placeholder, não decoder/mídia/hardware/HA.
- Revisão dos verificadores encontrou comparação onAir.playing em contas/artes:
  o campo verdadeiro é transport.playing. A comparação antiga undefined==undefined
  não comprova reprodução. Corrigidos os dois, exigindo playing=true e startedAt
  igual. Não atribuir essa prova nova retroativamente à G/F/E. Compilado de contas
  EkYJpN PASS nesta build H, HTTP63040/63041, PIDs12832/24716/23980,
  cinco rollbacks, proteção/admin/concorrência/restart/backup, dois sockets4401
  e preservação real do flag de reprodução/início do PGM. Metadata/contas rodaram
  em paralelo entre si depois da build; próprios filhos/listeners encerrados.
- Regresso compilado de artes DaVbDD PASS na mesma build H, Temp
  RPlayout-graphics-reviews-DaVbDD, HTTP63249/63250, PIDs14328/17508/19768/5680.
  Flag verdadeiro playing e startedAt exigidos além do preview, quatro rollbacks,
  revisão/ABA/dono/Unicode/vínculos, restart/defaults e backup PASS. Próprios
  filhos/listeners encerrados. SIMULATED, sem SVG/render/browser/mídia/hardware/HA.
- Primeira integral H iniciada depois dos três ensaios terminarem, com tipos/
  build já terminados; sem build/verificador concorrente. Terminal: 202 arquivos,
  201 PASS/1 FAIL, 1947 testes, 1945 PASS/2 FAIL, 00h10m05 BRT em 06/10, 228,37s.
  Falharam publicação concorrente/revogação e janela do watcher, ambas recusadas
  pela proteção Windows do arquivo privado. A publicação da operação que
  falhou foi recusada; a configuração anterior é mantida. Isso não prova que
  nenhuma chave tenha sido publicada por uma operação anterior nem que uma
  revogação recusada já tenha sido aplicada no MediaMTX.
  Helper continua com limite de 5s e verificação completa das ACLs. Erro antigo
  não distingue timeout/recusa do SO; causa exata não comprovada. Repetição
  isolada dos cinco testes: 5 PASS, 00h16m52 BRT, 31,28s, um worker. Isto não
  apaga a falha nem é diagnóstico retroativo da primeira rodada.

### Complemento SEC-22H — biblioteca live e varredura concorrente, 06/10/2026

Entradas de rede/hardware compartilham a lista, não identidade de arquivo MAM.
Menu de live abre Configurar entrada ao vivo; não oferece metadata/ignorar QC.
O handler também recusa pseudo-asset live e as chaves React incluem a natureza,
evitando colisão de ID com arquivo. Arquivo da categoria Ao Vivo continua sendo
arquivo. Nome da entrada continua vindo do seletor canonical e aparece abaixo
dele; não é alterado pelo editor de metadata. Sem homologação visual nesta etapa.

Achado confirmado: absorb capturava título/ignorado/QC/loudness antes de aguardar
hash/probe, depois escrevia a cópia antiga. Agora a análise demorada fica fora do
lock; merge síncrono relê o ativo atual sob writer IMMEDIATE. Mesmo hash preserva
título/categoria, ignorado, decisão QC/notas/data e loudness atuais. Novo conteúdo
fica PENDING e não herda aprovação/medição antigas. Probe falho continua FAILED,
sem perder metadata/ignorado atuais. Outra estação cadastrando o mesmo caminho
é reconhecida sem duplicação; ID inicialmente existente removido/substituído/
movido não recebe a resposta atrasada. Counters avançam pelo trigger existente.
Workflow recebe dados recém-gravados somente após commit. Não se anuncia por
isso ingestão/filas/QC inteiramente concluídos: enqueue ainda é pós-commit e
política de erro de absorbSafely/epochs de remoção-reinserção precisam revisão
na frente de limpeza/ingestão. Não é homologação de decoder ou arquivo real.

Validação do complemento:

- Oito novos testes de concorrência pausam a sonda, alteram decisões durante a
  espera e verificam o merge. Outra conexão SQLite realmente recebe SQLITE_BUSY
  ao tentar escrever na releitura; o teste direto de absorb verifica que erro
  no UPDATE reverte dados/counter, não enfileira versão nem incrementa sucesso.
  O wrapper absorbSafely tem a política de erro separada citada acima; não
  atribuir a ele esse rollback sem mudança posterior. Dois novos testes
  web distinguem live/arquivo de mesmo ID e arquivo na categoria Ao Vivo.
  Total H: 74 novos testes (40 domínio, 15 HTTP, 8 ingestão, 10 web, 1 SSR).
- Primeira execução do complemento: 18 PASS, 00h21m00, 7,14s. Tipos apontaram
  enum inválido somente na fixture (APPROVED_WITH_WARNING); corrigido para o
  estado real APPROVED_WITH_NOTES, sem aceitar enum inválido em produção.
  Merge extraído para helper síncrono, e fixture aguarda sua própria sonda em
  caso de falha de mutação. Essas mudanças foram revalidadas nas rodadas abaixo.
- Direcionada: oito arquivos/99 PASS (00h22m39, 58,91s), incluindo dez testes
  de varredura, três de versões duráveis e 12 de Fase E. Dois caminhos pedidos
  nessa invocação não existiam e não foram coletados; não contar como aprovação.
- Complemento direcionado com nomes corretos: quatro arquivos/44 PASS
  (00h24m47, 20,24s), incluindo 22 de revisão QC e quatro de workflow QC.
  Oito ingestão/dez web repetem a rodada anterior: união é 10 arquivos/125
  testes distintos, não 143. Tipos finais PASS. Build PASS, 161 módulos,
  index-DpojKwrr.js 948,96kB/gzip251,73; warning >500kB permanece.
- Build final H server.cjs SHA-256
  FD7AB194AADFAE1FCE679184CA79B045F6C875C822F7CC271AE6D400B8EB1905;
  JS SHA-256 246D00A16592EB3073343A3601F57EBAE7D3730C2927E8C7C05813A4C98280FD;
  CSS SHA-256 206425A5D9F95642F6FB76A9788A8938E9F6DA1851239270918FCB7CB79B1422;
  engine 5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009,
  inalterado.
- Primeira tentativa do compilado metadata cxJA3C falhou antes de iniciar os
  servidores, na criação de cofre próprio Windows/DPAPI (limite atual 10s).
  Não foi substituída chave nem desligada proteção. Causa exata não comprovada;
  contas rodavam em paralelo, sem build/testes concorrentes. Verificação de
  inventário de processos via CIM no sandbox foi recusada; não contornar isso.
- Compilado contas A8yKEo PASS, HTTP51858/51859, PIDs15076/30668/17560.
  Compilado metadata repetido isoladamente tRbSQP PASS, HTTP64989/64990,
  PIDs29968/24412/17068. Artes depois deles: ZsVUNC PASS, HTTP57965/57966,
  PIDs17024/12756/15068/11864. Todos conferiram SHA server FD7AB194... atual,
  restart/backup/revisões/rollback/concorrência e preservação de PGM/PVW
  SIMULATED. Contas: dois sockets4401. Próprios filhos/listeners encerrados.
  Não validam a sonda nativa, SVG, navegador, mídia física nem HA.
- Integral final H iniciada após os três compilados terminarem, um worker,
  sem build/verificador concorrente e sem mudança de fonte durante a coleta.
  Resultado terminal PASS: 203 arquivos/1957 testes, início 00h29m35 BRT,
  duração 815,22s (transform 11,53; collect 214,21; tests 417,52; prepare 65,77).
  Inclui cinco testes de arquivo privado/ACL e cinco de cofre/DPAPI, com os
  limites de produção originais. Nenhuma fonte/teste foi editada durante esta
  rodada. O PASS final não identifica retroativamente as causas das recusas
  anteriores nem as apaga. Tipos/build/compilados também são da fonte final H.
  Sem homologação física/visual/nativa nova, deploy, pacote final, commit/push.

Inspeção adicional somente leitura confirma: DELETE/prune consultam só media_id
em rundown_items. Publicação também usa liveFallbackMediaId e
liveConfig.fallbackMediaId; proteger esses usos na conferência de remoção, além
dos diretos, snapshots, eventos e as-run. Não foi removido conteúdo operacional.

Objetivo amplo permanece ativo. Próximo: remoção/limpeza com impacto e revisões
de todos os usos; preservar PGM/CUE/Próximo, grades arquivadas, publicações,
eventos/as-run e arquivo físico. Cadastro/cores/remoção de categorias, raízes,
scan e integrações continuam sem este contrato próprio. Não inferir que counter
23 substitui essas confirmações. Seguem as pendências de writers externos/
sessões, as-run/dono/fencing, DB separado/HA, hardware, browser, soak e pacote
Windows final. Nenhum deploy/QA4041/ZIP/release/commit/push nesta etapa.

## SEC-22I — remoção/limpeza conferidas, 06/10/2026

Implementação local de software, sem fechar o escopo amplo:

- Migração 31 com baseline único e 21 triggers verificados em abertura/restore.
  Ativos e vínculos media_id/live_fallback_media_id têm counters reais, inclusive
  same-value, ABA e tombstones. Publicações, projetos/conversões/políticas e
  proteções operacionais possuem escopos duráveis; revisão ausente não vira 0/1.
- GET removal-review/prune-review é privado/no-store, sem mutação, path/hash,
  segredo ou notas QC. Prova MAC separada, vinculada à operação/alvo e autoridade
  atual (conta/sessões/estação), revisões de grades/canais e operação estável.
  Elapsed/meters não invalidam revisão continuamente. Nome de fonte não é ID de
  arquivo: referências são percorridas por campos específicos, não por texto.
- DELETE force=1 ou escopo forjado recusados. Original obrigatória, corpos
  estritos e IDs únicos da conferência. PRUNE só subconjunto de vídeos com falha
  e extensão de vídeo reconhecida, não imagens. Usos exigem confirmação explícita.
  Sem omitir protegidos silenciosamente: permanecem visíveis e não selecionáveis.
- Remover ativo oculta registro; uso direto remove item/cues/eventos editoriais.
  Fallback apenas desvincula liveFallbackMediaId e mantém o live/eventos. Limpeza
  apaga registros selecionados. Arquivos, publicações/snapshots, as-run e outros
  históricos não são apagados. Auditoria e todas as linhas/counters um IMMEDIATE;
  falha auditada reverte inclusive exclusões múltiplas. Não publica ou executa TAKE.
- Publicações ativas/legadas sem mídia congelada, projetos/conversões para PRUNE,
  canais arquivados, as-run aberto, checkpoints, retornos, políticas e comandos
  duráveis inconclusivos bloqueiam conforme referência. Consulta local também
  protege PGM, CUE/PVW, Próximo/preroll e passagem/recuperação/configuração pendentes.
  Referência só em revisão antiga enfileirada também é protegida.
- Invalidação editorial síncrona pós-commit incrementa loadEpoch e impede async
  load anterior de reinstalar itens removidos. Não há await entre commit e esse
  fence. Falha de refresh/notify após commit informa gravado com aviso, não rollback.
- EngineTransport contabiliza enqueues imediatamente, inclusive antes do primeiro
  microtask e comandos que falham. Sequência estável invalida ABA de CUE no proof;
  simulador acompanha comandos/trocas, não o relógio de reprodução.
- UI MAM abre impacto, seleção e confirmação separadas. Checkbox de seleção limpa
  confirmação de vínculos; erro conserva seleção/prova e bloqueia nova aplicação
  até reabrir explicitamente. Nenhum retry automático. Callback não aplica snapshot
  de um canal antigo. Editor live não ganha ação de arquivo. Override local de
  ignorado vale só sobre a revisão/hash originais; dados novos do servidor vencem.

Evidência:

- Fonte intermediária: 81 testes novos, domínio42, HTTP9, migration8, browser-proof10, SSR2,
  override9 e fila-engine1. Direcionada 222 PASS (10 arquivos, 01h15m20 BRT,
  57,93s) e complemento final60 PASS (3 arquivos, 01h18m28 BRT, 23,73s),
  união223 distintos. Tipos e build PASS. Testes de sessão/estação foram adicionados
  após a rodada de222 e passaram no complemento; não ocultar essa diferença.
- Falhas de desenvolvimento preservadas: primeira direcionada117 PASS/1 FAIL,
  coluna inexistente na fixture item_graphics; primeira migration7 PASS/1 FAIL,
  fixture apontando para ativo ausente com FK. Fixtures corrigidas para schema real,
  sem relaxar constraints. Types inicialmente recusaram callback no componente
  errado e tabela it.each malformada; correções validadas nos tipos finais.
- Compilado kz7LTm PASS com server.cjs SHA
  55998E023B1B074F279BFDEA9A46E9CE10D16FDFCD45284E375649C5438F2E55.
  HTTP52311/52312, PIDs16012/7680/29320, filhos/listeners próprios encerrados.
  Duas instâncias, mesmo DB parado no teste concorrente: original estável,
  vencedor único, DELETE cego/force recusados, audit rollback, live fallback
  preservado, PRUNE de subconjunto sem imagens, restart/backup, bytes de placeholder
  intactos e PGM.playing/start/PVW SIMULATED preservados durante remoção futura.
- Antes do PASS: invocação root pnpm exec tsx não encontrou a ferramenta; usar
  pnpm --filter @rplayout/server exec tsx ../../scripts/verify-asset-removal.mts.
  PagKqo interrompido por reconciliação de dois arquivos ausentes na fixture,
  incluindo erro UV_HANDLE_CLOSING no encerramento do runner. f3ZKUk recusou409
  antes do audit porque o primeiro item era o Próximo protegido, não500 como a
  fixture esperava; PIDs19808/30588 e HTTP49670/49671 confirmados encerrados.
  Repetição com arquivos presentes e heads live independentes PASS; nenhum
  comportamento protetivo de produção foi relaxado. PagKqo executou finally de
  filhos, mas não chegou à verificação adicional de listeners: não presumir essa
  prova a partir da repetição posterior.
- Web index-C-sXoN9A.js SHA
  4D55EC22CC5CEC6DAEEEF8907343DD40ACB34619D942E80B1557A8409D3EA333;
  165 módulos,955,54kB/gzip253,79; aviso de chunk>500k permanece.
  CSS index-CAZIMpiP.css SHA
  206425A5D9F95642F6FB76A9788A8938E9F6DA1851239270918FCB7CB79B1422.
  Engine SHA5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009
  inalterado; não é nova build Rust ou homologação SDI/NDI/OMT.
- Primeira integral dessa fonte foi iniciada com um worker, sem build/verificador
  concorrente ou mudança de fonte durante a rodada. Documentação atualizada
  separadamente. Seus resultados e repetições constam abaixo; não usar o1957
  PASS integral H como prova da I.
- Primeira integral I terminal: 209 arquivos,207 PASS/2 FAIL;2036 testes PASS/2
  FAIL, início01h22m54 BRT,833,85s, um worker. As duas falhas foram fixtures:
  pré-conversão mantinha marca31 ao remover tabela de cadência; checkpoint esperava
  somente30 versões. Helper legado agora remove triggers/tabela/marca31 antes de
  representar schema antigo; checkpoint exige31 e o nome da migração. Nenhuma
  guarda/constraint de produção foi alterada. Reteste14/14 PASS,01h37m41 BRT,
  11,06s; tipos PASS. Regressão intermediária repetida terminou PASS:209 arquivos/
  2038 testes, início01h39m00 BRT,811,21s, um worker. Sem mudança de fonte durante
  a rodada, build/verificador concorrente. Esse resultado pertence à fonte
  SHA55998E..., anterior ao complemento QC/fases abaixo. ACL/DPAPI passaram
  com limites originais. ACL/DPAPI passaram na primeira integral I com limites
  originais; não transformar essa evidência em causa para falhas históricas H.

Complemento final de revisão:

- QC por canal escreve qc_decisions sem alterar media_assets; o proof passa a
  incluir o counter QC23 de cada ativo, em namespace privado da remoção. Oito
  testes novos cobrem inserção/same-value/ABA/exclusão de QC e quatro tipos de
  comando com fase inválida. Conferência recusa registros sem canal/fase válida,
  em vez de presumir que estado desconhecido é operação encerrada.
- Total89 novos: domínio50, HTTP9, migration8, browser-proof10, SSR2, override9,
  fila-engine1. Última direcionada117/117 PASS, sete arquivos,01h54m20 BRT,
  61,01s. Types inicialmente recusaram unknown na checagem de fase; narrowing
  explícito corrigido sem afrouxar enum/guardas. Types finais e build PASS.
- Compilado final kYCBbt PASS, server SHA
  66D17E3320C4D1121E67292E6FAC68EA4241FE570EE96EDE157542E4E61458AC.
  HTTP60544/60545, PIDs20916/22036/30756, próprios filhos/listeners encerrados.
  Além dos casos anteriores, a rota compilada recusa provas após QC por canal
  (inserção/same-value/ABA/exclusão sem alterar ativo) e fases inválidas dos
  quatro tipos de comando. Usa escrita controlada na fixture temporária,
  não é homologação do workflow QC, ownership nativo ou mídia física.
- Web final index-B9cvqlkL.js SHA
  751F8A595FF26312EBA0BD52C237C8B31952456FAAD403770C9594100249670A.
  CSS/engine e aviso chunk>500k permanecem inalterados. A build73126 anterior
  passou, mas tinha erro de types; não usá-la como build/tipos finais. A build
  atual é42596, após o reparo de narrowing, e types31721 terminaram PASS.
- Integral final iniciada somente após término do compilado: sessão24515,
  um worker, sem edições de fonte ou build/verificador concorrente. Resultado
  não observado: o handle24515 desapareceu antes do resultado terminal.
  Inventário posterior somente leitura não mostra os processos Node do teste,
  e os hashes compilados permanecem iguais. Causa/exit code desconhecidos;
  não reclassificar como PASS/FAIL. Integral repetida sem mudanças de fonte,
  um worker, com reporter JSON persistente em
  scratch/sec22i-full-20261006-0710-0ccfc5.json. Resultado terminal PASS:209
  arquivos/2046 testes, início07h07m14 BRT,867,80s, um worker. Reporter persistente
  conferido:success=true,2046 PASS,zero FAIL/pending e209 arquivos passed.
  SHA do relatório72F7FD5A048F82BD87C76A8A1CCFE8EAE84E012F17AE1D88AA41A97C499BA781.
  Inclui ACL/DPAPI com limites originais. Sem edição de fonte, build ou verificador
  concorrente durante a rodada. Hashes finais de server/web reconferidos iguais
  aos do compilado kYCBbt. Não atribuir esse PASS à sessão24515 não observada,
  nem mudar a atribuição dos2038 intermediários.

Limites/prompt: fencing/posse de processos nativos e as-run/PVW/preroll de outra
instância continuam pendentes; proof local não é uma cerca distribuída. Reavaliar
escala/custo da conferência síncrona em catálogo/publicações grandes. PRUNE remove
registro, não arquivo; scanner futuro pode reinseri-lo como novo ativo. Jobs e
epoch de ingestão/remoção/reinserção precisam workflow durável completo. Simulação
de timing, compensação e publicação seguem ações explícitas, não efeitos ocultos
do DELETE. Ainda faltam contratos de categorias/cores, raízes/scan, integrações,
segurança legada, banco separado, HA/promoção/failback reais, visual, hardware,
soak e pacote Windows final. Nenhum deploy/QA4041/ZIP/release/commit/push desta etapa.

## EXEC-01 — posse local de execução nativa, 06/10/2026

Trata o risco identificado após SEC-22I: abrir engine antes de possuir o canal,
encerrar as-run de outra instância por simples channel_id, sobrescrever o cursor
de PGM com runtime vazio/simulado e deixar o watchdog abrir outro processo após
erro não equivalente a exit. Não equivale a promoção HA ou exclusão de saída
física distribuída. A etapa anterior e seus resultados são históricos.

Contrato implementado:

- Migração32 cria runs assinados, slot por canal/epoch/tombstone e vínculo MAC
  de as-run→run. Schema/triggers/assinaturas/referências são verificados em
  abertura e restauração; marca perdida com tabelas não vira legado livre.
  Claim e decisão auditada sob IMMEDIATE; falha reverte dados/slot/auditoria.
- Identidade inclui vida do processo/boot e host opaco: MachineGuid no Windows
  ou machine-id no Linux validados e resumidos; nunca hostname. Se não houver
  identificação válida, fallback confia somente nesta vida do Node. Identidade
  de SO clonada não é testemunha externa nem prova física de outro host.
- Dono ativo, processo vivo/reutilizado/erro desconhecido, host remoto e reserva
  sem PID permanecem protegidos. Não há timeout que transfira posse. A espera
  monotônica limitada é somente pela saída de child explicitamente fechado
  pelo mesmo manager; não é vencimento de lease de terceiro.
- Antes do spawn, registrar geração. Callback com PID não confirmado mata só
  o child próprio; seus listeners de error/exit já estão registrados. Erro com
  PID não o retira do fence; exit só aceita PID/token correspondentes. Callback
  antigo, close antigo ou PID reutilizado não libera geração/dono novos.
- Fences antes da fila e após await Ready/preroll, imediatamente antes de
  escrita no pipe. Watchdog não abre segundo child sem saída confirmada.
  Só handles/PIDs comprovadamente criados por fixtures são mortos em ensaios.
- Checkpoint grava ownerRunId e exige posse. Runtime vazio não equivale a STOP
  do predecessor: preservar cursor playing até quadro/STOP nativo confirmados.
  Recuperação só adota cursor atual/predecessor comprovadamente parado.
- As-run nativo exige lease, vincula cada linha por MAC e encerra/reconcilia
  somente dono atual/predecessor exato. Legado desconhecido continua aberto,
  não recebe ended_at fabricado. Simulação não altera histórico/cursor nativos.
- GET execution-ownership é privado/no-store, somente leitura, sem IDs/PIDs/
  boot/assinaturas; respeita sessão/estação/canal e declara physicalOutputValidated
  e promotionReady false. Transporte de peer bloqueado retorna409, não404 de
  canal inexistente; consulta não cria engine/cursor/lease nem corrige dados.
- Remoção pela instância não dona bloqueia acervo enquanto PGM/PVW/preroll
  estrangeiros não puderem ser verificados; slot/run/geração integram prova
  original. Liberação com child vivo/pending continua protegida.

Validação desta fonte:

- 56 testes novos. Primeira rodada164:161 PASS/3 FAIL por fixtures sem
  as_run.actual_start; corrigido valor obrigatório, sem afrouxar constraints.
  Rodada HTTP inicial70:69 PASS/1 FAIL por user_access fixture com três valores
  para quatro colunas; inserção explícita correta, regra de acesso inalterada.
  Repetição HTTP7 PASS. Outras rodadas intermediárias133 e37 PASS não são integrais.
- Direcionada final terminal213/213,9 arquivos,08h28m42 BRT,49,13s, reporter
  scratch/exec01-directed-20261006.json. Inclui casos vivos/remote/reused PID,
  callbacks/ABA, audit rollback, autoridade, backup, cursor e metadata/removal.
  Reporter conferido213 PASS/zero FAIL/pending; SHA
  BC7320DB20364FF91BEDEC4466E54781ECC71048A7775E00278E94D987526D9E.
- Tipos74301 PASS, build77223 PASS. Server.cjs SHA-256
  3FAA37EF707E7765470631728971A1A1A872858E451A6B591E2A5E2279E86EAE;
  web index-CN09k9IG.js
  54C345FAC78338407C5E22BB8793F64C0E7E86E2BA63BDEB0F3DE0321A397778;
  CSS index-CAZIMpiP.css
  206425A5D9F95642F6FB76A9788A8938E9F6DA1851239270918FCB7CB79B1422;
  Rust engine inalterado
  5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009.
  Aviso de chunk>500k permanece; não é teste de performance visual.
- scripts/verify-execution-ownership.mts, sessão45828, fixture yop8U7 PASS:
  servidor compilado/engine real, arquivo sintético EXIBIÇÃO-ÇÃO, NULL/fakesink.
  Peer bloqueado sem segundo engine ou CUE/TAKE/STOP; consulta privada estável,
  backup restaurável, cursor/posição por predecessor, as-run exato, bytes
  preservados. HTTP62452/62453; servidores3488/10080/5996, engines3900/3644.
  Filhos/listeners próprios encerrados. Engine morreu junto com pai:
  engineSurvivedParent=false; NÃO atribuir prova de órfão vivo ao compilado.
- verify-engine-recovery.mts atualizado para exigir posse e aguardar child
  encerrar antes de fechar DB. Sessão80281/fixture sN053O PASS: watchdog40→40,
  checkpoint65→65 no restart, mesma revisão/identidade, um evento secundário,
  três linhas de as-run esperadas. NULL/GStreamer real; sem hardware/publicador.
- Integral final12507 iniciada depois dos dois ensaios/direcionada terminarem,
  um worker, sem alterações de fonte/build/verificador concorrente. Reporter
  scratch/exec01-full-20261006.json; resultado terminal212 arquivos/2102 testes
  PASS,08h29m52 BRT,750,21s. Reporter conferido:success=true,2102 PASS,zero
  FAIL/pending,212 arquivos passed; SHA
  7740DF6EB17B660701D5CA6CBC14B0D7A256D866D91BF010D2364ED09805E225.
  Inclui ACL5/DPAPI5 com limites originais. Hashes server/web reconferidos
  depois da integral, iguais ao compilado; PIDs próprios do compilado ausentes
  no inventário somente leitura. Não atribuir PASS à saída parcial nem ao
  SEC-22I2046 histórico. Objetivo integral permanece ativo.

Pendências/próxima frente: posse global antes de MediaMTX.apply/start e
relays.sync/configuração compartilhada; syncDistribution antecede os claims
dos canais e ainda não é protegido por EXEC-01. Claim de um canal não basta
para possuir toda a instalação. Preservar processos de terceiros: erro/timeout
não autoriza kill/roubo, mesmo que pareçam órfãos. Depois tratar legado e
reservas inconclusivas com fluxo explícito e UI de diagnóstico sem reset
automático; não apagar cursor/histórico para permitir boot. Auditar falhas de
construção pós-spawn e fechamento/flush, comandos externos/grafismos/automação,
efeitos de publicação/rejoin/failback, migração de dados, custo do acervo/jobs,
categorias/raízes/integrações e demais requisitos. Nó/host independente, testemunha
e sinais físicos exigem ensaio próprio. Browser, DeckLink/NDI/OMT/áudio/scopes,
soak e pacote portátil final continuam abertos. Objetivo ativo, sem deploy,
QA4041/ZIP/release/commit/push desta etapa.

## EXEC-02 — distribuição local global, 06/10/2026

Migração33 cria histórico assinado e slot com revisão/tombstone; valida tabelas,
cinco triggers, MACs, sequência e referências no startup e no backup. Não é
lease por prazo nem eleição distribuída. Claim é anterior a qualquer arquivo,
processo, pipe de credenciais ou mudança protegida de configuração. Auditoria
e posse são atômicas; rollback não deixa manager parcialmente adquirido.
Recuperação exige dono local encerrado/liberado, todos os filhos comprovadamente
encerrados e nenhum engine/checkpoint/as-run inconclusivo de outro canal.
Origem de ensaio HA não autoriza abrir distribuição.

MediaMTX/relays reservam recurso e geração antes do spawn. Erro com PID ou kill
solicitado não significam exit; mudança de destino aguarda o filho anterior.
Callback velho não limpa nova geração. Shutdown impede filas/watchdog/tick
ressuscitarem recursos. Escrita privada revalida posse depois das permissões
Windows e antes do rename síncrono; perda de posse conserva arquivo anterior.
Endpoint privado/no-store expõe apenas diagnóstico, sem PID/run/boot/segredos;
não transfere posse. Hooks de distribuição e transporte recusam peer antes
dos efeitos. Isto NÃO substitui revisão original/autorização fresca/auditoria
atômica próprias dos cadastros operacionais restantes.

Evidências atuais:

- 33 novos testes. Rodadas terminais89934:70 PASS e80344:45 PASS, sobrepostas,
  não somar. Direcionada final37988:7 arquivos/82 PASS,09h14m40 BRT,67,41s;
  scratch/exec02-directed-20261006.json conferido,success=true,zero FAIL/pending;
  SHA A9DDA720FE68202E2F76D66BCCC4D48CE56CF85BC6783DC1761CBA8861E4D3CE.
  Tipos61003 e build44153 PASS. Integral3978 terminal215 arquivos/2135 testes
  PASS,09h16m19 BRT,803,16s, um worker, sem alteração concorrente de
  fonte/testes/build/verificador. MediaMTX automático desligado nas fixtures
  não explicitamente configuradas. Reporter scratch/exec02-full-20261006.json
  conferido:success=true,2135 PASS,zero FAIL/pending,215 arquivos passed;
  SHA D23E974EC7D78117F2C26374E92747AF4A4F46AB8950C15FCBD2E184658B44AF.
  Inclui ACL/DPAPI reais com limites originais. Hashes server/web/MediaMTX
  reconferidos após integral, iguais ao ensaio. PIDs próprios24724/15752/7008/
  28284/26036 ausentes e portas51301/51302/9997 sem listener nesta conferência.
  git diff --check PASS. Não é nova homologação visual/física ou pacote final.
- Ensaio compilado scripts/verify-distribution-ownership.mts, sessão12975 PASS:
  dois backends no mesmo SQLite/cofre e MediaMTX real, diretório temporário
  9BJZRR. Peer recusa PATCH canal, guest/destination e CUE/TAKE/STOP sem alterar
  configuração, dados ou dono; consulta privada não libera recursos.
  Sucessor só após parada verificada; backup validado. PID da API9997 conferido
  por netstat, não inferido apenas de HTTP200. HTTP51301/51302; servidores
  24724/15752/7008 e MediaMTX28284/26036. Próprios filhos/listeners encerrados.
  mediaSurvivedParent=false: órfão vivo é fixture, não prova compilada.
- Reporter scratch/exec02-compiled-20261006.json conferido, SHA-256
  8AA2DDD181F2BB893472DDF1D8EB9F6F03D9838525A07278CB7C6C69E371663F.
  Server compilado FEBD0753EBFAF5D246505932421A8C6D8754A231F2AF9B938EC15C365F19EC07;
  web index-4XEkp1Nm.js 5AE5688F2CCBD87F38AE4695C51CEB3E474A58EDC2274FEB2F5860D4B46C7E46.
  MediaMTX 114E6C0B514813658E10BE55F8AB6EAB950AE879943272A59B0A51D55930900A.
- Primeira tentativa13612 não completou: consulta diagnóstica Windows/CIM
  excedeu15s, antes de iniciar peer. Filhos próprios14920/22764 encerrados.
  Foi trocada APENAS coleta do verificador por netstat com limite5s; aplicação,
  ACL5s e políticas de posse não afrouxadas. Falha inicial não conta como PASS.

Limites: compilado sem engine/relay, mídia ou sinal físico; não comprova entrega
de destino. A verificação PID da porta pertence ao ensaio, NÃO é proteção
implementada na prontidão de produção. Bancos diferentes na mesma máquina
ainda podem disputar arquivo/porta; SQLite compartilhado não é fencing do host.
HA/outro host/browser/hardware, reparo explícito/diagnóstico UI, contratos dos
demais mutadores, ingestão/banco separado/soak e pacote Windows final continuam
abertos. Sem reinício QA4041, deploy, ZIP/release ou novo push. Objetivo ativo.

## EXEC-03 — fechamento local por grupo, 06/10/2026

Esta seção sucede a EXEC-02 histórica acima: bancos/cwd distintos agora têm
admissão Windows antes dos efeitos. NÃO é redundância de máquinas, prontidão
de promoção, homologação física ou pacote final. Inventário do relatório e
pedidos anteriores: `PENDENCIAS-NUMERADAS.md`, IDs fixos,10 grupos registrados,
1 concluído/9 abertos;53 verificações de fechamento,4 concluídas/49 pendentes.

### Implementação reunida

- HostDistributionFence adquirido em createApp antes dos recursos nativos;
  DistributionOwnership reconfere antes de transação/config/spawn/dispatch.
  ENGINE sem MediaMTX também exige posse; binário ausente nunca dá grant.
- MediaMTX pinado no broker por token e handle/nascimento reais, não apenas
  PID. Sockets TCP/UDP IPv4/IPv6 do processo vivo conferidos antes/depois do
  fetch/status. API HTTP200 alheia não é consultada/aceita como pronta.
- Falha da configuração deixa HTTP diagnóstico/editorial disponível, mas não
  abre engine ou relays e não permite watchdog usar configuração não aplicada.
  Supervisão nativa fica em timer de1s, não no tique de preview20Hz.
- Configuração serializada autoriza antes/depois de ACL e imediatamente antes
  de rename. Novo rplayout-file-security aplica/reconfere ACL no handle exclusivo
  de um arquivo vazio próprio: usuário atual/SYSTEM, proteção sem herança,
  nenhum link/reparse/diretório/conteúdo, nenhuma DACL permissiva de fallback.
  TokenOwner do SO é aceito na criação elevada, proprietário final é o usuário.
  Caminho absoluto gerado/UUID via stdin privado bounded, nunca credenciais.
- Node confere identidade do temporário ao reabrir e antes de publicar. Troca
  antes de gravar ou após prova final conserva destino/hardlinks anteriores.
  Falta de auxiliar recusa a ação. Instalação declarada não busca helper em
  outra árvore de desenvolvimento. Scripts de pacote exigem/copiariam ambos
  os auxiliares; pacote não foi gerado nem publicado nesta etapa.
- NativeResourceGuard mantém geração real até exit. Relay só inicia/reinicia
  com origem local confirmada; peer sem posse não muda dados, config ou PGM.
  Não substituir recuperação externa/HA por essa cerca local. Crash do broker
  fecha a própria família por segurança e NÃO oferece continuidade broadcast.

### Evidência nativa e compilada

- Kernel b6c5b7 PASS, reporter
  `scratch/exec03-kernel-integrated-final-20261006.json`, SHA
  7696D2F5D4D512F0905722725B3107E2B2DEEBF494C472D01FBC8DF22BC228E2.
- Cliente compilado+broker95b936 PASS, reporter
  `scratch/exec03-client-incarnation-final-20261006.json`, SHA
  53319136491725DDF935DE84DC6F5012A1DF6F015B7F04A51CF0FA2D607FC085.
  Handle de child encerrado não readmite seu PID; não houve reciclagem de PID
  forçada no SO. Oito Rust/24 IPC da cerca e quatro Rust do auxiliar ACL PASS.
- Tipos gerais/build do servidor63704 PASS; auxiliar release db2aef PASS;
  tipos somente servidor28926 PASS após reparo exclusivo das fixtures.
- Compilado37645/gW0s1R PASS: bancos e cwd distintos, MediaMTX real, engine
  decodifica MP4 sintético Unicode, relay RTSP→RTMP entrega buffers ao guest
  loopback próprio; relay morto/reaberto por nova geração não reinicia VT.
  Peer recebe409 antes de CUE/TAKE/STOP/destinos/config e não abre nativos.
  API alheia não consultada, config ORIGINAL_BYTES preservada, sucessor somente
  após encerramento comprovado e reinício explícito. Fixture de observação
  privada chama spawn original sem alterar args/options/resultado; nenhuma
  admissão/sockets/handshake simulados. Não usa CIM para estabelecer posse.
  Report `scratch/exec03-native-group-final-20261006.json`, SHA
  D0940BAF92DD077C6E93BDEFD0B9D1092309C3CD3C4827299B511BE3EAC4C110.
  PIDs de servidores28604/25552/3920/29836, brokers11936/3664/29448/29716,
  MediaMTX20356/22232, engines24108/29524, relays22272/29304/21448;
  processos/listeners próprios encerrados ao final. Sinal físico/outro host,
  browser e promoção=false. Não atribuir PID tardio reutilizado ao ensaio.
- Hashes reais do compilado, reconferidos após regressão/reparo:
  server.cjs29E51EA74AB700FBFD1098172E56EFFE822F77EBF653F82B25BA0B0D4A6C63A5;
  host-guard9C87654E58418CFA46DD2D63B61E1475FCEC2B4855462D1488AB962989971E91;
  file-securityAB61433B4D2BE4508F9979FDCBB54810FA4DF6660799461FC0BDB31A8EFA93FA;
  engine5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009;
  relayCF6DB72D21904686F7F573F8C9B375E971CD02015F49077A358E5633C018D618;
  MediaMTX114E6C0B514813658E10BE55F8AB6EAB950AE879943272A59B0A51D55930900A.
  Engine/web não foram alterados por esse reparo; não alegar nova build de ambos.

### Regressão composta, não uma integral única verde

Por pedido do operador, mudanças do grupo foram reunidas antes da rodada
de fechamento. Não executar testes por atualização de status/documentação.

- Integral57152 terminal:221 arquivos/2.178 testes, início12h46m11 BRT,
  884,69s,um worker. **2.168 PASS/10 FAIL**, zero pending. Todos os10 FAIL
  em5 fixtures: routes-fase-b/c/d/e e published-cache-routes. Essas suítes
  esperavam transporte simulado mas encontravam MediaMTX global sem startup;
  proteção nova recusava runtime em vez de aceitar origem não pronta.
  Reporter `scratch/exec03-group-full-20261006.json`, success=false, SHA
  DA1FA79841848FFED33875D8AD8722750C53BC58CC9FD084E24E410CAA6FA050.
- Reparo APENAS das5 fixtures: config explícita de simulação, sem engine,
  MediaMTX, relay ou descoberta global. Expectativas não relaxadas; nenhuma
  mudança/bypass no produto. Casos de ausência/recusa nativa continuam separados.
- Replay38396 terminal:5 arquivos/**36/36 PASS**, início13h02m20 BRT,34,32s,
  um worker. Reporter `scratch/exec03-simulator-fixtures-final-20261006.json`,
  success=true/zero FAIL/pending, SHA
  64E9A246B4361B02F7EE2D1ABD2AAF91A4CC6966770C36CA7F0636111A308DD4.
- Comparação read-only dos reporters confirmou mesmos5 arquivos e nomes de
  todas as asserções. Fora do replay existem2.142 PASS inalterados. União de
  cobertura **2.178 testes distintos**, NÃO2.168+36. Fonte/binários do produto
  não mudaram durante integral/replay; timestamps posteriores só de testes/docs.
  Evidência de composição: `scratch/exec03-group-coverage-final-20261006.json`;
  singleFullRunPassed=false. Não reescrever reporter falho como aprovado.
  Não repetir14min de suíte por mocks locais após verificar seu escopo; futuras
  mudanças de produto exigem nova regressão adequada ao grupo.

### Falhas anteriores preservadas

K5xnP9 foi PASS de fonte/binários intermediários, não da final. Repetição
1CdQs9 falhou no CIM de coleta5s; substituída somente observação do verificador,
não a prova nativa do produto. Primeira tentativa depois disso foi rejeitada
pelo serviço de aprovação por limite temporário e NÃO executada; repetida com
mesma autorização após liberação, sem bypass. LUrXUx falhou sem diagnóstico
de startup suficiente; não presumir sua causa. sTtEOU preservou failure.json
e provou recusa do setter PowerShell de ACL antes do MediaMTX; causa interna
exata do setter não foi capturada, NÃO afirmar timeout como fato. Substituído
por auxiliar nativo mantendo política/deadline5s. Primeiro teste Rust restrito
recusou CreateFile; execução autorizada com permissões reais passou, sem fallback.
Filhos/listeners próprios dos ensaios foram encerrados; falhas não são PASS.

Próximo: grupo2 completo de entradas/sinal/operação live; inspecionar o que já
existe antes de editar e reunir mudanças de software antes de validar. Hardware
e navegador ficam em evidências separadas. Manter grupos3–10, relatório anotado,
prioridade de live, QC em qualidade, pastas remotas/nome input, banco separado,
segurança restante/HA/soak e pacote Windows no inventário. Objetivo integral ativo.
Sem reinício QA4041, deploy, ZIP/release ou novo push nesta etapa.

## Grupo 2 — lote de sinal recente, 06/10/2026 (parcial)

Regra pedida pelo operador: reunir implementação antes dos testes; mudanças de
status/documentação não repetem validação. Falha real permite reparo em lote e
replay do escopo afetado, mantendo o resultado anterior. Ruflo/ToolSearch não
estavam disponíveis na busca do catálogo desta etapa; nenhum agente foi criado.

Correção concreta em `apps/engine/src/channel.rs`: o primeiro buffer era um
latch permanente usado por PVW_READY, ON_PGM e TAKE. Agora live exige vídeo
recente tanto no decoder quanto no intersink; áudio exigido pelo roteamento
também deve ser recente nos dois pontos. Áudio opcional ausente não bloqueia
vídeo válido. `activate_armed` confere novamente antes de trocar seletores.
VT em preroll pausado mantém seu contrato; o requisito temporal é da live.
Quadros repetidos pelo preview/PGM não renovam o relógio do decoder da fonte.

Servidor e página usam o mesmo contrato de idade em
`packages/protocol/src/signal-freshness.ts`: somar idade do buffer ao tempo desde
a medição; relógio inválido/futuro, idade inválida ou amostra vencida não certificam
sinal. Diagnóstico de perda conserva a identidade/tally do item selecionado.
Isso não detecta freeze de conteúdo com buffers novos; essa medição existente
e os limites de jitter por perfil continuam em homologação, sem inventar limiar.

Rodada44939: **131/131 PASS, 6 arquivos**, transporte, source-wire, monitor,
QC e contrato compartilhado; reporter
`scratch/group02-live-freshness-20261006.json`, SHA256
`AE5C1B53405B015E6A861161FEE962426A6031512576EE6EDC9D37FC94A5B828`.
Rodada71201: typecheck de todo workspace PASS. Não repetir esses testes porque
um status mudou ou a investigação nativa prosseguiu sem mudar produto TS.

### Resultado nativo e falhas preservadas

- 16350: compilou o engine; execução dos75 casos interrompida com
  `0xc0000005 / STATUS_ACCESS_VIOLATION` durante teste de áudio embedded.
  Causa de memória não determinada. Não é PASS nem falha de hardware comprovada.
- 51116: isolamento do mesmo caso FAIL em asserção de troca A/B master;
  valores medidos ainda incluíam master/pares auxiliares anteriores no cenário
  de16 canais. Não flexibilizar asserção, não afirmar causa confirmada ou reparo.
- 68509: demais74 casos:72 PASS/1 FAIL/1 ignorado, mais1 filtrado. Falha no novo
  teste de perda: PAUSED aceito não garantiu que os buffers haviam parado.
- Reparo **somente da fixture**: URI sintética mais longa e bloqueio explícito
  do pad do decoder, observado antes de medir a ausência. Sem simular ready.
  55453: replay apenas desse caso,1/1 PASS; latch antigo permanece mas não
  autoriza TAKE, ativação recusada conserva PGM/armado, TAKE aguarda e comuta
  somente depois de remover o bloqueio e receber buffers reais novamente.

Cobertura nativa distinta composta: **73 PASS/1 FAIL/1 ignorado de75**, nunca
somar rodadas sobrepostas ou declarar integral verde. O ignorado exige runtime
OMT oficial e não homologa OMT. Evidência de composição/limitações:
`scratch/group02-live-freshness-summary-20261006.json`.

Grupo2 **não encerrado**. Próximo trabalho: investigar acesso à memória e troca
multicanal, completar estados/fluxos integrados e homologar sinais físicos.
Itens2.1/2.5 em andamento,2.2/2.3/2.4/2.6 pendentes; inventário permanece
10 grupos,1 concluído/9 abertos,53 verificações:4 concluídas/2 em andamento/47
pendentes. Não confundir testes com os53 marcos. Sem publicação/ZIP/novo push.

## Grupo 2 — correções nativas e replay de arquivamento, 06/10/2026

Atualização posterior ao lote acima; não altera seus resultados históricos.
Registro consolidado: `scratch/group02-native-corrections-20261006.json`.
Mudança de status/documentação não abre uma nova rodada de testes. Falha real
exige reparo e replay dirigido ao comportamento afetado, sem repetir escopos
inalterados nem somar testes sobrepostos.

### Implementações do lote

- Formato de áudio fixo antes dos seletores A/B, inclusive fontes vazias:
  F32LE/48kHz e quantidade de canais configurada, evitando negociação diferente
  entre slots. Ganho, silêncio auxiliar e ausência de vazamento do CUE preservados.
- Callbacks com referências fracas ao pipeline; fechamento idempotente com
  barreira para montagem dinâmica, liberada antes de solicitar NULL. Testes
  comprovam liberação dos pipelines descartados, não somente comando aceito.
- TAKE conserva PGM anterior e armado até confirmar os seletores reais de vídeo
  e áudio, além de conferir sinal recente. Falha tenta restaurar a seleção e
  não anuncia a nova fonte como PGM. A confirmação é necessária porque a troca
  do input-selector é de duas fases no GStreamer1.28:
  [notas oficiais](https://gstreamer.freedesktop.org/releases/1.28/).
- Decodificação URI por software como padrão. `RPLAYOUT_HARDWARE_DECODE=1`
  permite opt-in de hardware, sujeito a homologação. Veto por autoplug-select
  tipado, sem alterar ranks globais, registro ou drivers da máquina:
  [contrato oficial](https://gstreamer.freedesktop.org/documentation/playback/uridecodebin.html).
- Coleta de áudio dos testes alinhada ao PTS do pipeline; mede24.000 frames
  reais,500ms em48kHz, sem relaxar amplitudes ou exigências de silêncio.
- Arquivamento preserva byte a byte checkpoint nativo já parado. Checkpoint
  ainda em reprodução continua protegido pela posse; ausência de runtime não
  vira STOP e não autoriza sobrescrita sem lease.
- Verificador encerra e aguarda somente seu ChildProcess próprio. PIDs históricos
  são observados, nunca usados para matar processos. Replay `--archive-only`
  identifica expressamente seu escopo reduzido, mantendo TAKE/STOP nativos,
  preservação do histórico e reativação sem iniciar PGM.

### Diagnóstico e resultados preservados

Eventos1000 do Windows às13:19:50 e13:42:03 registraram falha do executável
nativo em `igd12dxva64.dll`, versão27.20.100.9664, exceção0xc0000005,
offset0x4e301. Isso identifica o módulo da falha, não prova a causa interna do
driver. Não houve reparo/instalação de driver nem análise dos dumps; a política
por software evita sua seleção automática. Teste curto não prova estabilidade
prolongada ou consumo aprovado.

- 2114: integral nativa75 casos,73 PASS/1 FAIL/1 ignorado; falha multicanal.
- 9806: canal16 casos,15 PASS/1 FAIL; coleta de áudio insuficiente.
- 54406: isolamento falhou na coleta durante CUE,16 canais/4.800 frames;
  pipeline Playing e sem erro de bus. Não transformar falha em PASS.
- 95697: replay intermediário interrompido por acesso à memória; eventos acima.
- Primeira compilação da fixture autoplug falhou por tipo de SignalId;
  nenhum teste executado nessa tentativa. Reparo tipado sem mudar a política.
- 82764: fonte final do canal, **18/18 PASS**,59 filtrados,77,99s. Inclui
  A/B8/16 canais, ganho/silêncio/STOP, liberação de pipelines, perda/retorno de
  buffers, QC e veto autoplug tipado sem alteração de ranks.
- 15903: **OMT oficial1/1 PASS**,11,72s, sender/receptor próprios na mesma
  máquina: descoberta, vídeo branco/áudio senoidal, appsrc, CUE/TAKE e telemetria.
  Não homologa rede externa; política URI não altera esse caminho OMT appsrc.
- 18371: automação nativa completa **FAIL** no arquivamento por checkpoint
  protegido. Etapas anteriores passaram; não declarar integral verde.
- 18114: após reparo, **47/47 PASS**,3 arquivos de contratos de posse,
  checkpoints e arquivamento. Reporter `scratch/group02-archive-guard-20261006.json`.
- 37749: typecheck do servidor PASS. Engine release e servidor compilados PASS.
- 32255: **replay nativo de arquivamento PASS**, não repetição da integral.
  TAKE/STOP reais, histórico/revisão preservados, engine encerrado e reativação
  sem novo TAKE. Servidor/peer/sockets próprios encerrados e banco fechado.

Identificação da fonte e artefatos desta etapa (SHA256):

- `apps/engine/src/channel.rs`: `7FC19EE31033D3D76FBBC92A2AD0BF60DACA470C9FC294F2F51CDA4669C7D69B`.
- Engine release: `1A98C0DF97AE353EE58DF607EFD9CB695F745A13704938EEE1F6E7004965131F`.
- Servidor compilado: `43ECBDC7566B51A0D1F62AEC6958A6A695D308BE6FB8589412437D0C7BB54FE4`.
- Verificador: `84531F5F3DDF938860868F46407855938174CBE439475A51F8EE84D8FBD8C491`.

Não repetir os131 testes TS de sinal recente, inalterados, por estas mudanças
nativas/arquivamento; este último recebeu seus47 testes afetados. Não apresentar
as rodadas dirigidas como uma integral única verde. Nenhum ZIP final, deploy,
reinício do QA4041 ou novo push foi realizado.

Grupo2 permanece aberto:2.1/2.4/2.5/2.6 em andamento;2.2/2.3 aguardam hardware
e sinais reais. Faltam contratos completos de estados, fluxos no navegador,
reconexão/estabilidade externa e homologação física; consumo/soak nos grupos3/9.
Inventário atual: **10 grupos,1 concluído/9 abertos;53 verificações,
4 concluídas/4 em andamento/45 pendentes**. Grupos3–10 preservados.

## Grupo 2 — diagnóstico de sinal e identidade por barramento, 06/10/2026

Registro: `scratch/group02-signal-binding-summary-20261006.json`.
Contrato `assessLiveSignal` distingue UNMONITORED, CONNECTING, SIGNAL_OK,
NO_VIDEO, NO_AUDIO, FAILED, UNKNOWN e SIMULATED, sem confundir seleção de
PGM/PVW com sinal mensurado. Ausência de áudio não é diagnóstico de silêncio;
amostra vencida sem evento de perda é UNKNOWN, não confirmação de ausência.
Fonte descoberta e instabilidade ainda exigem integração específica; não
anunciar a máquina de estados completa como entregue.

Servidor expõe `busSignals`, mas navegador recalcula idade das medições, sem
confiar no diagnóstico anterior. Ready/telemetria atrasados de outro item da
mesma fonte não atualizam o bus atual. Mudança de item invalida sua medição;
TAKE pendente da mesma fonte conserva item/medição do PGM até confirmação nativa.
QC passou a exigir vídeo nativo recente além de PVW_READY para imagem/inspeção
HQ; ausência de áudio não impede conferir vídeo nem aprova editorialmente a fonte.

Rodada24125: **122/122 PASS,4 arquivos**, transporte, contrato protocol,
monitor web e inspeção QC servidor. Reporter
`scratch/group02-signal-binding-20261006.json`, SHA256
`F0C63A0187D33A1F1DDA4F678522E58A9C3D9D1ABAC8571FC40954988B1CF84D`.
Após encontrar a checagem antiga no preview QC, reparo e verificação somente
desse limite: **14/14 PASS,1 arquivo**,
`scratch/group02-qc-signal-binding-20261006.json`, SHA256
`17EAFB6B38038BF22DA0A7B206B9919FB640BB52A1AE637A3EAB53FCD9A7D47B`.
São136 testes distintos/5 arquivos, sem duplicação dos122 anteriores.
Workspace typecheck84053 PASS; após integração QC, apenas web17617 PASS.
Build servidor/web20669 PASS, com aviso Vite de chunk>500kB; tamanho do bundle
navegador não é evidência de consumo do preview. Nenhuma alteração no Rust,
repetição de suíte nativa, homologação física, restart QA4041 ou ZIP/push final.

Limites explícitos: binding por item não separa aberturas repetidas do mesmo
ID. Próximo lote deve integrar encarnação do decoder/comando e rever eventos
tardios sourceLost/itemError, depois reconexão e observação no navegador.
Grupos/estados inalterados: **10 grupos,1 concluído/9 abertos;53 verificações,
4 concluídas/4 em andamento/45 pendentes**. Não encerrar2.1 com este lote parcial.

## Grupo 2 — perdas/erros tardios por item e barramento, 06/10/2026

Registro: `scratch/group02-late-live-faults-summary-20261006.json`.
O produtor nativo atual só emite sourceLost do pipeline PGM selecionado;
falha de PVW vem por itemError com bus explícito. Servidor passa a respeitar
essa atribuição: perda de item anterior não atualiza PVW nem produz TAKE.
Erro de outro item da mesma fonte não reatribui o bus; erro legítimo do TAKE
pendente ainda cancela a tentativa. Falha do novo TAKE não marca FAILED no
PGM anterior quando ambos usam o mesmo endpoint.

Fixture antiga de perda de PVW usava sourceLost, diferente do produtor nativo;
corrigida para itemError/pvw e expectativa FAILED, sem simular perda de PGM.
Dois novos casos comprovam descarte de perda/erro do QC antigo, independência
PVW/PGM e cancelamento legítimo sem matar/reiniciar o engine.
Rodada91378: **91/91 PASS**,1 arquivo de transporte, reporter
`scratch/group02-late-live-faults-20261006.json`, SHA256
`9BF85AEBCB331E2D627D8215E27A043D472CC32733CE533BCB6A715A61FF8077`.
Esses91 se sobrepõem aos89 anteriores: não somar como cobertura distinta.
Typecheck36348 e build somente do servidor PASS; Rust e interface inalterados,
suítes/builds nativos/web não repetidos. Nenhuma rodada por status/documentação.

Limitação encontrada na inspeção posterior: binding histórico de outra fonte
fora da seleção ainda pode aceitar erro/ready/telemetria desse antigo item.
Próximo lote deve ligar PVW à seleção atual/intencionada, inclusive antes do ACK,
e separar aberturas repetidas do mesmo item por encarnação de decoder/comando.
Não declarar todos os eventos tardios resolvidos nem2.1 concluída.
Totais mantidos:10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
4 em andamento/45 pendentes). Sinais físicos, navegador, reconexão e grupos3–10
preservados; sem restart QA4041, ZIP final, deploy ou push.

## Grupo 2 — posse atual/intencionada de PVW, 06/10/2026

Registro: `scratch/group02-preview-ownership-summary-20261006.json`.
`requestedLivePreview` vincula atribuição ao comando preview efetivamente
enviado, após Ready/posse/vida do engine. Ready/telemetria/erro de binding
histórico de outra fonte não são admitidos, inclusive antes do ACK. Comando
de limpeza ou preview de arquivo remove essa posse. PGM exige o item atualmente
selecionado; a exceção de falha legítima do TAKE pendente permanece explícita.
Inicialização CUEING centralizada no envio de preview inclui park da live,
sem depender de passagem anterior por Master/CUE. Diagnóstico de fonte antiga
fica UNMONITORED/IDLE quando novo comando já foi enviado, mesmo se a seleção
exibida ainda aguarda ACK. Rejeição/incerteza não reautoriza fonte histórica por
suposição: nova confirmação/CUE é necessária, sem declarar sinal por HTTP/ACK.

Rodada10390: **93/93 PASS**,1 arquivo de transporte. Reporter
`scratch/group02-preview-ownership-20261006.json`, SHA256
`67AE85867DC71237502723D282DA361CF0967382723D4CAC00CCB431E12BF536`.
Dois novos casos verificam evento legítimo da nova fonte antes do ACK,
rejeição da anterior, limpeza ainda pendente e park direto da live.
Typecheck35597 e build somente servidor PASS. Não somar93 aos91/89 históricos.
Rust/web inalterados; nenhuma repetição dessas suítes/builds por status/docs.

Inspeção posterior identificou requisito nativo concreto: ready_pgm/ready_pvw
em `apps/engine/src/main.rs` guardam apenas itemId. Reabertura pronta do mesmo
ID pode suprimir novo sourceReady quando nenhuma iteração observa None.
Próximo lote: encarnação da abertura/decoder nos comandos/eventos e deduplicação
por encarnação, preservando identidade editorial; testes de CUE repetido e
eventos tardios do mesmo ID. Não substituir por readiness fabricado no servidor.
Estados/descoberta/instabilidade/reconexão, navegador e homologação externa
continuam abertos. Totais:10 grupos(1 concluído/9 abertos),53 verificações
(4 concluídas/4 em andamento/45 pendentes). Sem ZIP final/restart/deploy/push.

## Grupo 2 — confirmação nativa de CUE repetido, 06/10/2026

Registro: `scratch/group02-repeated-cue-native-20261006.json`.
Corrigida a causa observada no cache ready_pgm/ready_pvw: cada Item recebe
identidade interna de abertura, monotônica/não reutilizada no processo;
contador recusa overflow, sem wrap. Cache compara (itemId,decoder_id).
Nova abertura do mesmo item já pronta em outra iteração emite confirmação,
sem exigir passagem intermediária por None. Mesma abertura não repete eventos;
perda real reseta cache e retorno confirma novamente. Mantém itemId editorial.

Teste nativo QC ampliado: URI de vídeo sintético realmente decodificada,
segunda abertura do mesmo qc-source com novos buffers, decoder_id distinto,
pipeline anterior efetivamente liberado e nenhum TAKE/PGM. O helper de
deduplicação prova reabertura pronta sem None e perda/retorno da mesma abertura.
Não simula readiness por ACK nem considera pipeline Playing suficiente.

Rodada65627: **18/18 PASS**,0 FAIL/ignored,60 filtrados,80,68s. Inclui canal,
QC, perda/retorno, preservação de PGM, áudio A/B8/16, software decode e metadados.
Teste específico `tests::repeated_ready_item_announces_each_real_decoder_opening`:
**1/1 PASS**,77 filtrados. São19 casos distintos desta etapa;18 se sobrepõem à
validação nativa anterior, não somar como cobertura nova. Não é integral única
de78 casos aprovada. Build release54892 PASS26,90s; aviso de duas conveniências
de readiness atualmente usadas apenas em testes. Sem alterações/retestes TS.
Engine SHA256: `04712C181D724CA39E07AD78B4033E74B7FABE1977AFA7A7B2EADBBC3A453473`.

Identidade de abertura ainda é interna ao engine: falta propagação/validação
ponta a ponta nos comandos/eventos para separar eventos tardios do mesmo ID.
Não declarar todo o contrato de encarnação implementado. Também faltam estados
completos/descoberta/instabilidade, reconexão, navegador e hardware/rede externos;
ensaios OMT de engine anterior mantêm atribuição histórica, não homologam este
binário novo. Nenhum pacote Windows final, restart QA4041, deploy ou push.
Totais:10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
4 em andamento/45 pendentes). Grupo2 não encerrado; grupos3–10 preservados.

## Grupo 2 — identidade de decoder no protocolo e servidor, 06/10/2026

Registro: `scratch/group02-decoder-wire-summary-20261006.json`.
Ready anuncia decoderIdentity. ACK do preview confirma decoderId vinculado ao
objeto de abertura/comando pendente exato; antes dele, ID ausente/antigo/novo
não certifica PVW. Estado fornece onAirDecoderId/armedDecoderId. SourceReady,
SourceTelemetry, SourceLost e ItemError incluem a identidade do decoder real;
erro assíncrono de TAKE captura o ID do armado antes de descartá-lo.
Servidor rejeita eventos de encarnação anterior do mesmo item; falha legítima
do armado atual ainda cancela a tentativa e preserva o PGM anterior. Rejeição
de preview remove a abertura solicitada, sem presumir que a antiga é válida.

Reconexão nativa publica o novo estado/decoder do PGM. Mudança de encarnação
invalida sua medição anterior mesmo mantendo itemId/tally; só dados da nova
abertura podem renovar sinal. Compatibilidade com engine legado sem capacidade
explícita permanece, mas NÃO fornece essa garantia; pacote final precisa de
engine/servidor atualizados correspondentes, não um downgrade silencioso.

Rodada57852:95/95 testes transporte PASS. Após adicionar invalidação de medição
na reconexão, replay SOMENTE dos2 casos de encarnação PASS/93 skipped,
`scratch/group02-decoder-wire-recovery-20261006.json`. Não somar95+2.
Typecheck89481 intermediário PASS;11429 final PASS; build servidor PASS.
Teste nativo de serialização ACK/State/SourceReady1/1 PASS.

Rodada nativa76295 FAIL:17 PASS/1 FAIL,60 filtrados,72,37s. Caso áudio A/B
falhou na coleta STOP/8 canais:16.800 de24.000 frames, Playing, sem erro de bus.
Acrescentados apenas timestamps/contagem de descarte ao diagnóstico da fixture,
sem mudar deadline, amostras, amplitudes ou silêncio. Replay isolado43187
1/1 PASS41,78s. NÃO há causa comprovada/reparo anunciado dessa intermitência;
preservar falha e tratá-la na estabilidade. Cobertura com replay não é integral
única verde. Release98907 PASS20,81s, aviso de conveniências usadas só em testes.

Faltam ensaio engine/servidor reais juntos, reabertura/CUE/TAKE/reconexão/QC,
estados completos/descoberta/instabilidade, navegador, sinais externos e soak.
Não homologa DeckLink/NDI/OMT físico nem substitui ensaio real por mock.
Interface não mudou/não foi retestada. Sem ZIP final/restart QA4041/deploy/push.
Totais mantidos:10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
4 em andamento/45 pendentes). Grupo2 permanece aberto; objetivo integral ativo.

## Grupo 2 — transporte servidor + engine real e reconexão, 06/10/2026

Registro: `scratch/group02-real-decoder-wire-20261006.json`.
Verificador `scripts/verify-live-decoder-wire.mts`: usa módulo EngineTransport
real do servidor, binário release atual e URI de arquivo sintético VP8/Vorbis
efetivamente decodificada; não usa mock de ACK, ready, telemetry ou state.
Não inicia API HTTP, banco de produção, navegador, broker ou saídas físicas.
Fonte160x90/25fps com áudio stereo48k; composição320x180; caminho com Unicode.

Rodada79914 FAIL: fixture omitiu barramento de preview (preview:null); CUE foi
corretamente recusado com "este canal não tem barramento de preview". Ajuste
somente do verificador: configurar barramento on-demand e comprovar que todos
os publishers permanecem Idle. Nenhuma mudança no produto/suíte/rebuild por isso.
Rodada23302 PASS:3 CUEs do mesmo ID de fonte, sinal real de vídeo/áudio e
geometria medida; nenhum CUE altera PGM. TAKE de LIVE confirma PGM com sinal;
preview da mesma fonte tem medição independente, limpar PVW não apaga PGM;
STOP confirmado e saída do próprio engine aguardada por callback de ChildProcess.

Extensão32705 PASS: aguarda EOS REAL da fonte finita configurada como LIVE.
Estado LOST observado, item permanece selecionado; reconexão nativa volta
ON_PGM/SIGNAL_OK com novo contador de frames, sem reiniciar processo do engine
nem avançar grade. Limpeza/STOP/saída próprios concluídos; nenhum publisher
de rede ativado e nenhum PID histórico usado para matar processos. Diretórios
temporários de fixtures preservados no registro, não são artefato de distribuição.

Engine SHA256: `8323C3D7216F67B0925EE70A1D0E74CCA91E335CF429B6B20F7168B62710530A`.
Verificador SHA256: `EA894FADE9AADA0E9976D0ED7CE70B3C1CF13A4D404A048BBA6ED7C4B975D2F6`.
Este é ensaio conjunto do módulo de transporte e processo nativo, NÃO aprovação
de servidor HTTP compilado/API/browser, HQ/lease de QC ou DeckLink/NDI/OMT externos.
STOP lógico não mede áudio após STOP; intermitência de coleta anterior continua
sem causa comprovada. Falta injeção de falha real de TAKE e fluxo de API/browser,
estados/descoberta/instabilidade e estabilidade prolongada. Sem ZIP/deploy/push.
Totais mantidos:10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
4 em andamento/45 pendentes). Nenhum encerramento artificial de2.1/2.5.

## Grupo 2 — falha real de TAKE pendente preserva PGM, 06/10/2026

Registro: `scratch/group02-real-take-failure-20261006.json`.
Inspeção encontrou candidato LIVE que podia ficar pendente apesar de falha
comprovada do decoder: service_pending_take conferia roteamento e readiness,
mas não consumia Error/EOS do próprio candidato nem ausência de vídeo após
descoberta dinâmica completa. Corrigido no engine: recusa com itemError
identificado, descarta apenas armado e mantém PGM. Ausência de sinal ainda
desconhecida não vira erro; pad estático de OMT/SDI não é confundido com
descoberta dinâmica concluída. Sem inventar timeout de sinal/TAKE por idade.

Build final93830 PASS21,47s; engine SHA256
`92B7E56B9726569A8A3896B0530B6C416710FDC29A8F68568AEED2F2F520AFDC`.
33033:2/2 contratos TAKE live PASS,77 filtrados. 3714:OMT oficial local1/1
PASS8,03s,78 filtrados; receptor/publisher próprios, vídeo/áudio e CUE/TAKE,
sem homologação de rede externa. Isso testa o caminho estático afetado.

Verificador gera URI LIVE de Matroska/Vorbis somente áudio e tenta TAKE enquanto
live sintética anterior entrega vídeo/áudio no PGM. 54781 FAIL: engine recusou
corretamente e asserções de PGM/armado passaram; depois o verificador usou
liveSources[0] para o antigo PVW, mas nova falha reordenou a lista. Reparo SOMENTE
da fixture: buscar fonte original por sua identidade em todas as observações,
mantendo exigências de sinal/PGM/clear/STOP/publishers. 2616 replay PASS:
TAKE recusado por ausência comprovada de vídeo, armed removido, PGM continua
SIGNAL_OK com vídeo/áudio recentes, mesmo processo do engine. Clear/STOP e saída
do próprio engine confirmados; publishers de rede permanecem Idle. Falha
anterior preservada, sem somar ensaios repetidos como casos distintos.

Servidor/web do produto inalterados: suas suítes/builds não repetidos por status.
Ensaio usa módulo de transporte real e engine release, não API HTTP compilada,
navegador ou certificação física. Falta QC HQ/lease/API/browser, estados completos
e instabilidade, homologação externa e diagnóstico da coleta de áudio STOP.
Recuperação EOS anterior mantém atribuição ao binário anterior; não foi repetida
neste lote nem declarada prova de todas as mudanças do novo. Sem ZIP/deploy/push.
Totais:10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
4 em andamento/45 pendentes). Grupos3–10 e objetivo integral preservados.

## Grupo 3.5 — QC live em qualidade pela API compilada, 06/10/2026

Registro: `scratch/group03-qc-quality-api-20261006.json`.
Servidor CJS atual, engine release atual, MediaMTX próprio em loopback, banco
temporário e sender H264/AAC1280x720 reais. API publica playlist operacional,
executa TAKE/CUE, abre inspeção por viewer e produz H264/Opus realmente
decodificados pelo capturador; não é aprovação visual de navegador/dispositivo.

Verificador reforçado: encerra só ChildProcess retido e aguarda exit; EOF do
servidor permite broker drenar sua família/Job. PIDs nativos são observados,
nunca usados para kill. Resultado PASS só é impresso depois do encerramento
próprio e fechamento do DB. Nenhum processo alheio ou instância QA4041 foi parado.

59324 FAIL: captura RTSP HQ com erro not-linked; aviso giolibproxy.dll também
registrado, sem presumir qual dependência interna faltava. Fonte rtspsrc cria
pads por stream SDP, conforme [documentação oficial](https://gstreamer.freedesktop.org/documentation/rtsp/rtspsrc.html).
Reparo da fixture: selecionar caps RTP vídeo/áudio explicitamente e drenar o
fluxo não medido. 73597 FAIL: ramo descartado sem EOS manteve captura ativa até
timeout25s; só capturador próprio encerrado. Limitado EOS desse ramo também,
sem reduzir50 quadros medidos ou exigências de imagem/áudio. Produto inalterado;
suítes/builds TS/Rust não repetidos por reparos do capturador/status/docs.

88685 PASS, diretório UDbXA7/API local51438, encerramento próprio confirmado.
Preview428x240, deviation38,6804/detail44,4911; HQ1280x720,
deviation52,0637/detail56,6350. Passou critério de detalhe contra upscale do
preview reduzido. Áudio Opus→F32 stereo48k RMS0,0260236, dentro da faixa exigida.
Entrada manteve2 leitores(PGM+PVW): HQ compartilhou decoder do PVW, sem terceira
conexão. HQ Idle por padrão, PGM preservado, dois viewers independentes,
fonte incorreta recusada, stop/restart e expiração nativa/viewer confirmados.

Não mede CPU/RAM/rede remotos, scopes, fidelidade cromática ou estabilidade
prolongada; não valida botão/browser nem fluxo de arquivo. Também não é prova
de QC direto sem Master: este roteiro fez TAKE antes do CUE. Aviso GIO/runtime
permanece a diagnosticar no pacote final, não eliminado por esse PASS. Coleta
de áudio STOP anterior permanece sem causa comprovada. Sem ZIP/deploy/push.
3.5 passa de pendente a EM ANDAMENTO, não concluída. Inventário agora:
10 grupos(1 concluído/9 abertos),53 verificações(4 concluídas,
5 em andamento/44 pendentes). IDs e demais requisitos preservados.
