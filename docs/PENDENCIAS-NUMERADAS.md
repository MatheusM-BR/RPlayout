# Pendências numeradas — RPlayout

## Estado atual — r87 instalada; ciclo r86→r87→r86 conferido no D:

19/10 — 6.2/7.3: ponte de troca ligada à fila/pipe do filho próprio no
EngineTransport; preservação de relógio/CUE/as-run, reconciliação sem segundo
COMMIT, helper de recibo+binding+checkpoint atômico e STOP durável implementados.
335testes/10arquivos PASS, tipos e buildJS isoladaFF4784EE PASS. Ver TROCA-LIVE-
PIPE-E-COMMIT-2026-10-19.md. Falta fábrica de sessão/autorização no Runtime,
controles e reconciliação entre processos, compilação/testes do engine nativo,
mídia física/remoto/soak e instalador r88. Nenhum endpoint novo ativado; não é
fluxo operacional entregue. Totais10/53:8concluídas/34andamento/4pendentes/7v3.

19/10 — 6.2/7.3/10.4: checkpointv2 com fonte confirmada protegida e recuperação
normal pela fila do engine integrados; validação de envelope/recibo/contexto,
cursor exato sem fallback principal, binding independente de CUE, proteção de
rollback por formato além do schema.305testes basePASS +70dirigidos finaisPASS,
tipos/buildJS isoladaE5568ECdPASS e contratoCLI declara[1,2]. LIVE-BINDING-
RETOMADA-2026-10-19.md. Não houve corte/mídia nativa, instalação ou r88.
Falta ligar a fila de CORTE ao pipe/Runtime e gravar journal+binding+checkpoint
atomicamente no fato real, preservar relógio/asrun, resolver SQL do STOP e
integrar controles. Native12casosNOT_RUN; demais gates físicos/remotos/soak
mantidos. Totais10/53:8concluídas/34andamento/4pendentes/7v3, sem check amplo fechado.

19/10 — 6.2/7.3/9.4: implementados componentes de journal durável/transporte
de troca nativa, sem ativar endpoints; par/ocorrência/posse/configuração ligados,
intenção antes do pipe, recibos imutáveis e consulta em vez de segundo corte.
EngineTransport já protege State de seleção inconclusiva: sem checkpoint,
avanço ou retomada silenciosa até STOP confirmado.274testesPASS/6arquivos;
revisão final45PASS/2arquivos, tipos e buildJS isolada7A2DACA3PASS. Não IPC nativo,
pixels/PCM, hardware, checkpoint de perna ou fluxo instalado; faltam ligar port
à fila/filho/Runtime, bindings por barramento, recuperação/rollback e resolução
SQL do STOP. FAILOVER-SERVIDOR-JOURNAL-2026-10-19.md. Native12testesNOT_RUN,
sem r88/fechamento de verificação ampla. Totais10/53:8/34/4/7 mantidos.

19/10 — 6.2: avançada a implementação NATIVA em fonte, sem ativar endpoints:
terceira superfície preserva próximo/CUE, preparo/commit/cancelamento explícitos,
geração da instância/revisão, journal sem reexecução, sinal recente/deadline,
relógio da live preservado e rollback inconclusivo exige STOP.12testes escritos,
NÃO executados; parserRustfmt exit0 não é compilação/tipos/runtime. Servidor
durável/checkpoint/bindings e validação audiovisual integrada ainda pendentes.
FAILOVER-NATIVO-CONTRATO-FONTE-2026-10-19.md. Sem binário/instalador atualizado;
6.2 continua em andamento. Totais10/53:8concluídas/34andamento/4pendentes/7v3.

19/10 — decisão de escopo da entrega, 10.2/10.5: usuário confirmou uso interno
e testes, sem distribuição. Próxima build destinada a testes internos em
D:\RPlayout-builds; sem publicação pública nem envio de binários ao GitHub.
Redistribuição futura depende de nova definição; revisão dos termos de uso
dos runtimes/avisos continua REVIEW_REQUIRED, sem aceite automático. Essa
distinção não impede implementação/testes internos permitidos e não resolve
os bloqueios técnicos de compilação/empacotamento. Nenhuma build gerada ou
verificação encerrada por esta decisão. NDI-TERMOS-LOCALIZADOS-2026-10-19.md.
Totais mantidos: 10 grupos / 53 verificações; 8 concluídas, 34 em andamento,
4 pendentes e 7 adiadas para v3.

19/10posterior — integração nativa ainda bloqueada para conclusão validada:
TAKE normal consomeCUE/reiniciaocorrência; Nativeprotocolo/checkpoint não têm
contrato de troca de perna preservando relógio/CUE/recuperação. Não improvisada
ligação do recibo de metadados ao TAKE. Binários0250CF31/5B26 e ausência der88
conferidos; autorização nativa permanece antes de22/10, com demais gates de
interface/instalador/remoto/físico abertos. CONTINUACAO-FAILOVER-NATIVO-E-BUILD-
2026-10-19.md registra implementação pendente, retomada e limites, sem reduzir
escopo. Não é novo ensaio aprovado nem fechamento6.2/10.4/10.5.

19/10posterior — 6.2: corrigido failover de metadados que mudava papel antes
de gravar auditoria/alternava de novo no retry. Decisão+histórico atômicos,
chave estável/ator/canal, recibo sem reenvio e sem alegar PGM.32testes/tipos/
build4E3FF51CPASS; EtuImIFAIL preservado; INLINEgik2es e PROCESSnwp9KhPASS,
conferência leituraPASS. FAILOVER-METADADOS-AUDITORIA-2026-10-19.md. Falta
implementação/validação da comutação NATIVA: este caminho continua somente
metadados, não é redundância de máquina/grupo8. Sem nova build instalável.

19/10posterior — 10.2/10.5: fontes oficiais de licençaNDI localizadas viaweb;
documentação remete aSDK6.3.2, dois PDFs oficiais distintos identificados.
NDI-TERMOS-LOCALIZADOS-2026-10-19.md. DLL6.3.2.0/2B660207 confirmada nas duas
cópias da r87 e no manifesto; não prova contrato aplicável. Coleta localXI6kI5
falhou ENOTFOUND antes de baixarPDF; sem bypass, SDK/formulário/aceite/envio ou
publicação. Próximo: obter referência SDK correspondente/confirmação fornecedor
e revisar cumprimento. REVIEW_REQUIRED, sem nova verificação encerrada.

19/10posterior — 7.3/9.4/10.4: close normal inclui drenagem de histórico sem
flush separado; resultado terminal compartilhado impede retry de escrita após
erro e falso STORAGE_CLOSED.53testes do lote/tipos/buildEE2044ABPASS. Ensaio
nativoPROCESS direto hLuOOkPASS:exit0,5,13s,asrunSHUTDOWN,storageassinado/posse
final;132quadros/253952amostras e3janelas movimento/tom. Leitura posteriorPASS,
sem repetir perdaSQL/restart anteriores. APP-CLOSE-DRENAGEM-2026-10-19.md.
Não instalado/HTTP/físico/HA/restored/PTS ou EOSporpublisher; bloqueios de
interface/nativos/empacotamento continuam, sem novo requisito amplo encerrado.

19/10posterior — 4.4: atalho para copiar a medida do conflito do scheduler
integrado ao Master; quadros exatos/racional, intenção fixa durante live,
sentido/âncora/alvo limitados e conferência/commit existentes preservados.
72testes/8arquivos e tiposweb+serverPASS; SQLite publicado confirma ajuste/
dedupe/recusaCUE. COMPENSACAO-MEDIDA-CONFLITO-2026-10-19.md. Não é teste visual,
HTTPremoto/instalado ou pixelsnativos; buildweb/pacote continuam pendentes.
ServidorDF63B20A inalterado; sem nova buildD: ou requisito amplo encerrado.

19/10posterior — 7.3/9.4/10.4: retomada real normal após timeoutSQL30s +main
compilado no MESMO bancoQA PASS3IfSOg, conferência somenteleitura uAdExkPASS.
Cursor51→852 antes de parar; retomada51→155 automática conforme escolha,
histórico RESTART/SHUTDOWN sem fabricar duração anterior; backendexit0 e
segundainstânciaSTORAGE_CLOSED. Corrigida posse liberada cedo antes do flush;
44testes/tipos/buildDF63B20APASS. MukdNDFAIL/exit1 e HoaSPyFAILloader preservados.
Não é seekvisualexato/PTS/installed/HTTP/físico/restored/HA; interface/pacote
seguem sem homologação. RETOMADA-NATIVA-NORMAL-2026-10-19.md. Totais inalterados.

19/10posterior — 7.3/9.4: operador escolheu retomada automática do último ponto
salvo, sem confirmação; aviso não bloqueante e intenção auditada antes do comando,
sem alegar confirmaçãoPGM. Rodadas finais66backend+6UI/tipos PASS; leituraAkEGKH comprova
799quadros/31,96s não persistidos após perdaSQL, sem repetir transmissão,
retomarPGM ou modificar banco/WAL. Novo servidor1700DA6A compilado; interface
nova não qualificada (configuração inicial inadequada; rodada correta EPERM).
CHECKPOINT-INCERTO-2026-10-19.md. Falta validar próxima partida real e integração
instalada. Sem novo instalador nem checkamplo fechado.

19/10posterior — 7.3/9.4/10.4: corrigido shutdownnormal comproveExit/esperalimitada,
ordemparada por pipepróprio independeSQL perdido; força/concessões/HA intactas,
runtimeCreationbloqueada e errosdecontroladorescoletados semrejeiçãosolta.
198testes/tipos/build8BE914C6PASS. vHiSFEPASS+leitura:30sSQLreal/34s mídiareal,
NativeExit0semforça; storage permaneceOPEN/asrunaberto/checkpoint52, recuperação
nãohomologada. Maincompilado c5pwohPASS+leitura:idleNative/sinalIPC deQA,5,189s/
backend0/STORAGE_CLOSED/donoFinalReleased/semPIDs. NÃOumensaioonairinstalado nem
reciboEOSporpublisher/índiceMKV. pQ9ViJFAIL eFJZAMLexit1semresultpreservados.
ENCERRAMENTO-NATIVO-2026-10-19.md. Fontes8BE914C6/EFDC03FF, helpersC60/9EB;
semNativeRebuild/Dwrite/instalação/r88. Totais10/53:8/34/4/7, semcheckamplofechado.

19/10posterior — 7.3/9.4/10.4: novoPGM NORMAL real+PROCESS, pQ9ViJFAIL preservado.
DeadlineSQL30.013ms/ACKrealretido, engine21104vivo/cursor52→854. Leitura posterior
da capturaPASS/sourceRunFAIL:858quadros/34,32s, áudio34,325s e movimento/tom997Hz
em3janelas; bancoíntegro/efeito0/processosausentes. NÃOshutdownlimpo:SIGTERMpor
fallback1s; NativeEOS podeesperar5s+5s. appCloseSQLrecusado/asrunaberto/checkpoint52
retidos, semreparo. PGM-NORMAL-TIMEOUT-BANCO-2026-10-19.md. Falta corrigir fluxo
normal sem enfraquecerparadaforçada/concessões; retomada/portas nãoqualificadas.
QAagoraconfiguradapor sidecar/loaderhashes, semexceção do filtroCredenciais,
proxieslegados intactos; tipos/sintaxePASS, casosantigos nãorepetidos. Nenhum
produto/build/ZIP/Dwrite alterado, r88NOT_BUILT. Totais10/53:8/34/4/7 mantidos.

19/10 — 6.4/7.1: ambienteSQLite filtrado por allowlist nos DOISlimites, Worker
e fork; sem credenciais/opçõesNODE_OPTIONS herdadas, arquivo atribuído por IPC
próprio.14testes/tipos/build99748AEDPASS; bridge novoC60C2EFD, serviço9EB4intacto,
interfaceEFDCintacta. pbEgT0PASSlimitado a proxy preservado; 6xdhUVPASS observa
worker e serviço compilado no MESMOPID416, semproxy: oito canários ausentes,
Unicode/rollback/backup/exit0; leitura independente hashes/DBs/processosausentes
PASS semreplay. Windows acrescenta variáveis básicas deperfil: não alegarcontrole
de toda injeçãoOS. BANCO-AMBIENTE-ISOLADO-2026-10-19.md. Nãoinstalado/HTTP/PGM/
carga/compatSQLcompleta; seleçãoPSNOT_RUN, r88NOT_BUILT. Totais10/53:8/34/4/7.

18/10posterior — 10.2/10.4: HostGuardBinary explícito integrado junto do engine;
seleção comum materializada/PEAMD64/PE32+/hashdomesmohandle/semfallback e aliases
consistentes. Cópia do ZIP passa a conferir tamanho/SHA dos próprios bytes
copiados, comhandleexcluindoescrita; falha nãoalcançaMovefinal. ParserPS3arquivos/
sintaxeNode2roteirosPASS; leitura dos cabeçalhos reais C610E/C5B26/D0250 compatível
com estrutura, NÃOexecução da função/ABI. Casos funcionais de seleção/hash/ZIP/
writer/junction preparadosNOT_RUN sob recusa de scripts existente, sembypass.
EMPACOTAMENTO-NATIVO-INTEGRIDADE-2026-10-18.md. NenhumZIP/build/binário/Dwrite/
instalação alterados; r88NOT_BUILT. Totais10/53:8/34/4/7, nenhum checkamplo fechado.

18/10posterior — 9.4/9.3/10.4: implementado diagnóstico nativo correlacionado
no cliente/API/tela, com motivo/operação/observação e detalhes limitados quando
disponíveis; posse não equivale a prontidão, sem relaxar concessões. FonteRust
classifica tabela/etapa/erroWindows real; helpernovo aindaNOT_BUILT/NOT_RUN.
66testes/tipos/servidor5B92432F/interfaceEFDC03FFPASS isolados; primeirobuildweb
EPERM preservado comoFAIL, segundo no mesmo destinoPASS/avisos presentes/semACL.
Não repetirPGM/consulta bloqueada porstatus. DIAGNOSTICO-NATIVO-PORTAS-2026-10-18.md.
Distconvencionais/instalaçãor87/D: intactos, seleção nova nãoexecutada, r88NOT_BUILT.
Totais10/53:8/34/4/7 mantidos; faltam helpercompilado/causareal/tela e pacote
instalados mais ensaios restantes. Sem licençaNDI/DeckLink/fonteexterna inventadas.

18/10posterior — 9.3/10.4: ensaio novo de arquivo local uSd4elFAIL preservado,
sem rede/sinalexterno: possehost adquirida, concessãonativa não aplicada,
engine0250recusouPGM/código1; arquivo não criado/zeroasrun/DBQAíntegro/dono
liberado semPIDs. Diagnóstico separado F55TR6: aquisição/provafamíliaPASS,
consultasocketsFAIL, semengine. CódigoWindows não observado; não inferirplaca/
driver/admin. Roteirofilereader/preflight/cleanup preparados, assertspixels/PCM
nãoalcançadas; tiposPASS. PGM-LOCAL-ADMISSAO-2026-10-18.md. Não contornar
proteções/repetir sobmesmacondição; nenhumproduto/build/Dwrite/r87alterado.
DestinoDautorizado, r88NOT_BUILT. Totais10/53:8/34/4/7 mantidos.

18/10posterior — 7.1/7.3/9.4: contenção de tarefas/background/admissão implementada,
geração storage perdida suspensa/notifica1/semreopen/replay; assinaturas saúde
só após INSERT; shutdownawaitAppClose.36testes/tipos/buildFADFFB13PASS emnova
pastaC, helpers/frontend/r87intactos. BsZHwlIPC PASS: perda de conexão absorvida/
5tarefas semefeito/nenhuma rejeiçãosolta. gI0wvycompilado mantémFAIL marcador
EXITED ausente, mas cicloserro3/recuperaçãoINSERT/fechamentoassinado/processos
ausentes conferidos independentementePASS/sourceRunFAIL, semreplay oufabricar
marcador. SIMocioso/semHTTPcliente/PGM, drenagemocupada e impacto30s aindaabertos.
BACKGROUND-STORAGE-CONTENCAO-2026-10-18.md. R88aindaNOT_BUILT; totais10/53:8/34/4/7.

18/10posterior — 6.1/7.2: corrigida rota parametrizada de conferência compartilhada
de categoria, antes indevidamente403 para conta restrita. GET/HEAD200canEditfalse,
PUT/DELETEglobais403, host/canal negado403/anônimo401;66testes/tipos/buildPASS.
Wc3h3sPASS+independente com rotas/domínio/ORM reais e doisSQLitePROCESS:
ETag200/409 únicoaudit, autoridade fresca/revogação401, falhaauditrollback,
remoção/vínculo/revisão persistidos em novaApp/arquivoQA preservado. NãoHTTP/
backendindependente/PGM; trêsinstânciasSTORAGE_CLOSED assinadas/serviçosausentes.
REsXT2FAIL preservado. Servidorisolado3BBAC965 emhost-history-r88-category-
20261018, helpers/frontend/distconvencionais/r87 intactos. CATEGORIAS-AUTORIDADE-
BANCO-PROCESSO-2026-10-18.md. R88aindaNOT_BUILT; totais10/53:8/34/4/7.

18/10posterior — 7.3: timeout real30s durante transação pendente PASSzDOQJl+
independente. ProxyQA reteve ACKreal(changes1/inTxtrue), semtimerencurtado ou
COMMIT; adapter expirou30,015s/resultado desconhecido, conexão inabilitada,
COMMIT/UPDATE posteriores recusados. PaiIPCdesconectou, proxyencerroufilho
próprio; observador/arquivo final0, trêsserviçosprópriosausentes, hashes/
integridade/FKs/bytesprincipais conferidos semreplay. Não rollback operacional,
PGM/HTTP disponível ou energia; chamada síncrona ocupa thread30s, impacto no
controle/concessões ainda aberto. BANCO-TIMEOUT-TRANSACAO-PENDENTE-2026-10-18.md.
Tipos/sintaxePASS, produto/build/ZIPs não alterados. Totais10/53:8/34/4/7.

18/10posterior — 7.2/7.3: corrida real de dois atores/SQLiteIPC e falha pós-commit
PASS2mofBu+conferênciaindependente. Ambosleramrev0; umUPDATE/uma revisão/uma
auditoria de FIXTURE atômica. ProxyQA reteve ACKrealautocommit e encerrou filho
próprio; erroStorageDisconnected/resultado desconhecido, conexão inutilizada,
tentativarepetida recusada/efeito persistido1, sem autoreplay/rollback fictício.
Dados/hashes/marcador/saídados7processospróprios conferidos; não autorização
multiusuário/PGM/asrun/exactly-once operacional. ojIOSZFAILloaderWindows preservado,
URIcorrigida inclusive wrappers pendentes (não executados); tipos/sintaxePASS.
BANCO-CONCORRENCIA-COMMIT-INCONCLUSIVO-2026-10-18.md. Produto/bundles/ZIPs
inalterados, sem Dwrite/HTTP/bypass. Totais10/53:8/34/4/7 mantidos.

18/10posterior — 7.1–7.4: contrato PROCESS real/IPC privado PASS3I35Cy, sem HTTP/
engine ou replay de teste negado. Dois serviçosSQLite distintos, Unicode,
savepoint/rollback, visibilidade sequencial entre conexões, backup íntegro e
resposta18MB inutiliza conexão/UPDATE posterior recusado/sem autoreplay.
Conferência independentePASS: schema/68tabelaslógicas iguais/bytesprincipais
preservados/hashesdoshelpers/saída dos próprios processos.1.019RPCs média0,433ms/
máximo230,951ms na segunda conexão, não carga/SLA. TiposPASS8201; produto e
builds não alterados. BANCO-PROCESSO-IPC-2026-10-18.md. Não é pacote instalado,
concorrência multiusuário, migração histórica ou PGM; quatro checks7 continuam
abertos. Totais10/53:8/34/4/7, sem nova build por mudança de status.

18/10posterior — 10.1/10.4: overrideWebBuildDirectory implementado para empacotar
interface isolada nova junto do servidor novo, sem sobrescrever dist possivelmente
em uso. Seleção comum somente-leitura/entrypoints/HTMLassets/raízesmaterializadas;
sintaxePASS, execução NÃO APROVADA:0PASS/8FAIL (seteAuthorizationManager antes
da função, umafixturejunctionEPERM). Consulta de políticas também negada pelo
Registro; nenhuma política alterada/bypass/ZIP/Dwrite. Preflight de bloqueio
preparado, não reexecutado. SELECAO-BUILDS-ISOLADOS-R88-2026-10-18.md. R88 ainda
NOT_BUILT/NOT_INSTALLED;10.1 concluída só para artefato histórico r87, não seleção
nova. Não certificar teste negado como regra de negócio. Totais10/53:8/34/4/7.

18/10posterior — 9.1: paginação GLOBAL implementada,120porpágina com janela
fixa/cursor exclusivo/voltar/recentes, erros e cancelamento, independente dos
cartões atuais e do histórico por canal. Parser compartilhado/ACL preservada;
27testesem6files/tipos/buildsisoladosC PASS. Server6A94FA68/webE15DBFFB; dist
convencionais/r87/ZIPs não alterados. EnsaioHTTPcompilado maeVdb/acT8i9 FAILs
preservados: startup chegou a HTTP listening, fetchlocal indisponível. Diagnóstico
mínimo próprio confirmouEACCESconnect127.0.0.1; não contornar/repetir sem mudança
do ambiente. Nenhuma página instalada/HTTP/browser homologada. Wrapper de job
próprio preparado para próxima rodada, NOT_RUN. HISTORICO-GLOBAL-PAGINADO-
2026-10-18.md; r88 ainda NOT_BUILT. 9.1/9.3/10.4 abertas; totais10/53:8/34/4/7.

18/10 — 9.3/10.4: corrigido TAKE de PGM HELD confirmado no engine, mantendo
quadro/cursor/mute até confirmar nova fonte e seletores; UNCONFIRMED recusado.
Dois testes nativos2/16canais/release PASS antes do último acréscimo de fixture;
ramo pendente/cancelamento sintético ainda aguarda rodada afetada (não é NDI).
Sete testes puros de capturas GRAY8 PASS, não sete requisitos novos. Roteiro
instalado+conferência independente preparados, NOT_RUN: imagem congelada/silêncio,
CUE sem alterar PGM, TAKE com movimento/997Hz, histórico/recibos/hashes/perfil.
Origem é fixture de domínio com engine empacotado, não backend instalado nem
ingestão/QC qualificados. D: aguarda serviço de autorização (limite até22/10),
comando nativo nem executado. R88 reservada, NOT_BUILT/NOT_INSTALLED; r87 e seus
ZIPs intactos. PGM-PAUSADO-TAKE-2026-10-18.md. Não repetir grupos aprovados,
contornar autorização ou atribuir PASS ao ensaio não rodado. Totais10/53:8/34/4/7.

17/10posterior — 9.3/10.4: DHY9czPASS+independente qualifica interrupção DEPOIS
de publicar candidato: job próprio parado antes de liberar contenção QA (zero
DML de negócio/diário); STARTED pendente, partida/reconciliação comum recusadas,
RecoverMaintenance explícito/UPGRADE_PROFILE_CONFIRMED observado, sem reescrever
perfil/TAKE, ACK histórico desconhecido, ID concluído recusado. fr1iXxFAIL da
injeção cedo demais preservado, não reinterpretado como publicação capturada.
zJnVzePASS+independente: migração interrompida após intenção, retry bloqueado e
recuperação por nova cópia. IZwzZ2PASS+independente:225framesWAL novos não
commitados, salts/checksums válidos, queda real de job durante transação,
initialize atômico volta a schema45 sem marcadores parciais; diário retido e
retry real recusado. Nova restauração do backup original/45→50, dados editoriais
e200milINFOs sintéticos preservados, FKs/integridade/zeroativações/inventárioQA
PASS. Fonte45 veio de r30 real; não prova PGM/mídia/jobs legados nem energia.
Typescript/leitorWAL PASS; sem mudança de produto/build/instalação por status.
FALHAS-MIGRACAO-E-PERFIL-R87-2026-10-17.md. Faltam frozenPGM, unknownspawn/
STARTING, legado nativo, energia e homologações restantes; casos aprovados não
serão repetidos. Totais10/53:8/34/4/7 mantidos; DeckLinkadiada/grupo8v3.

17/10 — 9.3/10.4: ciclo instalado real r86→r87→r86 PASS, sem alterar produto/
ZIPs ou repetir instalação por status. XSsny6PASS+independente: arquivo nativo,
ingestão/proxy/QC/publicação/CUE/TAKE/pixels/PCM e backup online r86. 9u6OQdPASS+
independente: r87 ativada/adotada, grade Unicode criada APÓS upgrade e backup
recente completo READY, sem trocar PGM. Pedido CHECKING herdado reconciliado
explicitamente por API; bQEZSUFAIL do roteiro que omitiu etapa preservado.
pulcYZFAIL preservado: revisão recusou reserva MAINTENANCE herdada antes de
ativar. Helper oficial recuperou somente reserva da cópia com prova nativa;
FhtX7YFAIL por orçamento QA180s e vLM1s1FAIL de conexão de leitura preservados.
Budget offline600s, deadlines nativos inalterados, sem reduzir hash/revisão.
zpPOhnPASS+independente continua a MESMA preparação, sem recopiá-la: recuperação
reconhecida por diário autenticado, não repetida. R86 ORIGINAL com snapshot
recente r87, ativação/adoção CONFIRMED, grade nova preservada/consultável, sete
tabelas de negócio iguais na preparação, mesmos execução/revisão/item/corte,
três segmentos/apenas1aberto, pixels320×180/PCM997Hz. Novo backup depois da
volta READY/hash/journalDELETE/histórico/grade conferidos; famílias próprias
paradas/perfilQArestaurado. Isso qualifica este par/conta/schema50, não downgrade
inverso, legado nativo, energia ou protocolos/hardware externos. Não repetir
candidato já ativado; verificador exige ausência de tentativa antes de continuar.
UPGRADE-E-RETORNO-R86-R87-2026-10-17.md. 9.3/10.4 ainda abertas para cenários
restantes. Totais10/53:8/34/4/7 mantidos; grupo8v3/DeckLinkadiada/sem publicação.

16/10 — 9.3/10.4: novos backups autocontidos e exportação explícita de arquivos
históricos com WAL/SHM, sem mudar origem/apagar auxiliares. Retorno preparado
preserva snapshot recente COMPLETO/IDs e contrato exato, sem mesclar bancos.
R84FAILUnicode/r85FAILauxiliares preservados; r86 instaladaPASS,6NN6PMFAIL
no checkpoint de destino r83. Conferência independentePASS da recusa segura:
origem/cursor/asrun preservados e nenhuma saída liberada, não retorno aprovado.
R87 retém prova local de parada durante a mesma posse para bytes autenticados
exatos; não aceita dono alterado/novo/host remoto ou parada não comprovada.
66testesafetados/tipos/buildPASS. Reutilização transitória no instante da falha
é inferência; fragilidade de perder prova reproduzida em teste determinístico.
R87ZIP540527606bytes/SHA256
769BD3BC3FC9284CE9F08D47431B56CAFCB8B41A676C6671E31B396EB3F5FE80;
instalador real/7.100arquivos/reciboVERIFIED/perfil/sete atalhosPASS no D:.
cKg2O8PASS+conferênciaindependentePASS: cópiasfechadas, histórico1novo/1alterado/
zeroIDsperdidos, ativação/adoção autenticadas, cursor252→739, imagem320×180/
PCM997Hz, três segmentos/apenas1aberto, família própria parada/perfilQArestaurado.
Mesmo controlador/destino r87 com dados nativos r83: restauração repetida,
NÃO operação nova seguida de retorno a edição anterior; r83 não recebe patch.
Faltam cenários legados/energia/adoção pós-publicação/retorno real entre edições
e homologações externas. RECUPERACAO-R87-2026-10-16.md. Sem cleanup/movimentação/
publicação pública. Totais10/53:8/34/4/7 mantidos; grupo8v3/DeckLinkadiada.

Histórico r83 e anteriores preservado abaixo.

16/10 — 9.3/10.4: migração histórica e adoção interrompida qualificadas em QA,
sem mudar produto/build. Binário r30 conferido criou schema45 novo no D:;
backup/restauração/quarentena/migração explícita para50 PASS sXZyHf. Revisão
antes de migrar recusada, diário autenticado STARTED+CONFIRMED, origem/cofre/
dados editoriais preservados;65tabelas da origem iguais ao backup, nova consulta
CURRENT_NOT_ACTIVATED sem repetir migração. yLVMw0 FAIL do PATH do QA preservado.
M6lwbz PASS: interrupção real do job próprio ao observar UPGRADE_PROFILE_STARTED,
sem editar diário; guard recusa estado incerto e reconciliação sem liberar reserva.
RecoverMaintenance explícito pelo assistente real registra perfil anterior
observado/UPGRADE_PROFILE_REFUSED, preserva perfil/cursor/asrun e libera reserva;
ID encerrado não repete operação. Asserções independentes PASS nos dois casos.
Só schema45→50 com fixtures editoriais e ramo perfil anterior: faltam PGM/mídia/
jobs legados migrados, janela candidato publicado, energia e rollback compatível/
histórico completo. MIGRACAO-E-ADOCAO-INTERROMPIDA-R83-2026-10-16.md.
Produto/ZIP r83 inalterados; sem nova build/status-triggered replay/cleanup ou
alteração operacional. Totais10/53 mantidos8/34/4/7; grupo8v3/DeckLinkadiada.

16/10 — 9.3/10.4: backup online r80 IQkjFO READY/hash/PGM preservados PASS;
mesmo UUID consulta sem repetir. R81prepare falhou por PSModulePath selecionar
Utility incompatível: sete entradas agora fixam módulos ao PSHOME,14casosPASS.
R82 instalada/manifesto/perfil/atalhosPASS; TvKSa7 passou STAGE/TAKE409/recuperação
de reserva, mas ACTIVATE falhou por QC exigir PVW no preparo retido. FAILED
autenticado/origem/cursor/asrun/perfil preservados, prova independentePASS.
R83 engine610E03E8 retém apenas destino QC até liberação explícita de PVW após
PGM, sem criar publisher/superfície antecipados;7testesnativos/buildlockedPASS.
Cache de compilação no D:, binário de build local atualizado após confirmar
hash antigo/ausência de processo; releases e dados anteriores preservados.
R83 ZIP540389724bytes/SHA256
D9F042EB93FA78678EE89AAE12A24D94CFA56A3681666550E26417AFB09F9F51;
instalador real no D:/reciboVERIFIED/perfil/7destinosdeatalhosPASS. MLIh8R:
STAGE/recuperação/ACTIVATE/adoção reais; imagem320×180/PCM997Hz/cursor e execução
confirmados. RoteirooriginalFAIL na última expectativa QA de asrun único,
contrária ao contrato existente RESTART+segmento retomado. Preservado FAIL;
asserção independentePASS/sourceRunResult=FAIL autentica diários, brutos,
hashes, cursor e apenas1segmentoaberto, sem repetir ativação ou alterar banco.
Famílias próprias encerradas/perfil QA restaurado; isso não é rollback de produto.
BACKUP-UPGRADE-R83-2026-10-16.md. Faltam schemaantigo/energia/reconciliaçãoincerta/
retornocompatível/históricocompleto e homologações externas. Semcleanup/migração
do projeto/firewall/produção. Totais10/53:8/34/4/7 mantidos; grupo8v3.

16/10 — 10.1 concluída: artefato atualizado r81 gerado e instalado pelo instalador
incorporado em destino novo D:\RPlayout-builds\qa\r81-installed-20261016,
manifesto7094arquivos/reciboVERIFIED/perfilisolado/7destinosdeatalhos PASS.
ZIP540388627bytes/SHA256
28740CC65EED2275CAA6EB87A088EF9B3A9280859E893FDC3BCDA6F4F13AC79F.
Servidor6B3E024C filtra MTX_* e RTSP_* somente no broker, sem alterar ambiente
do servidor/demaishelpers.36casosdistintos/tipos/buildPASS. Ensaio O70gPG e
asserção independente PASS na própria instalação, sem overlays/runtimeemprestado:
partida4821,97ms, interface8B, CUE/TAKE de arquivo sintético/pixels/PCM997Hz,
segunda abertura preserva item/origem e avança8→265frames; SQLite/GStreamer
observados carregados de dentro do pacote nos processos corretos. Sete overrides
ambientais conflitantes exercitados; nove listeners em loopback. Família própria
de9processos encerrada por job/perfil restaurado byte a byte. kJQ1a8/4CfxBM FAIL
de roteiro preservados, produto/ZIP não reconstruídos para passar o replay.
INSTALACAO-R81-E-AMBIENTE-2026-10-16.md. Fecha apenas artefato atualizado;
10.2licenças/externos,10.3Windowslimpo,10.4upgrade/rollback,10.5publicação abertos.
Grupo8v3/DeckLinkadiada; sem limpeza/migração ou serviços operacionais alterados.
Totais10/53:8concluídas/34andamento/4pendentes/7v3. Histórico abaixo preservado.

16/10 — 10.1/10.2/10.4: r80 gerada no destino autorizado D:\RPlayout-builds,
sem mover/apagar o projeto. ZIP540389252bytes/SHA256
3311B59E1139950E5DB5E4D778D4060002C7F40A07BD328D183530F114928B3D;
7094hashes/7095entradas PASS em memória. Instalação/startup r80 NOT_RUN.
ServidorE226C793 corrige bind explícito RTP/RTCP/ICE, desativa MoQ avulso,
valida endereço/IPv6 YAML; launcher101/engine191/web8B preservados.
41 casos distintos afetados/tipos/build servidor PASS. Integração RaCeNG PASS:
scanner/probe/arquivo/proxy reais, QC/publicação pela API, CUE com quadro/PGMnull,
TAKE nativo, pixels320×180/PCM997Hz estéreo e segunda abertura sem reiniciar PGM.
Nove listeners reais do broker próprio em loopback; família própria observada
de11processos encerrada por job, perfil QA anterior restaurado byte a byte.
Conferência independente brutos/SQLite PASS; as-run ainda aberto após encerrar
launcher durante reprodução não prova recuperação pós-crash. Fixture reutilizou
binários QA e GStreamer r78 explicitamente: não é instalação r80 completa.
XxIqHy/gLZi9G/30MEIB FAIL preservados, sem reclassificação. Relatório:
LAUNCHER-NATIVO-E-PORTAS-2026-10-16.md. Falta filtrar/exercitar MTX_* ambientais,
demais protocolos/soak, instalação atual/Windowslimpo, LAN/IPv6/remoto e licenças.
Totais10/53 mantidos:7concluídas/35andamento/4pendentes/7v3; DeckLink adiada.

16/10 —10.1/10.4: launcher respeitaPORT/--port/HOST e só reutiliza após
identidade local privada de raiz/banco/processo/instância, nãoTCP. Nodeglobal
options/path excluídos; jobWindows substitui taskkill porPIDapóswait.65TS+
12Rustdistintos/tipos/buildserver/launcherrelease lockedPASS. MPdJnf8cenários
compiladosPASS:porta56235,3666,55ms, colisãopreservada, reusocorreto, perfil/
UUIDantigorecusados, HTTPbrowser/proxy403 e fechamentoNodepróprio porjob.
Todoslaunchersprópriosfechados; engine/MediaMTXdesligados, fixtureportátilpequena,
nãoinstalaçãor79. Launcher101A28C9/servidor6E061188 novos, engine191/web8B
preservados. LAUNCHER-PORTA-IDENTIDADE-2026-10-16.md; r79ZIP540388970bytes,
SHA256DC4BA09DEB545FB8A081242C47B696031259AFE6A529DAD4DF9E0D1034BA49FE,
7094hashes/7095entradasPASS emmemória; instalação/startupediçãoNOT_RUN.
Naquele lote faltavam jobs com engine/MediaMTX; o cenário de arquivo nativo
foi conferido posteriormente em RaCeNG acima, não todos os protocolos. Faltam launcherLAN/IPv6real,
Windowslimpo/upgrade/remoto/licenças. Espaço~1,34GiB, semcleanup/migração.
Totais10/53:7concluídas/35andamento/4pendentes/7v3 mantidos.

16/10 —10.1/10.2/10.4: instalador incorporado r78 executado em destino novo,
reciboVERIFIED/perfilisolado/7atalhosPASS. Preflight4,13GB disponíveis/2,83GB
necessários; pacote íntegro/D6A254CEpreservado. Partida direta peloNodeincluído
i7fkSW PASS2274,63ms/PATHmínimo/SQLiteinterno/HTTPJS8B0D3FCB/semoverlays;
engine/mídia desligados, servidor próprio encerrado/exit0. RbXBqR FAIL por
EACCESdeconsultaHTTP restrita preservado; replay com permissão sem mudarfirewall.
Setealvos não são execução dosatalhos: revisão estática encontrou launcher
porta4000fixa/reuso porTCP enquanto servidoraceitaPORT; próximo lote10.1/10.4,
sem alegar colisão reproduzida. INSTALACAO-R78-2026-10-16.md. Sem novoZIP,
cleanup/migração/produção; grupo8v3. Totais10/53:7/35/4/7mantidos.

16/10 —2.1/3.7: diagnóstico QC agora diferencia medição PGM/PVW recente de
Última amostra(histórica), soma idade desdecoleta e não usa SRTOPTIMAL como
vídeo.78casosdistintos/tipos/buildwebPASS. Visual gPFOlH encontrou relógio do
tick anteriorà nova amostraWS; r77superada/nãorecomendada apesar da integridade.
Corrigida hora porrender, replay A4Uy5d PASS:NDIrecente→OMTrecente com NDI
histórica/amarela;428×240ready4, asset8B0D3FCBservido200, estado nativo recente,
PGMnull/grade-asrun0, asserção independentePASS.2senders exit0/semforce/errors[],
servidor/carrier/família encerrados. iYCEKg FAIL de autorização antes da mídia
preservado; replay sob permissão própria sem desativar proteções.
R78:540206044bytes/SHA256
D6A254CEBD4BB0448564AF3369D2862A92C0CA89B1018546A121D9B0B8E750D4;
7094hashes/7095entradasPASS emmemória, instalador/startupNOT_RUN. Engine191CD1E1
e servidorA709115Fpreservados; overlaywebr71,não instalação r78. Semprova visual
WScongelado/CPU-RAM-rede/remoto/soak/físicos. QC-SINAL-HISTORICO-2026-10-16.md.
Semcleanup/migração; grupo8v3. Totais10/53:7concluídas/35andamento/4pendentes/7v3.

16/10 —3.4/3.5/3.7: reconciliado resumo com provas locais já existentes de
4:3/vertical/fullscreen r58/u6WVWl e fallback FFV1. Não repetir geometria por
status. Nova prova YDfvxN: original H264/AAC640×360 no navegador, pico−26dB
com escuta80% e mutada0%, pausa retira pico e retomada restaura; retorno ao
proxy426×240 preserva posição6,64→6,93s. ScopesAMOSTRADO/cadência exibida10/4Hz,
não medição de frequência efetiva. Asserção salva PASS, PENDING/safeOFF/PGMparado.
Servidor overlayA709115F+r71web/runtime, não instalação r76; controleexit0 e
saída do servidor próprio observada. Sem escuta humana/PCM porcanal/soak/remoto.
QC-ARQUIVO-AUDIO-NAVEGADOR-2026-10-16.md. Sem mudança de produto/ZIP/cleanup.
Totais10grupos/53verificações:7concluídas/35andamento/4pendentes/7v3 mantidos.

16/10 —3.3/3.5/3.7: teste visual revelou lacunas PCM ao iniciar HQ OMT com PVW
ainda ativo. Dois interaudiosrc drenavam a mesma fila; separado tee de áudio
em superfícies PVW/QC próprias, sem outro decoder. Fila PCM limitada sem
descarte, HQ continua sob demanda. Engine191CD1E1/build release locked/8testes
nativos afetados PASS. WFEidE NDI/OMT simultâneos PASS/asserção independente:
6capturas de pixels+PCM997Hz, decoders1/2 preservados, HQ libera0readers.
Replay visual afetado r4h6Yo OMT PASS/asserção independente:428×240→640×360→
428×240/scopesAMOSTRADO/safedesligado/3capturas/decode1/PGMnull/grade-asrun0.
XmLjgB permanece FAIL, não globalizar a prova visual parcial NDI anterior.
Falhas da primeira fila/testador e limites em QC-AUDIO-SIMULTANEO-2026-10-16.md.

R76 gerada540204327bytes/SHA256
3A2BC3D46BA5B9CC033B96F2153FA496E5749399DBDD5A7FF698A46562332FF0,
7094hashes/7095entradasPASS emmemória; instalador/startupNOT_RUN. Servidor/web
inalterados; overlays explícitos sobre runtimes r71 não homologam instalação
r76. Geometria de arquivo4:3/vertical já tem prova local r58, reconciliada acima;
faltam remoto/externos/soak/combinações não cobertas; DeckLink adiada, grupo8v3.
Pacotes anteriores preservados; sem cleanup/migração/rede/produção alterados.
Totais10grupos/53verificações:7concluídas/35andamento/4pendentes/7v3 mantidos.

16/10 — Lote 2.3/2.4/2.5 e 4.2/4.3/4.5: corrigidos EOS antecipado do VT por
corte projetado para live e TAKE OMT com quadros antigos acumulados em PAUSED.
LIVE preparada agora consome sinal em PLAYING sem selecionar PGM; arquivo
mantém preroll PAUSED. Servidor A709115F/engine7FD481E0. NDI InhMRG PASS:
corte1109/2250 e retorno revisado; OMT U4naNK PASS:1112/2250/retorno, ambos com
pixels/PCM/as-run/revisão/hash e conferência independente. Testes210 de domínio
distintos+10 medição+6 nativos dirigidos/tipos/builds PASS. Ausência NDI Ar1tS2
PASS no engine anterior; reprodução direta OMT DdM4Jh PASS no novo. Fechamento
integrado de ausência OMT rJnTrF PASS: VT3000 continuou nos cursores1363/1988,
sem TAKE tardio nem interrupção falsa, STOP2211, conferência independente PASS.
Lote local fechado; não fecha homologação ampla. Falhas e limites em
LIVE-PRIORITARIA-VT-2026-10-16.md; não reclassificar C2zabR/EOS final natural,
D09Vut/medição ou l1VMXu/leitor como aprovação integral.

R75 gerada540202872bytes/SHA256
A9B901F6641CEA21775AE7A024FA9B8F8510A26CF6611CBA63004286DEF1B27B,
7094hashes/7095entradas PASS emmemória, engine7FD481E0 noZIP confirmado.
Instalador/startupNOT_RUN; overlays sobre r71 não homologam instalação r75.
R74 preservada, não contém a correção nativa posterior; histórico de pacote
em BUILD-PARCIAL-R74.md, entrega atual em BUILD-PARCIAL-R75.md. Sem cleanup,
migração, dados/contas/rede operacional alterados. Preferência confirmada:
localhost local, IP/nome:porta remoto;192.168.42.172 somente quando for IP real.
Totais10/53:7concluídas/35andamento/4pendentes/7v3 mantidos; sem fechamento amplo.

16/10 — 10.1 r73 parcial gerada540202880bytes/SHA256
961FE70700BB619F11710AFCF318D85B9E379F5FC2C9C702E622F34FFBDE3F64.
Integridade PASS:7094hashes/7095entradas, leitura em memória sem execução.
Evidência scratch/r73-zip-integrity-20261016/result.json. EngineEAEA694F,
servidor6A86A3CE/webCD7665DE. Instalador/startup r73 NOT_RUN; não transferir
provas de overlays para instalação. BUILD-PARCIAL-R73.md. R72 preservada,
sem cleanup/migração/rede operacional; grupo8v3. Totais10/53:7/35/4/7 mantidos.

16/10 — 2.1/2.3/2.4/2.5/9.4 lote PGM: relógio da live deixa de congelar com
PTS parado, sem inventar sinal. NPfgFC NDI e jHoq4P OMT PASS: 3,199s/78quadros
e3,331s/85quadros sembuffers, pixels/PCM novos no retorno, item/start/as-run
preservados. Testes revelaram TAKE pendente sem prazo e LOAD de Próximo antigo
cancelando candidato manual; prazo nativo10s, guardas geração do decoder e
fila/origem/revisão corrigidos. Nativos9 PASS; transporte166 casos distintos
cobertos(164 rodada+2replays de fixtures nativas corrigidas), tipos/builds PASS.
CuhQue com servidor6A86A3CE/engineEAEA694F PASS: retake recusado11957ms, volta
sem comutação tardia nem as-run novo, cursor80quadros/3,084s sembuffers. Asserção
independente PASS; sobreposições explícitas sobre r71, não instalação r73.
Falhas OHVwcM/2fVpwD/gTpvyK e compilação/mocks registradas sem apagá-las.
Diagnóstico esperado do TAKE permanece visível; não é saúde toda verde.
R73 parcial gerada, integridade de pacote PASS;
PGM-LIVE-RECUPERACAO-2026-10-16.md. Totais7/35/4/7.

16/10 — Fechamento do lote de fila: próximo automático não agenda LOAD com
comando manual em andamento; reserva antiga confere sequência/origem/revisão
antes de executar. Servidor final6A86A3CE, engineEAEA694F, transporte166 casos
distintos (164 rodada+2replays corretos), nativos9/tipos/build PASS. CuhQue final
também aprovou a expiração nativa do retake após11957ms e retorno de imagem/PCM,
com mesmo PGM/start/as-run/PID, sem avanço ou comutação tardia. Asserção PASS
releu pixels/PCM e confirmou ausência de preparo de Próximo durante TAKE.
Os dois ensaios anteriores2fVpwD/gTpvyK falharam e comprovaram a disputa, não
homologaram o cancelamento. R73 gerada540202880bytes, hash/integridade registrados acima.
Não instalada; sem alteração de hardware/rede ou cleanup. Totais10/53:7/35/4/7.

16/10 — 2.3/2.4/2.5/9.4: recuperação com LIVE já no PGM comprovada em yZvhsD
(NDI) e M0jt27 (OMT): playlist publicada com dois eventos, um CUE/TAKE, mesmo
item/start, sem avançar, as-run aberto único, pixels/PCM novos, sem reinício do
engine. ServidorE4A01600/engine161FB003 em overlays explícitos sobre r71.
Não prova decoder PGM pela identidade PVW, nem relógio contínuo na lacuna:
este congelou com o PTS da fonte. Correção posterior cria relógio monotônico
da ocorrência live; 8 testes nativos dirigidos PASS, build182006A3 PASS.
Replay integrado do relógio em andamento; OHVwcM FAIL no encerramento do leitor
PCM antes da perda (sinal recente/PCM gravado), leitor QA agora só áudio e replay
afetado NPfgFC. R72 não contém essa correção posterior. Sem novo fechamento;
PGM-LIVE-RECUPERACAO-2026-10-16.md. Totais10/53:7/35/4/7 mantidos.

16/10 — 10.1 r72 parcial gerada com correções de recuperação NDI e tally inicial
de CUE. ZIP540199563bytes/SHA256
D01CA4D02A8E230BBB56C5AEBB735663F9CDCCD065665E211296AA305325D6F5.
Integridade PASS:7094hashes/7095entradas, sem instalar/executar; evidência
scratch/r72-zip-integrity-20261016/result.json. Engine161FB003 e servidorE4A01600,
webCD7665DE preservada. Manifesto da instalação r71 como base, sem incluir banco
ou perfil QA; licenças/runtimes preservados. Instalador/startup r72 NOT_RUN;
provas de overlay não transferidas à instalação. BUILD-PARCIAL-R72.md.
Totais10/53:7concluídas/35andamento/4pendentes/7v3, sem alteração.

16/10 — 2.1/2.3/2.4/2.5/3.3/9.4: recuperação OMT fVENXc aprovada na r71 instalada,
sem overlays. NDI VxdEVR reproduziu receptor parado apesar de servidor/emissor
saudáveis; fonte corrigida para não encerrar a assinatura por timeout/EOS do
plugin. CTtr22 PASS com engine novo explícito sobre r71: um CUE, mesmo PID e
decoder, LOST real, imagem e PCM novos (997→1511 Hz), consultas sem falhas e
processos próprios encerrados. Verificadores independentes PASS dos dois casos.
Também corrigido tally inicial CUEING com NO_VIDEO, sem inventar prontidão:
163 testes de transporte +4 PCM PASS;1 configuração NDI+7 nativos live PASS.
Não é homologação externa/PGM em reprodução/soak/instalação r72. Tipos dos
leitores e tipos completos do servidor PASS; builds servidor/nativos release
locked PASS. Build parcial r72 gerada; integridade aprovada acima. Documento
RECUPERACAO-NDI-OMT-2026-10-16.md. Totais 10/53:7/35/4/7 mantidos.

15/10 —10.1/10.2/10.4 r71 instalada pelo instalador incorporado: reciboVERIFIED,
perfilisolado/7atalhosPASS, semsubstituir produção. Preflight8,99GB/necessário
2,83GB. StartupWRguxl PASS2513ms/Node24.16/SQLiteinterno/PATHmínimo/JSCD7665DE.
BS8rwI API/nativo instalado semoverlays: descobertaNDI/OMT+PVW428x240real,
grade-asrun0/PGMparado. Encerrar2sendersantesdobroker PASSzeroerros/zeroSourceLost
emRUNNING. TerceiroOMTsaudável: interrupçãopropositaldobrokerpróprio reproduz
exatodiagnóstico4104msdepois, comfase/horário. Causalidade comprovada nonovo
teste,nãohorárioretroativoABuYjy.3senders exit0/semforce/famíliaencerrada.
AsserçãoPASS; semreplayvisual/soak/recuperaçãopósperda/hardware/Windowslimpo.
ZIP50F6DAFCintacto,semnovobuild/cleanup/migração. Documento
INSTALACAO-R71-E-LIFECYCLE-2026-10-15.md. Totais7/35/4/7mantidos.

15/10 —10.1 r71parcial gerada540199538bytes/SHA256
50F6DAFC8745E9F64A71D6707D807EDC8BC792556ECC429E95DC1DEC365E9973.
ZIP7094hashes/7095entradasPASS emmemória, semextração/execução; evidência
scratch/r71-zip-integrity-20261015/result.json. WebDG6oIPgn/CD7665DE e
devicesD7396F7C novos; servidor5F33C58E/engine3F0C9616 reconstruídos e hashes
mantidos. Instaladorr71/startupNOT_RUN; QAoverlaynãohomologa instalador.
R70preservada/semcleanup/migração/redeoperacional. BUILD-PARCIAL-R71.md.
Totais10/53:7concluídas/35andamento/4pendentes/7v3 mantidos.

15/10 —3.3/3.5/3.7/6.1 loteQC: catálogo/telemetria independentes, GET10s sem
sobreposição, última lista/fonte preservada em falha, N/D inicial/aviso/reconsulta,
seleção nova bloqueada em falha do catálogo, contexto porcanal. EnsaioABuYjy
NDI/OMTnativos sintéticos diretonoQC semMaster/TAKE/PGM:browser428x240+capturas
75quadros/desvios71,51/71,28. Telemetria503nãoapaga fonte/player;catálogo
9999/9998/10000ms,max1GET/classe,recupera semreiniciarvídeo. QualidadeOMT640x360
reveloubugscopes: nullJPEG==nullerro;guarddearquivo corrigido, replayafetado
webDG6oIPgn/CD7665DE confirmaAMOSTRADO/imagem/retorno428x240 eHQdesligado.
81casosdistintos/7arquivos,tipo/buildweb/server/enginePASS (31+53,3sobrepostos).
Grade-asrun0/famíliaprópriaencerrada. AsserçãoPARTIAL_PASS:senderOMTdiagnóstico
finalsemhorário,nãoafirmar estabilidade/execuçãosemerros;teardownantigoupstream
primeiro podeinduzirperda masorigem temporalnãoprovada. Controladorposterior
datafronteira/erros eparasendersprimeiro, aindanãoreexecutado. Overlaywebr68,
nãoinstalaçãor71/hardware/remoto. docs/QC-NDI-OMT-CONSULTAS-2026-10-15.md.
Prepararr71parcial comlote;semcleanup/migração/grupo8v3. Totais7/35/4/7mantidos.

15/10 —3.2 concluída no escopo nome/cadastro: descoberta nativa de 2NDI+2OMT
com Çãó, sem /sources simulado; cadastro e Master conferidos no navegador QA.
Nome abaixo da seleção/acompanha fonte/apelido preservado/restauração/gravação/
releitura PASS.3fontes/4mutações esperadas/grade-asrun0;4emissores exit0 semkill,
servidor e aba próprios encerrados.18observações+asserção readonlyPASS.
WebDRFai/B10A5AF6 igualr70, overlay explícito sobre servidorr68; devices com
trace opcional da fonte, foraZIP r70. Dois ensaios anteriores FAILpreservados:
timeout20s semcausa comprovada e comparação de caixa do nomeOMT corrigida só
no controlador; runtime devolve minúsculas, interface/banco preservam exato.
5testesunitários devices/build PASS; sem replay editoriais/novoZIP. Nãofecha
NDI/OMTexterno/QC/DeckLink/estação remota/instalaçãor70/Windowslimpo.
docs/NOMES-INPUT-DESCOBERTA-NATIVA-2026-10-15.md; evidênciavT4ELw.
Totais10/53:7concluídas/35andamento/4pendentes/7v3;grupo3:2/7concluídas.

15/10 —10.1 r70 parcial consolidada gerada540192664bytes, SHA256
4C4D638DD387245BCF67BF453AA789396D7D312CEF4A8DE259F87A1A5AA2F985.
Scanner+editores+acessoGrafismo/guardaprontidãoAutoFill; webDRFaiZfx/B10A5AF6,
servidor5F33C58E/engine3F0C9616. Builds PASS e ZIP7094hashes/7095entradasPASS
sem extração/execução. Instalação/startupr70 NOT_RUN; nãoherdar provasr68ou
overlayweb. r69preservada, semlimpeza/migração/IPremoto/publicaçãofinal.
docs/BUILD-PARCIAL-R70.md, scratch/r70-zip-integrity-20261015/result.json.
Totais10/53:6concluídas/36andamento/4pendentes/7v3 mantidos.

15/10 —6.1/6.2 fonte loteintegrado: metadata/impacto/artes/faixas/grafismo com
GET10s/escopo-geração/confirmadores inline e callbacks póscommit separados.
Histórico semsobreposição, consentimento individualcomando/token/nota, recibos
distinguem incerto/rejeitado/simulado/confirmado. Acesso Grafismo&Artes integrado
emSettings; AutoFillbloqueia proposta comfaixa localnãosalva.234casosdistintos/
17arquivos/tipos/builds PASS (232/233inicial; expectativaPOSTerrada→DELETE,
replay2PASS; +casoprontidão1/dirigido22PASSsem somar sobreposição).
QAoverlayweb zdTFwK: metadata10002ms/faixas10000/impacto10000, título+nomefaixa
PATCH200/audits1cada. i9LzXE/DRFaiZfx: artes/histórico10s, consentimento limpo,
PATCHarte1/paipainelbloqueado, AutoFillrascunhobloqueado. AsserçõesPASS/hashQC
preservados/scan-asrun-conta-receptor0/semexclusão ougrafismonoar; abas/processos
próprios encerrados. lmwR7Aexpirou30min/terminalexit0; erros conexão posteriores
não homologamrecuperação. Faltaqualificaçãointegrada/instalada/concorrênciavisual/
remoções autorizadas/restantes; grupo8v3. Prepararr70sem sobrescreverr69.
docs/EDITORES-LOTE-INTEGRADO-2026-10-15.md. Totais6/36/4/7 mantidos.

15/10 —6.1/6.5 fonte posterior àr69: ScanCommandDialog comGET10s/cancelamento
de leitura ao fechar/confirmadores inline por revisão-ação/captura profunda do
pedido e repetição comUUID/prova/modo/raízes originais, semabort de gravação.
39casos6arquivos/tipos/buildweb PASS. VisuallDk7DU/COhBd2bE com overlayweb
explícito sobre servidorr68: timeout10009ms, consentimento limpo ao mudar ação,
resposta502apóscommit200 e retry200comcorpoigual/uma decisão manual/mesmo lote
COMPLETED;3outros lotes automáticos vazios separados. FecharGETpendente6094ms,
asrun0/contas0/POSTreceptor0, aba/processo próprios encerrados. Semmídia/probe
executado/retomadavisual/PGM/hardware. Aviso/texto/canEdit final testado/build,
sem novo replayvisual; webfinalVDbA1LYp. Não incorporado na r69 preservada.
Faltamdemaiseditores/legadoreservas/qualificação integrada. Documento
SCANNER-CONFIRMACAO-VISUAL-2026-10-15.md. Totais6/36/4/7 inalterados.

15/10 —10.1 r69 parcial instalável gerada:540186632bytes/SHA256
5E51B978F35F3AF1229753BC9C08509AE46337509C218C4B0E03483D2FCE6C3C.
Integra correção dobootstrap/acervo/N-D; webB4CsWAEs/3F13498E, servidor5F33C58E
e engine3F0C9616 preservados. Builds atuaisweb/servidor/engine PASS; catálogoZIP
7094hashes/7095entradas PASSsemextração. Instalação/startupr69 NOT_RUN, provas
r68/overlays não transferidas. docs/BUILD-PARCIAL-R69.md e
scratch/r69-zip-integrity-20261015/result.json. Semlimpeza, IPremoto, sinais
externos ou publicaçãofinal. Totais10/53:6/36/4/7 mantidos.

15/10 —6.1 lote acervo/bootstrap: r68 instalada FxphMe PARTIAL_PASS, consultas
editoriais10s/teste deduplicado1POST+reenvio1POST/duas entregas DELIVERED,
mas cargaGLOBALcategorias25s504 e concorrência2 revelaram falha ainda na r68.
Fonte corrigida: operação independente do acervo/prazosGET10s/singleflight por
contexto/limpeza por sessão-canal/aviso persistente/N-D antes da primeira carga.
33testes6arquivos/tipos/builds PASS. Navegador bfRYn8/Rb3ouu com overlay web
explicitamente registrado: Master/Playlist/QC abrem durantefalha, máximo1GET,
recuperam semreload; mutações/asrun/POSTs0, abas/processos próprios encerrados.
Rodapé secundárioPlaylist ajustado depois, compilado sem novo replayvisual.
Preparar r69 parcial; fonte ainda fora da r68. IPremoto/Windowslimpo/sinalfísico/
licenças e demais cenários continuam abertos, grupo8v3. Semlimpeza/migração.
docs/ACERVO-INICIAL-INTEGRACOES-2026-10-15.md. Totais6/36/4/7 mantidos.

14/10 —10.1/10.2/10.4 r68 instalada em pastaQA nova, sem limpeza/overwrites:
instalador incorporado/7094 arquivos/reciboVERIFIED/perfil isolado/7atalhos PASS,
capacidadebundle+instalação+margemQA conferida antes da criação. StartupZZHDH6
PASS2536ms/Node24.16.0/PATH mínimo/SQLite dentro do pacote, semNODE_PATH/
NODE_OPTIONS do filho; HTTP/interface atual200, servidor encerrado. Nativoec33c0
PASS scanner/probe/proxy/arquivoUnicode/CUE/TAKE/QCperfil: imagemRTSP320x180,
desvio77,768/75quadroskeyframe-aware; bloqueios preservam PGM/CUE, reaprovação
permite TAKE e as-run SHA/revisão. Produto usa binários instalados5F33C58E/
3F0C9616, controladorQA usa ferramentas locais de teste (não requisito produto).
Saída null/sem navegador ou fontes externas/Windows limpo; família própria
encerrou. C livre939347968bytes; não fazer outra cópia completa sem capacidade.
Sem IPremoto/hardware/limpeza/publicaçãofinal. Gates10.x ainda abertos, totais
6/36/4/7 mantidos. docs/INSTALACAO-R68-2026-10-14.md.

14/10 —10.1 r68 parcial instalável gerada,540185450bytes/SHA256
F9A14A9AD0F885BB6A06D11862FDB01388EE087DF30080D6775C154F04D645EB.
Integra r67/logs de fundo/consultas e confirmações editoriais, webCc-PfGGg/
servidor5F33C58E/engine3F0C9616. Builds web/servidor/engine release locked PASS;
ZIP7094 hashes/7095 entradas PASS. Instalação/startup instaladosr68 NOT_RUN,
sem extraçãoQA, herança de homologação, limpeza ou teste operacional/remoto.
docs/BUILD-PARCIAL-R68.md. Totais10/53:6 concluídas/36 andamento/4 pendentes/7v3.

14/10 —6.1 fonte: integrações GET com prazo10s/fila sem sobreposição/canal
antigo cancelado/GETirmão drenado; mutações semabort, refresh nãofinge rollback.
Confirmações inline por ação/revisão em categorias/pastas/editor/reenvio,
semwindow.confirm nesses4componentes.38 casos/10arquivos/tipos/build PASS.
VisualaHmWLM/Cc-PfGGg: consentimento limpo ao trocar intenção, same-value peer
invalida gravaçãoverde, campos preservados/reabertura explícita azul, retirada
pasta bloqueada ao reconferir lista (sem remover). Integrações leitura apenas.
ReadonlyPASS: categoriaazul1/audits3(criação1+peers2), raizadicionada1, scan0,
as-run0/contamutada0/entrega0; processo exit0/aba própria fechada. Primeirotypecheck
JSXfalhou/chave corrigida; não somar os22casos anteriores. Semhardware/IPremoto,
remoções/gateway/latência visual completos permanecem abertos. Preparar r68
parcial com lote anterior de logs. docs/CONFIRMACOES-EDITORIAIS-2026-10-14.md.
Totais6/36/4/7 mantidos.

14/10 —6.1 visualWQl8im/B0b5xQEY: navegador de pastas na página encontra
Çãó/RegiãoÓptica, troca de caminho invalida conferência; cadastro1 e categoria
azul1 confirmados na página/banco/auditoria. Sonda ausente explícita, scan0,
as-run0, conta mutada0; pasta preservada. Peer concorrente NOT_RUN por revisão
automática indisponível, sem contorno; instância exit0/aba própria fechada.
Depois, fonte recebeu prazo10s/abort somenteGET em categorias/pastas/scanner,
resposta antiga/fechamento silenciosos, polling sem sobreposição, mutações sem
cancelamento.22 casos/7 arquivos/tipos/buildwebLkFuB0wC PASS; novo lote ainda
sem visual de atraso e fora da r67.6.1 falta interface completa/conflitos/
remoção/scan/integrações;6.3 visual de alterações de segurança não feito por
limite da habilidadecomputer-use. docs/PASTAS-CATEGORIAS-VISUAL-2026-10-14.md.
Sem hardware/IPremoto/limpeza/pacote novo; totais6/36/4/7 mantidos.

14/10 —6.3/6.4 lote integrado na fonte pós-r67: capturas de erro em index.ts
padronizadas{err}+contexto fixo, inclusive aviso scheduler fora do serializer
e unknown que poderia virar mensagem bruta. Códigos SQLite técnicos mantidos.
139 casos/10 arquivos/tipos/build PASS; compilado5F33C58E: expiraçãohrg0Kb,
contasBhAzZt e papéisFvhaxY PASS/exit0. Falha de audit preserva lote/login/
cinco mutadores; um vencedor concorrente; últimoadmin/ABA/stale protegidos;
revogação/expiraçãoHTTP/WS4401 e restart/revisões preservados. PGM/PVW são
simulados, backup prova estruturaSQLite, expiração controlada não é espera12h.
Processos/listeners próprios encerrados. Sembrowser/instalação/hardware/IPremoto,
sem nova build/limpeza. r67 não contém este lote posterior. Visual/interface,
comandos restantes e acesso remoto/proxy/HTTPS mantêmgrupo6 aberto5/5.
docs/SEGURANCA-INTEGRADA-CONTAS-2026-10-14.md; totais6/36/4/7 inalterados.

14/10 —10.1 r67 parcial instalável gerada,540183170bytes SHA256
292FE58A8CDEA1B1BC56B09664F92D1381BBE046A8BA0B9906AD16A42BAF4594.
Integra6.4 HTTP/log/cache/origens/Host, servidorCC32625E e webB0b5xQEY;
engine inalterado3F0C9616. Builds web/servidor/engine release locked PASS,
ZIP7094 hashes/7095 entradas PASS. Sem extração/instalação/startupQA r67,
sem prova remota/física nem limpeza. docs/BUILD-PARCIAL-R67.md.
Totais10 grupos/53 verificações:6 concluídas/36 em andamento/4 pendentes/7v3.

14/10 —6.4 admissão de Host na fonte: localhost/nome/IP local na porta real,
aliases explícitos sem wildcard, socket real sem confiar em Forwarded. Recusa
antes de login/CORS/static/WS e configurações inválidas antes de app/DB/runtime.
57 testes dirigidos/tipos/build PASS. Compiladobnigjr/CC32625E PASS:6 partidas
inválidas semDB/cofre,18HTTP e3WS, zeroas-run, engine/saídas desativados e
processo próprio encerrado. Falhas de fixture preservadas/explicadas no documento.
Operador informou192.168.42.172; não está no servidor remoto. IPsimulado coberto,
nenhuma conexão remota ou configuração operacional alterada.6.4 não concluída:
auditoria integrada/proxy/HTTPS/navegador remoto permanecem abertos.
docs/ENDERECOS-ACESSO-2026-10-14.md; preparar r67 parcial. Totais6/36/4/7.

14/10 —6.4 configuração de origens compartilhada/CORS/HTTP/WS fail-closed na
fonte, antes de app/banco/runtime. Rejeita null/curingas/credenciais/caminhos/
queries/fragmentos/controles/listas inválidas sem repetir valores; normaliza
autoridade válida/IPv6/porta padrão.45 casos dirigidos/tipos/build PASS.
Compiladoac50DO/79F6358D PASS:5 partidas inválidas exit1 sem banco/cofre,
17 casosHTTP (origens extras200 comcookie/401sem, outras403, página própria/CLI,
preflight204nãoautorizaTAKE401), WS extraaceito/opaco/estrangeiro403; zeroas-run,
engine/saídas desativados, servidor próprio encerrado. Não é navegador remoto,
TLS ou defesa Host/DNS completa. URL remota solicitada para admissão de aliases;
docs/ORIGENS-ACESSO-2026-10-14.md. Não integrado àr66; totais6/36/4/7 mantidos.

14/10 —6.4 passou a em andamento após lote HTTP/log/cache na fonte: req/res
sem URL/query/headers/body; erros HTTP sem mensagem/stack/causa brutos; 500 com
ID seguro,404 sem URL desconhecida, startup sanitizado e backup periódico
em logger privado. API controle privada/no-store; mídia preserva TTL privado,
Content-Range/bytes e assets web inalterados.31 casos distintos/tipos/build PASS.
CompiladoYmdGq8/A3BF3FC3 PASS: INFO real/12 marcadores ausentes, auth401/200,
origem externaHTTP/WS403, WS próprio, erro400/404/500, rollback auditado de login
sem sessão/cookie novo, falha periódica de backup sem caminho e Range206 intacto.
Engine/saídas desativados, byte fixture não é vídeo; processo/listener próprios
encerrados. FAILcJgFYA handler404 duplicado corrigido e preservado; demais
escopos/hashes antigos separados. docs/PRIVACIDADE-HTTP-LOGS-2026-10-14.md.
Sem nova instalação/ZIP: r66 não contém este lote. Totais agora6/36/4/7.

14/10 —10.1 r66 parcial instalável gerada,540177898bytes SHA256
855DC616B6AD4B0208FE1AE5C9614EC9876C45D598DF3179A7B7DD5546468DFA.
Integra publicação/rollback e confirmações inline deste lote. Builds web/
servidor/engine locked PASS; ZIP pós-geração7094 hashes/7095 entradas PASS,
sem extrair outra instalaçãoQA. Instalação/startup instalados r66 NOT_RUN;
não herda ensaios r65. docs/BUILD-PARCIAL-R66.md; totais10/53 mantidos6/35/5/7.

14/10 —4.1/4.5/6.2 confirmações operacionais inline na fonte: Próximo/Agora,
próxima grade, reconciliação e continuidade não usam caixa nativa; checkbox
desmarcado por conferência, troca/bloqueio/envio limpam consentimento e clique
repetido tem guarda imediata.6 casos dirigidos/tipos/build webCEI6tlbJ PASS.
Visual2jU2wg NEXT/NOW: troca limpa autorização, uma confirmação de cada;
revisões1→2→3, dois comandos/commits CONFIRMED, editorial8 preservado,
NEXTsem as-run, NOWNATIVE início0/fim1317/STOP. Aba/engine próprios encerrados.
Não é PGM físico; controles de próxima grade/continuidade/reconciliação ainda
sem cenário visual equivalente. docs/CONFIRMACOES-OPERACIONAIS-2026-10-14.md.
Totais6/35/5/7 mantidos; preparar r66 parcial sem nova instalaçãoQA.

14/10 —4.1/4.4/4.5 novo cenário nativo integrado CUE PASS/Pk9xnn: imagem RTSP
320x180/desvio29,834 e29,843 realmente decodificada; CUE recusa compensação
conferida antes, publicação incompatível e rollback que mudaria corte (409),
sem nova revisão nessas recusas. Publicação urgente de título mantém CUE/PGM;
limpar CUE permite compensação500→525 e rollback1→4, uma decisão de compensação,
revisão original/rascunho preservados. Mesmos PGMvt/startedAt1157280, cursor
sem retrocesso. STOP/cleanup próprios confirmados. Saída null/sem browser ou
fontes externas. Falhas VLjFfK/f8FELT/L5H95R preservadas: assinatura ausente,
trecho curto/captura inicial mid-GOP; leitor agora aguarda keyframe/75quadros,
sem afrouxar critério de imagem. docs/CUE-PROTECAO-NATIVA-2026-10-14.md.
Backend/engine inalterados; sem homologação remota/física. Totais6/35/5/7 mantidos.

14/10 —4.1/4.5 lote pós-r65 na fonte: consultas operacionais GET limitadas10s,
cancelamento de leitura antiga/irmã, falha não é histórico vazio; guarda imediata
de publicação/rollback, escritas não abortadas. Pós-commit só confirma sincronismo
após snapshot/carga e reconfere seleção antes/depois, inclusive sair/voltar.
27 casos dirigidos/tipos/build web PASS. Visual lOAOuP: comparação e conferência
rollback encerram~10s com bloqueio; publicação3 gravada/GET posterior falho não
anuncia sucesso nem repete escrita; rollback1→4 preserva rascunho/revisões1/2,
audita uma publicação/uma restauração, zero as-run. Aba/servidor próprios fechados.
Engine/saídas desativados; sem homologação PGM/CUE/remota. Guard final de fechar
histórico pendente ainda sem cenário visual de atraso. Não integrado à r65;
docs/PUBLICACAO-ROLLBACK-VISUAL-2026-10-14.md. Totais10/53 mantidos6/35/5/7.

Contagem estrutural conferível: node scripts/verify-pending-matrix.mjs;
--full lista grupos e as53 verificações com seus estados. Isso não homologa
implementações: provas e limites continuam nos registros de cada requisito.

14/10 —10.1/10.4 r65 integra6.3 consultas de contas/sessões e preflight local:
ZIP540175316 bytes SHA256
FD0089B0605F8FFEA04B005BED6EEC348BBA2ADF5EE97EF5D8E287C3BF2377C7.
Integridade7094 arquivos/instalação integral/7 atalhos PASS; reciboVERIFIED
spaceCheckedtrue/estimativa2153976738bytes. StartupWg79dV3087ms PASS Node
incluído/PATH mínimo/DB própria/interface atual200/hash; serviço encerrado.
PGM/engine desativados; não herda homologação r64/sourcevisual.6.3 segue aberto.
docs/BUILD-PARCIAL-R65.md. Totais10/53 mantidos6/35/5/7; r64 preservada.

14/10 —10.4 instalador confere capacidade em volumes locais antes de extrair:
bytes expandidos+64KiB/entrada+256MiB de margem, disponível à conta atual.
Insuficiência/volume indisponível recusados sem criar destino; recibo registra
checagem/estimativa. UNC mantém suporte com aviso explícito de espaço/quota
não conferidos. Teste aritmético/limite exato/insuficiência/entradas inválidas
PASS em verify-installer-capacity.ps1, sem instalação/disco cheio simulado.
Não prova quota concorrente/upgrade/rollback; pós-r64. Totais10/53 mantidos6/35/5/7.

14/10 —6.3 browserCEQ0LU timeout/reabertura de contas e sessões PASS: consulta
interrompida~10s, edição protegida, lista mantida, nova conferência carrega conta/
sessão com datas sem token/senha. Gateway de atraso próprio, backend real,
zero alterações de conta/revogação. Aba/servidor encerrados. Build webBJ2Vvwm5
PASS; pós-r64. docs/CONTAS-CONSULTAS-VISUAL-2026-10-14.md. Sem qualificação
de mutações/estação remota; totais10/53 mantidos6/35/5/7.

14/10 —6.3 conferência de sessões também limitada10s/cancelável ao fechar,
sem encerrar sessão por timeout. Consultas GET e mutações separadas; IDUnicode
codificado. Lote8 testes PASS (1 adicional/7 existentes), tipos web PASS.
Nenhuma sessão operacional alterada; prova visual e pacote pendentes. Pós-r64,
totais10/53 mantidos6/35/5/7.

14/10 —6.3 painel de contas usa leitura limitada10s/cancelável para catálogo
e canais. Fechar cancela apenas GET, falha de uma consulta drena a irmã;
timeout desbloqueia controle sem inventar catálogo vazio ou enviar mutação.
Guard de geração/campos preservados e reabertura explícita mantidos.7 testes
de API/política/markup PASS (1 novo/6 existentes); código posterior àr64,
sem prova visual de timeout ainda. Totais10/53 mantidos6/35/5/7.

14/10 —inventário automático10 grupos/53 IDs PASS, tabela por grupo/geral
conferida contra estados individuais.4 testes de parser/duplicação/divergência
PASS. Confirma6/35/5/7; não certifica requisitos nem conta rodadas de testes
como verificações novas. Nenhum runtime/build operacional alterado.

14/10 —10.1 r64 instalação/recibo VERIFIED/7 atalhos PASS; startupv5kC4V8708ms
PASS Node incluído/PATH mínimo/interface200/hash atual.2.5/5.4 integrado
6JimLM PASS sem override: CUE imagem320x180, recusas QC/perfil409 preservam
PGM/origem/CUE; restaurar/reaprovar libera TAKE/as-run hash/revisão. Runtimes
da instalação e DB/mídia próprias, família encerrada. Saída PGM nula, sem
browser/live/físico/remoto/Windows limpo. docs/BUILD-PARCIAL-R64.md.
Totais10/53 mantidos6 concluídas,35 andamento,5 pendentes,7 v3.

14/10 —10.1 r64 instalável gerada com perfil/timing consistente; builds PASS.
ZIP540174306 bytes SHA256
2C8A16D582948D59A961953403D70E3035E96F2B687CC85F333A688228FDC1A5.
Integridade7094 arquivos PASS, instalação/startup/funcional ainda NOT_RUN.
docs/BUILD-PARCIAL-R64.md. Totais10/53 mantidos6/35/5/7; r63 preservada.

14/10 —5.4 replay0EHhX2 PASS com servidor corrigidoE5E95ECD/runtimes r63:
CUE entrega imagem320x180 real; BLOCKED e perfil640 recusam TAKE409 sem mudar
PGM/origem/CUE; restaurar320/reaprovar libera TAKE e as-run hash/revisão.
Override explicitamente registrado, não modifica/aprova ZIP r63. Família
própria encerrada pelo harness; sem browser/live/físico/remoto. Expiração
anterior da aprovação não iniciou processo; uma repetição autorizada PASS.
Falhas3eGNj8/6I9YV5/6V67ru preservadas. Totais10/53 mantidos6/35/5/7.

14/10 —5.4 replay6V67ru FAIL antes de CUE/TAKE: execFile da sonda do proxy
falhou sem código/sinal/stderr persistidos. Sonda da mesma saída conferida
separadamente PASS601 quadros/2815 buffers áudio/320x180/10fps/48k estéreo
em9,3s; não comprova causa nem transforma integração em PASS. Log engine
reportou atraso de buffers; sem atribuir falha exclusivamente à carga.
Harness agora preserva code/signal/killed/stdout/stderr limitados8k para
diagnóstico futuro. Perfil/timing corrigidos ainda precisam replay integrado.
Falhas preservadas; totais10/53 mantidos6/35/5/7, sem nova build.

14/10 —5.4 replay6I9YV5 FAIL posterior ao overlay de perfil: final TAKE500
sem item disponível, pois timing ainda conservava DROPPED da avaliação anterior.
Fonte applyCommittedQcProfile agora reconstrói views/timing com os mesmos
itens/versões/revisão e perfil atual; fence de loads antigos mantido. Regressão
dirigida PASS com refresh retido:640→DROPPED,320→disponível; estado PGM intacto.
Falha preservada, replay integrado ainda necessário; pós-r63. Totais6/35/5/7.

14/10 —10.1 r63 instalada/smoke PASSckUapY8062ms,7 atalhos/recibo VERIFIED;
2.5/5.4 integrado3eGNj8 FAIL: DB perfil320 confirmado readonly, runtime
recusou TAKE com largura640 antiga. Logs/resultFAIL preservados. Fonte agora
applyCommittedQcProfile atualiza elegibilidade imediatamente/fence loadEpoch,
não reconfigura decoder nem altera PGM.3 casos dirigidos PASS (1 novo/2 antigos),
sem replay integrado dessa correção. Pós-r63, pacote intacto. Totais6/35/5/7.

14/10 —10.1 r63 instalável gerada com conflitos TAKE/preroll409 e diagnóstico
runtime indisponível409; builds PASS, ZIP540173817 bytes SHA256
41EF985DEA44F0957E11616B0BF9E80B70DD80F9A902E1231C6AC9EE04F54003.
Integridade7094 arquivos PASS, instalação/startup/funcional r63 NOT_RUN.
r62 e falhas preservadas. docs/BUILD-PARCIAL-R63.md. Totais6/35/5/7 mantidos.

14/10 —2.5/6.5 contexto editorial diferencia grade ausente404 de grade
existente/runtime bloqueado409 CHANNEL_RUNTIME_UNAVAILABLE, com orientação
de Monitor e sem editar itens.2 testes HTTP PASS, runtime indisponível simulado;
não homologa causa física de bootstrap/distribuição. Correção posterior àr62.
Totais10/53 mantidos6/35/5/7; próximo pacote deve integrar também conflito
de contrato/preroll já validado no replay MXzqwd.

14/10 —2.5/5.4 replay MXzqwd PASS: servidor corrigido c69011df + runtimes
instalados r62, override explícito sem modificar instalação. CUE320x180 com
imagem real, recusas QC/perfil409 preservam PGM/origem/CUE; reaprovação libera
TAKE/as-run hash/revisão. Sem browser/live/físico. Falha qTT92G anterior à
etapa TAKE preservada: broker sem PID confirmado bloqueou runtime e rota
de item retornou404 (esperado400 na fixture). Não aprova r62 original,
nem prova causa exclusiva dessa falha. scripts/verify-ingest-qc-take.mts
agora aceita server-binary e registra hash/override real. Totais6/35/5/7.

14/10 —2.5/5.4/10.1 r62 integrada bHV2fs FAIL: recusa de TAKE durante mudança
de disponibilidade/QC retornou500 em vez409. PGM preservado segundo erro,
mas ensaio não PASS e não fecha fluxo instalado. Logs/failure.json preservados.
Correção source classifica contratos alterados após CUE/preroll/verificação
como MediaVersionError409, sem contornar recusa nem trocar PGM. Pós-r62;
replay integrado ainda necessário. Totais10/53 mantidos6/35/5/7.

14/10 —10.1 r62 instalação PASS/recibo VERIFIED/7 atalhos conferidos;
startup5699ms PASS Node incluído/PATH mínimo/DB própria/interface atual200,
processo encerrado. Evidência RPlayout-portable-server-mgbMNW. PGM/engine
desativados; reprodução/visual desta edição não herdados. Espaço C verificado
antes(~9,49GB)/depois(~7,51GB), nenhuma limpeza/release removida.
docs/BUILD-PARCIAL-R62.md. Totais10/53 mantidos6/35/5/7.

14/10 —10.1 r62 instalável integra confirmação QC em página e hash singleflight;
builds web/servidor/engine PASS. ZIP540173766 bytes SHA256
3E60EFEEAD2E2B1B3B53FE697C2964498F5B8ACC53E49D451E711095A44DCC52.
Integridade7094 arquivos PASS; instalação/startup NOT_RUN, r61 preservada.
Identidade7 testes PASS após corrigir fixture de falha concorrente imediata;
produto não afrouxado. docs/BUILD-PARCIAL-R62.md. Totais10/53 mantidos6/35/5/7.

14/10 —3.6/5.3 FileVersionVerifier compartilha hash em andamento somente
para mesmo caminho/identidade/SHA. Cada leitor reconfere pathname após await;
cache e recusa de arquivo alterado preservados.20 leitores simultâneos com
cache desativado abriram arquivo1 vez; consulta posterior nova abertura;
SHA distinto não compartilha evidência.6 testes PASS (2 novos/4 existentes),
types servidor PASS. Não mede ganho CPU/rede remoto; código posterior àr61.
Totais10/53 mantidos6 concluídas,35 andamento,5 pendentes,7 v3.

14/10 —5.1/6.2 browser lbCjeS confirmação em página→retry→proxy READY e
auditoria/CSV com ator/job/versão/encerramento confirmado PASS. SQLite readonly
READY/hash válido/1 registro/ativo PENDING mantido. Servidor compilado atual,
webCCrYSjtX, pós-r61; banco próprio, PGM desativado. Aba/servidor encerrados.
docs/QC-LEGADO-AUDITORIA-VISUAL-2026-10-14.md. Multijob/troca/rede/carga ainda
abertos; totais10/53 mantidos6/35/5/7.

14/10 —5.1 confirmação de owner legado migra de window.confirm para página:
checkbox inicialmente desmarcado exige declaração de encerramento, retry
desabilitado até marcar; durante pedido controles desabilitados e confirmação
consumida. Troca de ativo/hash/conjunto de jobs remonta controle e limpa aceite.
Handler também recusa sem confirmação; servidor mantém gate boolean obrigatório.
8 testes PASS (3 markup novos/5 anteriores), types web PASS. Correção posterior
àr61, sem validação visual nova ainda. Totais10/53 mantidos6/35/5/7.

14/10 —5.1 r61 instalada ny8VBL: scanner/proxy/original/JPEG por proporção
PASS; QC abriu diretamente e exibiu FAILED legado, safe off. Clique retry
exibiu confirmação de responsável anterior. Controle browser interrompido
por confirm; getJsDialog indefinido e AX timeout, sem repetir clique nem
presumir autorização. Servidor próprio encerrado, teste de aceitação/auditoria
visual NÃO concluído. Fixture opcional --legacy-proxy adicionada ao harness.
Totais10/53 mantidos6/35/5/7; limitação não equivale a falha funcional provada.

14/10 —10.1 r61 instalada PASS/recibo VERIFIED/7 atalhos; smoke2719ms PASS
Node incluído/PATH mínimo/banco próprio/interface atual200/hash conferido.
scratch/RPlayout-portable-server-tjodUu/result.json, servidor encerrado.
Engine/PGM desativados; sem herdar ensaios físicos/visuais de edição anterior.
docs/BUILD-PARCIAL-R61.md. Totais10/53 mantidos6/35/5/7.

14/10 —10.1 r61 instalável integra lote5.1/6.2/6.4 recuperação/QC/auditoria;
builds web/servidor/engine PASS. ZIP540173172 bytes SHA256
E784598DFF950493D275ECFD8072C7FB7E637E59413903F9B7AB8E2E8C37AAA6.
Integridade7094 arquivos PASS, instalação/startup r61 NOT_RUN. r60 preservada,
sem transferir provas entre edições. docs/BUILD-PARCIAL-R61.md. Totais6/35/5/7.

14/10 —6.2/6.4 GET auditoria recebe Cache-Control private,no-store. Novo
caso HTTP/SQLite confirma retry visível à administração global, oculto de
escopo restrito de canal e sem caminhos/error/owner host/PID/boot no payload.
Rodada10 casos PASS (1 novo +9 existentes), types servidor PASS. Sem mudança
de permissão: registro global de acervo continua global, não atribuído a canal
por inferência. Pós-r60, falta fechamento integrado/visual. Totais6/35/5/7.

14/10 —6.2 auditoria UI traduz MEDIA_JOB_RETRY_REQUESTED, mostra job/versão,
tentativas e confirmação sem prometer conclusão/QC/TAKE. CSV ganha detalhes
autorizados com escaping existente; código técnico da ação preservado.
3 testes novos PASS, types web PASS. Falta prova visual/integrada desta
apresentação; não incluída r60. Totais10/53 mantidos6/35/5/7.

14/10 —5.1/6.2 retry HTTP passa a registrar MEDIA_JOB_RETRY_REQUESTED com
ator/job/versão/tentativas/confirmação legado na mesma transação da fila;
sem caminhos/erro bruto, automaticTake:false. Insert síncrono .run(): falha
de auditoria desfaz admissão e não inicia tick. Primeira rodada revelou callback
async inadequado e leitura de payload cifrado na fixture; ambos corrigidos.
Rodada autorizada28 casos PASS (23 workflow/5 rotas); rodada restrita anterior
também apresentou falhas de workflow, não descartadas como prova de produto.
Sem homologação visual de auditoria/instalador, código posterior àr60.
Totais10/53 mantidos6/35/5/7.

14/10 —5.1 quatro casos HTTP/SQLite reais de admissão PASS: owner desconhecido
exige booleantrue; recusa conserva linha; RUNNING não é tomado mesmo confirmado;
duas solicitações concorrentes admitem só uma200/outra409; payload inválido400
sem alterar DB. Worker tick simulado: não comprova execução nativa ou UI legado.
apps/server/src/domain/media-retry-routes.test.ts. Totais10/53 mantidos6/35/5/7.

14/10 —5.1 QC browser Eucuje recuperação real PASS: cache próprio corrompido
gera FAILED/aviso, clique retry→fila→proxy leve/reprodução habilitada. SQLite
readonly confirma mesmo job READY/hash bytes/ativo PENDING/mesma edição.
Servidor atual compilado, webBBQoObDq, não r60; PGM desativado. Aba/servidor
encerrados. docs/QC-RETRY-VISUAL-2026-10-14.md. Owner legado/multijob/falhas
remotas ainda não homologados; totais10/53 mantidos6/35/5/7.

14/10 —5.1 dois testes adicionais do cliente API PASS: GET workflow abortado
não cancela POST retry; IDs Unicode/caminho/hash corretamente codificados,
confirmação legado enviada. Falha parcial HTTP409 conserva só pedido sem
confirmação, sem replay do sucesso. Rodada10 testes PASS inclui8 já existentes
(não somar como verificações novas). Fetch simulado, sem evidência browser ou
servidor real deste fluxo. Totais10/53 mantidos6/35/5/7; r60 inalterada.

14/10 —5.1 QC leitura de workflow agora usa BoundedLatestRead: uma consulta
por vez, prazo10s, descarte de resposta obsoleta e cancelamento ao trocar
seleção. Retry cancela apenas leitura, pausa polls até todos os pedidos
terminarem e bloqueia clique duplicado por referência síncrona. Mutação
não é abortada nem tratada como rollback. Lote11 testes de políticas PASS,
sem prova integrada browser deste fluxo. Código posterior àr60; totais6/35/5/7.

14/10 —5.1 QC retry em lote usa allSettled: aguarda todos os pedidos antes
de desbloquear controle; remove da lista apenas respostas ok:true, mantém
pedidos sem confirmação e distingue falha de resposta de rejeição. Confirmação
de responsável legado e guard de seleção proxyGeneration preservados.
5 testes PASS (3 frontend/2 diagnóstico servidor). Código posterior àr60;
sem build instalável/visual deste lote, sem alterar jobs operacionais.
Totais10/53 permanecem6 concluídas,35 andamento,5 pendentes,7 v3.

14/10 —10.1 r60 arquivo integrado PASSWitzMo: scanner/proxy reais, CUE com
imagem publicada320x180, TAKE implícito recusado por QC/perfil preserva origem
PGM/seleção; reaprovar permite TAKE nativo e as-run hash/revisão. Componentes
da instalação/PATH mínimo/saída física desativada; sem prova browser/live/remota.
docs/BUILD-PARCIAL-R60.md, scratch/RPlayout-ingest-qc-take-WitzMo/result.json.
Totais10 grupos/53 verificações mantidos6/35/5/7. Grupo10 ainda aberto.

14/10 —10.1 r60 instalação integral PASS/recibo VERIFIED e7 atalhos conferidos;
startup instalado PASS2395ms, Node incluído/PATH mínimo/banco próprio/interface
atual200/hash conferido, servidor encerrado. Evidência XvC0Si; tentativa anterior
Evw8D5 EACCES preservada, nova execução após terminal com rede autorizada.
Engine/transmissão desativados; não homologa audiovisual/hardware/Windows limpo.
docs/BUILD-PARCIAL-R60.md. Totais10/53 permanecem6/35/5/7.

14/10 —10.1 r60 instalável parcial gerada com correção4.4 seleção obsoleta,
builds web/servidor/engine PASS. ZIP540171834 bytes SHA256
BE10595F6D1B9BA14812B93BBE1D4CED3275F46D370658238517472100642BEF.
Integridade7094 arquivos PASS em scratch/r60-zip-integrity-20261014;
instalação/startup/visual NOT_RUN nesta edição, sem herdar provas r59.
docs/BUILD-PARCIAL-R60.md. Totais6/35/5/7 mantidos, sem limpar releases/bancos.

14/10 —4.4 seleção obsoleta corrigida: item removido da lista desabilita
conferência/confirmação e oculta revisão antiga imediatamente; seleção é limpa
quando não há comando pendente/incerto. Recibo e requestId incerto preservados
para consulta/reenvio idempotente. Lote frontend27 testes PASS, build web
index-xcL5h0FB.js PASS. Ainda não integrado ao ZIP r59, sem nova prova visual.
Totais10 grupos/53 verificações:6 concluídas,35 andamento,5 pendentes,7 v3.

14/10 —4.4 GUI local quatro ações PASS l9gMn5: filler+2,5s,trim-2s,
remoção opcional,atrasoSOFT+5s; revisões2..5,protected recusado. SQLite
readonly confirma4 decisões/5 revisões e rascunho50/125/75 intacto.
docs/COMPENSACAO-VISUAL-2026-10-14.md. Cleanup próprio confirmado; sem
homologação física/rede/latência/soak. Operador confirma ausência de emissores
externos NDI/OMT; essa validação segue pendente. Totais6/35/5/7 mantidos.

Correção de rastreabilidade: registros recentes de otimização/medição dos
scopes rotulados3.6 pertencem à **3.7 Scopes/áudio e telas compartilhadas**.
**3.6 é Preview econômico**, cuja medição remota continua faltando. Os
registros antigos foram preservados, mas não mudam a identidade dos requisitos.
Nesta revisão,2.3 e3.6 passam para em andamento: ensaios nativos NDI locais
e preview/proxy econômico já têm evidências; falta homologação externa/remota.
Nenhuma verificação foi concluída por isso. Totais atuais:10 grupos/53 checks,
6 concluídas,35 em andamento,5 pendentes,7 v3. Contagens abaixo são históricas.

14/10 —10.x r59 integrada PASS4MZuSe: CUE entrega imagem publicada320x180,
TAKE bloqueado/incompatível preserva PGM/origem/seleção; após reaprovar,
TAKE implícito do CUE confirmado com as-run hash/revisão. Pacote instalado,
banco/mídia isolados, saída nula; não prova NDI/OMT real/browser/remote.
Resultado scratch/RPlayout-ingest-qc-take-4MZuSe. Totais6/33/7/7 mantidos.

14/10 —10.x r59 instalada PASS (recibo VERIFIED/7 atalhos conferidos),
startup2170ms/Node incluído/PATH mínimo/DB isolado/interface atual e exit
observado: RPlayout-portable-server-sjJ67g. Engine/PGM desativados no ensaio;
testes de runtime/hardware r58 não são transferidos automaticamente.
Totais atuais10/53 mantidos6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —3.6/10.1 r59 instalável parcial integra lote scopes/áudio/medição,
interface index-DyNF8__v.js; builds servidor/engine locked PASS.
ZIP540172023 bytes SHA4346CF430BAC463F6E5E255D55A868F8EFC319BAF217C29DCC7AEF0F8E3A4232.
Integridade7094 arquivos/7095 entradas PASS. Instalação/startup r59 NOT_RUN,
sem herdar provas r58. Licenças/remoto/sinais/carga continuam abertos.
Totais10/53 mantidos6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —3.6 Canvas browser GJONi4:6 pares barras/ruído/Parade260/800/vetor,
zero bytes diferentes no ImageData. Medianas de comandos Canvas:Parade800
2.3→1.8ms;vetor barras2.8→1.1ms;compacto2.3 e vetor ruído4.7 sem ganho.
Sem fenceGPU/carga longa/randomização, não benchmark integral QC/host/remoto.
docs/QC-CANVAS-COMPARACAO-2026-10-14.md. Totais10/53 mantidos6/33/7/7.

14/10 —3.6 vectorscope: cache de cor por passe evita strings/trocas Canvas
quando RGB calibrado consecutivo é igual; ordem de todos os pontos mantida,
sem reutilizar estado de outro canvas/passe. Lote18 testes PASS, types/build
web PASS index-DyNF8__v.js. Ganho depende da imagem (gradiente pode não reduzir
trocas); benchmark visual/carga pós-lote e nova build instalável pendentes.
Totais atuais10/53 mantidos6/33/7/7. R58 não foi alterada.

14/10 —3.6 Parade: corrigida condição da otimização. Canvas compacto260px
tem pontos subpixel sobrepostos entre colunas; preservada ordem RGB original
para manter composição alfa. Agrupamento3 cores apenas quando dot<=colW/80
(canvas amplo800px satisfaz). Dois testes dirigidos PASS, types/build PASS
index-kfIjgynt.js. Registro anterior10800→3 não vale para todos os layouts;
não concluir ganho universal. Conferência visual/benchmark continuam abertos.
Totais10/53 mantidos6/33/7/7; nenhuma mudança na r58 instalada.

14/10 —3.6 RGB Parade: desenho por coluna/canal, trocas fillStyle reduzidas
de10800 para3 por passe, preservando10800 pontos e coordenadas/amostras RGB.
16 testes do lote PASS, types/build web PASS index-BMfY8ENN.js. Não equivale
a ganho percentual medido ou comparação pixel-a-pixel de antialias/blending;
falta replay visual/medição real pós-alteração e carga/remoto. R58 intacta,
nova interface ainda não empacotada. Totais atuais6/33/7/7 mantidos.

14/10 —3.6 indicador QC conferido no navegador Z6htSV com build atual:
parado4Hz/p95 inicial18.0–20.7ms; Play mudou para10Hz, proxy real426x240
reproduziu até10.048s e voltou a4Hz após EOS (p95 observado16.4ms).
É janela móvel de desenho local, não CPU/RAM/rede/latência do decoder,
sem baseline comparativo ou conclusão de ganho percentual. Scopes desenhados
visualmente, PGM desativado, nenhum QC aprovado, fixture encerrada/exit0.
Captura scratch/qc-scope-cost-proof-Z6htSV/scopes.png. UI atual não integrada
na r58. Carga prolongada/remoto/hardware continuam abertos. Totais6/33/7/7.

14/10 —3.6 custo scopes: janela reiniciada ao mudar canal, ativo/hash,
entrada, qualidade, reprodução por JPEG ou layout de scopes; evita p95
herdado de outra fonte. 3 testes do helper PASS (inclui reset), types/build
web PASS, index-lnjGNDrx.js. Não é medição de desempenho real; conferência
visual/carga/remoto continuam abertas. R58 não alterada. Totais6/33/7/7.

14/10 —3.6 medição local de desenho de scopes implementada: janela limitada
a120 amostras, p95/max, publicação UI até1Hz; custos inválidos recusados.
UI mostra4Hz parado/até10Hz reproduzindo em vez de10Hz fixos. Aviso explícito:
não mede decoder/rede/CPU host. 14 testes do lote PASS, types/build web PASS,
index-lXNswZXp.js. Medição real sob carga/remota e regressão visual deste
indicador ainda abertas; não incluído na r58 gerada. Totais6/33/7/7 mantidos.

14/10 —3.6 scopes/áudio: gradiente do espectro reutilizado por passe de canvas
(1 em vez de24 idênticos), estado de áudio preserva identidade se leitura
igual, evitando rerenders periódicos inativos. Mudanças de pico/fase/atividade
continuam atualizando. 12 testes do escopo PASS, types/build web PASS,
index-CNpx8ufQ.js. CPU/RAM/rede sob carga ainda NÃO MEDIDOS; não declarar
ganho percentual ou homologação. Alteração não incluída na r58 já gerada.
Totais mantidos 10/53:6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —3.4/3.5 QC visual r58 PASS no escopo local u6WVWl: QC direto,
safe inicial OFF, original4:3 carregado640x480, tela cheia e vertical com
retículo limitado ao raster (DOM489.6x864/left523.2), não às barras pretas.
Nenhuma aprovação/TAKE; engine PGM desativado, fixture encerrada.
docs/QC-VISUAL-R58-2026-10-14.md e capturas em scratch/u6WVWl (prefixo
RPlayout-QC-file-browser-). Remoto/carga/escuta/sinais externos não certificados.
Operador informou não possuir os termos originais NDI: distribuição continua
pendente, sem declarar runtime homologado. Totais mantidos 6/33/7/7.

14/10 —10.x r58 instalada fluxo de arquivo CUE/PVW/TAKE PASS uvbX0L:
imagem real publicada 320x180, QC BLOCKED/perfil incompatível recusam TAKE
implícito preservando PGM/origem/CUE, reaprovação leva o CUE ao PGM,
as-run com hash/revisão. Resultado scratch/RPlayout-ingest-qc-take-uvbX0L.
Não estende validação a browser/rede remota/NDI/OMT/SDI ou áudio ouvido.
Solicitado caminho dos termos originais NDI6.3.2 para revisão de distribuição.
Totais mantidos 10/53:6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —10.x r58 instalada: exit0/recibo VERIFIED e 7 atalhos PASS,
verificação nativa integral PASS (SQLite/MSVC/plugins/engine ready/shutdown,
PATH portátil), servidor PASS2727ms/Node incluído/interface atual/banco isolado,
encerramento observado: RPlayout-portable-server-0vMBVc. Inventário de avisos
548 arquivos/19 apontamentos REVIEW_REQUIRED dSvc6C; exclui JSON de metadados.
Não qualifica browser/remoto/Windows limpo/sinal real. R57 preservada.
Totais mantidos 10/53:6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —10.1/10.2 r58 parcial instalável gerada com interface atual,
avisos Node/GStreamer/Rust e inventários JS com Drizzle pinned.
Cargo release --bins --locked PASS, builds web/servidor observados PASS.
ZIP540171029 bytes, SHA83293FB231D50F22F3067378C05B7FD66ED72B5BFB8EE489FA12ACC775AB6B1C.
Integridade PASS7094 arquivos/7095entradas; instalação/startup r58 NOT_RUN.
R57 preservada. Termos NDI/MSVC/abstract-logging e homologação continuam abertos.
Totais atuais 10/53:6 concluídas/33 andamento/7 pendentes/7 v3.

14/10 —10.2 Drizzle: aviso vinculado ao commit oficial
03f6239c53c7132cf8ef08ff4f0cf70a1009de3f e incorporado aos inventários/bundles
via RPLAYOUT_NOTICE_OVERRIDE_DIR. Build servidor PASS, 3 testes do coletor
PASS incluindo recusa de aviso alterado; restante JS sem aviso: abstract-logging.
Coleta scratch/js-notice-origin-pjx8MG. R57 intacta, próxima build ainda aberta.
Totais 6/33/7/7 mantidos; termos NDI/MSVC/revisão integral permanecem abertos.

14/10 —10.2 fontes JS: LICENSE oficial Drizzle 0.36.4 localizado, tag
com nome/versão conferidos; falta pin de commit e inclusão no bundle.
abstract-logging 2.0.1 commit npm identificado, LICENSE upstream 404,
README aponta licença externa; não inventado aviso. Evidência
scratch/js-notice-origin-0QfhPr/result.json. Totais 6/33/7/7 mantidos.

14/10 —10.2 Rust: coleta offline/locked Windows implementada e executada,
75 pacotes/144 avisos/nenhuma ausência; grafo conservador incluindo build/test,
não attestation dos executáveis. scratch/rust-notices-bezFtw/inventory.json.
Empacotador inclui via RustNoticesDirectory com guards de lock/hash/caminho.
Faltam avisos JS abstract-logging/drizzle-orm, termos NDI/MSVC e revisão
integral de redistribuição; próxima build com todos os avisos ainda não gerada.
Totais mantidos 10/53:6 concluídas/33 andamento/7 pendentes/7 v3.

10.2 servidor: inventário por módulos realmente incorporados implementado
nos 12 artefatos esbuild, build PASS e 2 testes de coleta PASS. 75 pacotes,
avisos copiados/hashes vinculados aos bundles; abstract-logging/drizzle-orm
sem aviso direto, revisão necessária. server.cjs SHA preservado; relatórios
em apps/server/dist/third-party. Não cobre SQLite externo/Rust/termos NDI/MSVC,
nem incorpora mudanças na r57. Totais atuais 6/33/7/7 mantidos.

10.2/10.5 atribuição NDI na interface implementada (link oficial/marca),
5 testes dirigidos PASS e types/build web PASS por validadores locais.
Inventário de frontend incorporado integrado à build: 4 pacotes, 4 avisos
com hashes e nenhuma ausência nesse conjunto; REVIEW_REQUIRED (não legal
clearance). Artefato atual index-PQSvNklv.js, não integrado retroativamente
à r57. Faltam servidor/Rust/NDI/MSVC e redistribuição integral. Nada apagado.
Totais atuais mantidos: 10/53, 6 concluídas/33 andamento/7 pendentes/7 v3.

10.2 aviso Node v24.16.0 coletado da origem oficial e vinculado ao SHA do
runtime incluído, 156926 bytes; scratch/node-notices-qjLdex/provenance.json.
Inclusão no próximo ZIP implementada com NodeNoticesDirectory e guards de
versão/origem/hash. Ainda não gerada nova build com avisos; faltam NDI/MSVC,
Rust/frontend e revisão integral de redistribuição. Totais 6/33/7/7 mantidos.

10.2 avisos GStreamer: 206 documentos localizados na distribuição local,
runtime correspondente à base conferido por hash; CRT Microsoft separado
e assinatura validada. Inclusão no próximo ZIP implementada via parâmetro
GStreamerDistributionDirectory no empacotador streamed. Não gerada nova
build nesta etapa; r57 imutável. Licenças Node/NDI/MSVC e dependências
incorporadas/obrigações de fontes ainda abertas. Totais 6/33/7/7 mantidos.

10.2/10.5 auditoria de avisos: REVIEW_REQUIRED 0feAK8, 126 metadados npm,
120 avisos verificados por manifesto, 21 apontamentos. OMT/MediaMTX com
aviso presente; Node/GStreamer/NDI/MSVC sem aviso nas pastas esperadas.
Inventário não é liberação jurídica; faltam proveniência/termos efetivos,
avisos e obrigações de dependências nativas/Rust/frontend. Relatório em
docs/LICENCAS-PACOTE-R57.md. Não publicar como versão homologada final.

10.2 passa de pendente para **em andamento**: dependências materializadas,
SQLite/ABI, MSVC app-local, plugins e execução nativa do pacote comprovados.
Falta concluir auditoria de redistribuição/licenças e qualificação externa;
não está concluída. Contagens antigas nos registros abaixo são históricas.
Totais atuais: 10 grupos / 53 verificações; **6 concluídas, 33 em andamento,
7 pendentes e 7 v3**.

5.4/10.x QC de áudio integrado PASS IKccBA: arquivo completo medido,
perfil completo válido, limites incompatíveis de LUFS/true peak recusam
aprovação e TAKE preservando PGM/origem; perfil restaurado permite TAKE
e as-run com hash/revisão. Não certifica medidor contra referência externa.
5.2/10.x troca real de arquivo PASS NHULzk: nova edição PENDING, revisões
antigas de QC/preview recusadas, arquivo arquivado/hash antigo preservado,
bloqueio da nova edição não revoga a anterior aprovada. PGM publicado não
muda com scan; republicação no ar recusada, após STOP nova publicação e
TAKE confirmam novo hash. As-run antigo/novo e publicação antiga imutável.
Resultados em scratch/RPlayout-ingest-qc-take-IKccBA/result.json e
scratch/RPlayout-ingest-qc-take-NHULzk/result.json. Pacote r57 instalado,
servidor/engine/probe/proxy/Node incluídos; saída nula, não físico/browser.

13/10 — 5.x/10.x CUE de arquivo da r57 instalada PASS GfoBlR:
PVW publicado via MediaMTX incluído/loopback, quadro RTSP decodificado
320x180 com luminância não uniforme, PGM e origem preservados.
TAKE implícito recusado após BLOCKED/perfil incompatível sem perder CUE;
reaprovação/perfil válido levou item em CUE ao PGM, as-run hash/revisão.
Não estende prova de arquivo a live, navegador, áudio ouvido ou rede remota.
Evidência scratch/RPlayout-ingest-qc-take-GfoBlR/result.json.
Totais mantidos: 10 grupos / 53 verificações; 6 concluídas, 32 em andamento,
8 pendentes, 7 v3. Windows limpo/sinais externos seguem abertos.

13/10 — 5.x/10.x r57 instalada: fluxo integrado arquivo PASS 9HDvs3,
scanner/probe/versão/proxy reais, aprovação QC, publicação, TAKE nativo,
recusa PENDING/BLOCKED/perfil incompatível preservando PGM, reaprovação
e as-run com hash/revisão. Servidor/engine da instalação, Node incluído
e PATH mínimo. Fonte só cria a estrutura inicial do banco isolado.
Proxy 320x180/10fps sem upscale; expectativa antiga 240p corrigida após
falha VCVJ91. CUE/browser/sinais externos/Windows limpo não certificados.
Evidência scratch/RPlayout-ingest-qc-take-9HDvs3/result.json.
Totais: 10 grupos / 53 verificações; 6 concluídas, 32 em andamento,
8 pendentes, 7 v3. Critérios amplos continuam abertos.

13/10 — 9.3/10.x engine RELEASE instalado r57 PASS em EqvzKi:
LOAD/TAKE de VT com áudio/caminho Unicode, HOLD quadro 8, processo original
encerrado, novo processo restaura HELD/cortes 25..400, 11 posições estáveis,
relógio ativo e shutdown 0. Node/GStreamer incluídos, PATH mínimo.
Não prova reprodução integrada servidor/browser, pixels, sinais físicos
ou recuperação de host; esses critérios seguem abertos.
Totais mantidos: 10 grupos / 53 verificações; 6 concluídas, 32 em andamento,
8 pendentes e 7 v3. Evidência scratch/held-process-EqvzKi/result.json.

13/10 — 10.x r57: instalação integral PASS (exit 0, recibo VERIFIED),
sete atalhos conferidos, manifesto/SQLite/MSVC/plugins/engine portátil
ready/shutdown PASS. Verificador corrigido para UTF-8 no PowerShell 5.1.
Servidor instalado PASS em 2188 ms com Node incluído/PATH mínimo,
banco isolado e encerramento observado: RPlayout-portable-server-5TivjF.
Removidas somente as duas cópias QA r54/r55 autorizadas; originais ZIP
e evidências preservados. Supera NOT_RUN de instalação nos registros antigos.
Faltam reprodução integrada r57, Windows limpo, homologação remota e
sinais reais; DeckLink física adiada e grupo 8 reservado à v3.
Totais: 10 grupos / 53 verificações; 6 concluídas / 32 em andamento /
8 pendentes / 7 v3. Nenhuma verificação ampla encerrada só por esse ensaio.

13/10 —9.3 unknownspawncrashGbbjgDPASS:reserva beforeSpawn gravada,
worker33804crashed/guard34104terminal;SPAWN_UNCONFIRMEDrecusa claimduplicado,
checkpoint8HELD/origem/STARTINGpreservados,0tentativasliberação. Retry
storageocupadorecusado. Não infere parada de engine desconhecido nem libera
reservaautomaticamente. Nãohostpowerloss/físico.9.3faltam outrohost/conta,
políticacompletareconciliação e homologação externa;10instalação integral
aguarda espaço,solicitada autorização remover sóQA r54/r55,nadaapagado.
Totais10/53:6/32/8/7;r57intacta.

13/10 —10.x r57 startup SELECIONADO BfFKA0PASS:5854entradas originais,
797GSTomitidas por espaçoC;Node incluído/PATHmínimo,DBnovo,health/interface200,
2164ms eexitconfirmado. Engine/PGMdesativados. Não qualifica instalação
completa/GStreamer/reprodução;receiptseleção e docsBUILD-PARCIAL-R57.md.
Instalação/atalhos/startupintegral continuam pendentes. Totais10/53:6/32/8/7.

13/10 —10.x r57 integridade internaPASS:6651entradas/6650hashes+tamanhos,
engineReleaseSHA3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
LeituraMemoryStream com margemGC verificada,sem duplicarpayloadnoC.
Resultado r57-zip-integrity-20261013/result.json. Instalação/startupNOT_RUN,
nenhumarquivo removido. Totais10/53:6/32/8/7.

13/10 —9.3 lote agrupado56testsPASS:concessão local/admissão nativa/
checkpoints/reviewrestaurado. Types/servidor/Vite/engineReleasePASS;frontend
index-zU0KpS_k.js.10.xr57instalávelgerado538655472bytes,comloterestauração/
close/PVWdiagnóstico. Instalação/startup/integridadeinterna r57NOT_RUN;
versionsanteriorespreservadas. Docs BUILD-PARCIAL-R57.md.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —9.3 crashNode pósrecibo/prepersistência sGTADuPASS:worker7632exit
observado,engine5360eguard33008terminal(sóconsultados,nãokillhistórico).
STARTING/origem/cursor9HELD/1ATTEMPTED0CONFIRMEDpreservados;retryrecusado
pelareservaStorage,semnovaativação. Primeiraa io fzA esperava outroguard;
zmM3Bv tentouantesguarddrainHOSTnãoadmitido;fixtureagoraaguarda próprio
guardterminal,sem afrouxar produto. Primeira evidência aiofzA tinha passedtrue
comerror apesarexit1;catchagoragravapassedfalse. Não é quedaelétrica/host.
Falta build/instalador e revisão consolidadagrupo9. Totais10/53:6/32/8/7.

13/10 —9.3 renovação negadaII7Lg6PASS:engine28512expirounativamente(exit75/
signalnull),sem killfixture,0reciboliberação;FAILED/cursor7HELD/origem
preservados,enginePids[]. Tentativaantesliberação durável,não falso rollback.
Mensagemserver generalizada deHA para concessãonativa pois também élocal.
Falta crash abrupto/typechecks/build e outrascondiçõeshost. SaídaNull,não
físico/HAorquestrado. Totais10/53:6/32/8/7;r56intacta.

13/10 —9.3 positiva pósledger/correçãoclose OscZ5zPASS:backupHELDcopy,
CONFIRMED/cursor9/corte/SHA/executionIdpreservados,1ATTEMPTED/1CONFIRMED,
pausaestável1,5s ecloseconcluído. Complementa parcialETqFHB. Ainda faltam
crash/perdaconcessão/compiledinstaller e sinaisfísicos. Totais10/53:6/32/8/7;
r56intacta;nenhumgroupconcluído só comNullfixtures.

13/10 —9.3 multicanal parcial ETqFHBPASS:backupreal2HELD,prepara ambos,
liberaprimeiro/recusasegundo. Ledger2ATTEMPTED/1CONFIRMED,FAILED/origem
preservada,cursorHELDambos,enginePids[]dosdoisapósclose. Não anuncia rollback
total;saídasNull/falhainjetadaantessegundodispatch,nãocrash/físico.
Próxima positiva confere1/1ledger apóscorreçãoclose; r56intacta.
Totais10/53:6/32/8/7;grupo8v3nãoorquestrado.

13/10 —9.3 falha pós-release native lKiyOOPASS:recibopaused/cursor6/
term2confirmado antes errofixture,FAILED/origemquarentena/cursorHELD
preservados,enginePids[],aviso explícito nãoérollback. Novo ledger criptografado
ATTEMPTED antesdispatch/CONFIRMED apósretorno porcanal/bus/ativação;
teste tem1tentativa/0confirmações(ponto de falha entre recibo e banco).
Falta types/regressãopositiva apósledger,multicanal/crash/posse. r56intacta.
Totais10/53:6/32/8/7;sem publicação física/HAorquestrado.

13/10 —9.3 falha pré-release backupHELD PASSb1HILN:FAILED,origemquarentena
preservada,cursor9HELD,enginePids[] apósclose. FalharDD4ok revelouDB fechando
antescallbackexit(PID16020jáausente). app.close agora aguarda closeConfirmed
nativo antesstorage/posse,segunda chamada retorna mesmaespera. Tentativa
intermediáriaBLtG42 de fecharasrun apósruntime.close revogouposse foi removida;
flush mantém contrato próprio anterior. Faltam types/build/regressãoclose,
falhas apósdispatch/multicanal/crash. Totais10/53:6/32/8/7;r56intacta.

13/10 —9.3 backupHELDreal/sourceworker→exitobservado→restorecopy→ativação
explícita PASS69Hm8Y (origemXazNBv):cursor8/playingfalse/HELD,corte25..400/
SHA/execução preservados,novaposse,activationCONFIRMED/origemarquivada,cursor
imóvel1,5s apósrelease. NativeNull,não físico/browser/Windowslimpo. Todas
pastasfixturesisoladas;PIDshistóricos só consultados,nunca mortos. Primeira
fixture falhou loaderURLWindows antesengine,corrigida semprodutoalterado.
Falta negativas concessão/saída/crash,multicanalparcial e buildinstalável.
Totais10/53:6/32/8/7;r56intacta;grupo8v3nãoorquestrado.

13/10 —9.3 activateRestoredApp liberaPreview separadamente depoisPGM de
todos canais,se monitorPVWconfigurado. Ensaio native local-held-preview
sPH0BFPASS:recusa antesPGM,recibo pausedcursor8/decode1/corte25..400,
PVWadmitido apósPGM,cursor imóvel. Publisher sob demanda não ativado;
nãobackupcopy/browser/físico. Falta types/build dessa integração,cópiaHELD
real e negativas parciais/crash. Totais10/53:6/32/8/7;r56intacta.

13/10 —9.3 activateRestoredApp integrado à preparação local:capacidade
selada pausedPreparation só na ativação explícita,reviewdefault ainda recusa
HELD;runtime outputsHeld+concessãolocal;prepara todos canais antesliberarPGM;
HELD exige estado/corte/cursor exato e release paused. Concessão continua
apósCONFIRMED sobmesmacapacidade/hoststorage. TypesPASS,3negativasPASS e
1reviewHELDopt-inPASS(cursorpreservado/semativar). CanalarchivadoHELDbloqueado.
Falta cópiarealbackup/ativação/erro parcial/previewpreparedrelease e falhas
deposse/crash. Integraçãofonte ainda nãohomologada/build; r56intacta.
Totais10/53:6/32/8/7;grupo8v3nãoexecutado.

13/10 —9.3 admissão local nativa/hostbroker/runtime PASS wyiIc3:saídas
retidas desdeReady;liberação pausedtrue com cursor8/corte25..400/SHA/decoder1/
ownerterm1/firstVideoConfirmedtrue;cursor imóvel1,2s. Nulloutput,não backupcopy
ativado/sinalfísico. PrimeiraSzsVFFrecusou por cursor telemetry atrasado após
HOLD;fixture passou ao aguardar posição nativa coincidir,guardnão removido.
before-paused-admission.json preserva divergência. Cleanup próprio finalmente.
Ainda falta integrar cópiaHELD em activateRestoredApp/guards/recoveryatomic.
Totais10/53:6/32/8/7;r56intacta;grupo8v3nãoorquestrado.

13/10 —9.3 ChannelRuntime recebe opção explícita localRestorePreparation:
exige engine/execution/distribution próprios e recusa authorityHA;usa concessão
local por geração+holdProgramOutputs desde boot. Types servidorPASS. Nenhum
callerprodução habilitado;activateRestoredApp/reviewHELD ainda recusam.
Próximo ensaio deve usar broker real e confirmaroutputsHeld/recibo paused.
Não executou redundância v3 nem liberou sinal. Totais10/53:6/32/8/7;r56intacta.

13/10 —9.3 gerações da concessão local serializadas:UUIDnovo mesmoPID
recusado,processosubstituto exige retirarregistroanterior e liberar pin antes
de nova emissão.7contratos controladosPASS. Typesapontou fixture engineTokens
estreita;corrigida Record,types após correção aindaNOT_RUN. Módulo não ligado
ao runtime;HELDguards preservados. Brokerreal/saídaspausadas faltam.
Totais10/53:6/32/8/7 mantidos;r56intacta.

13/10 —9.3 LocalRestoredEngineLease implementado,não conectado à ativação:
possehost/distribuição/canal,processoúnico/token,provanativa+pin,nonceordenado,
termo sequencecanal,TTL nativo5000;falha revoga,retirada exige saída registrada.
5contratos controladosPASS/types servidorPASS antes de guard extra pré-pin;
guard extra recusa mudança durante freshProof antes de pin. Falta replay desse
guard,integrationruntime/broker real e liberaçãopausada. GuardsHELDmantidos,
grupo8v3nãoexecutado;r56intacta. Totais10/53:6/32/8/7.

13/10 —9.3 auditoria backupHELD:ChannelRuntime restaurado não recebe
holdProgramOutputs;releasepausado depende fenceBinding gerado só com
fenceLease. Remover recusa review/activation seria insuficiente/inseguro.
Integração local necessária documentada BACKUP-HELD-ADMISSAO-LOCAL.md,
separada deHAgrupo8v3. Guards preservados;nenhum teste redundância executado.
Totais10/53:6/32/8/7 mantidos;r56intacta.

13/10 —3.3 transporte estadoPVW identidade/TTL PASS1/161filtrados:
ACK7aceitaevento7,sem atualização>2sexpira;clearrecusaeventoantigo;reabertura
ACK8recusa7/aceita8. Teste controla comandos e relógio,sem mídia/native;
complementa native3jDTA7,não substitui UIremota. Sem produto mudado neste
ensaio. Totais10/53:6/32/8/7 mantidos;r56intacta.

13/10 —3.3 diagnósticoPVW state/sampleAt/UI compilado:servidorbuildPASS,
types servidorPASS,VitePASS(index-j3jbsjNf.js). Labels pausado explicitam
entrega pelo decoder. Ainda falta conferência visual/expiração de aba em
navegador e contexto remoto com relógios divergentes. r56ZIPintacto,
buildlocalposterior não herdainstalação. Totais10/53:6/32/8/7 mantidos.

13/10 —3.3 diagnósticoPVW no Master:entrega decoder distinta de browser/
transmissão,sampledAt servidor,expiração2s mesmo sem atualização por timer
local;ausente/antigo/futuro não confirma.2markupPASS;tipos web em ensaio.
Clock remoto divergente pode negar confirmação conservadoramente,não homologa
NTP. Falta build/tipos servidor após sampledAt e UIreal. r56 intacta.
Totais10/53:6/32/8/7 mantidos.

13/10 —3.3 telemetria previewFrame incluída no state transporte/API tipado
web; evento válido marca dirty para atualização. Sem ACKdecoder,estadoNULL
em contrato transportePASS1/160filtrados;3parserPASS/types servidorPASS.
Não há novo rótuloUI aprovado nem build após alteração do state; r56 intacta.
EntregaDecoder não é publisher/browser. Totais10/53:6/32/8/7 mantidos.

13/10 —10.x r56 integridadeZIPPASS:6651entradas/6650hashes+tamanhos,
engineSHA3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Verificador sem extração completa por espaçoC;resultado persistido. Cópia
temporária innerpayload removida apósPASS,ZIPoriginal/evidência preservados.
Instalação/startup r56NOT_RUN. Totais10/53:6/32/8/7 mantidos.

13/10 —10.x r56 instalável parcial geradoexit0,538651035bytes:
engine release recompilado/servidor build atual/interfaceBF66aHkj. Inclui
previewFrame guards,nomes/scopes/compensação decimal. Instalação/startup
desta edição NOT_RUN,sem herdar r55. R54/r55preservadas,nenhuma limpeza.
Docs BUILD-PARCIAL-R56.md. Totais10/53:6/32/8/7 mantidos.

13/10 —3.3/4.4/9.3 PVW restart isolado3jDTA7PASS:processo10196exitobservado,
provaPVWNULL;watchdog12872ready sem provaantiga;CUE novo entregou decoder2/
age15ms. IDsdecoder podem repetir entre processos,resetbinding impede herança.
Clear/reopen/compensação recusada tambémPASS;cleanupfinally. Não testa
continuidadepixelsPGM pós-crash,publicação/browser/hostpowerloss. EngineSHA
70f37ffa5c1b4b41123827c0bbec7ef9311575f84b514c8e6f3da533926b2868,
release/r55intactos. Totais10/53:6/32/8/7 mantidos.

13/10 —3.3/4.4 troca/limpeza nativePVW PASS c8kh30:decoder2quadro49ms,
clear evidenciaNULL,reabertura decoder3quadro38ms,PGMdecoder1inalterado.
EngineSHA70f37ffa5c1b4b41123827c0bbec7ef9311575f84b514c8e6f3da533926b2868.
Compensação CUE recusada;cleanupfinally confirmado. Não cobre crash/restart,
pixels browser/liveexterno nem publisher. Release/r55intactos.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —3.3/4.4 engine debug recompiladoPASS e runtime VTfIW7PASS:
previewFramefuture-filler/decoder2/deliveredtrue/age33ms,posição28,
PGMvt/decoder1preservado,compensação recusada. Entrega válida no sinkPVW
comprovada; publisher sob demanda não ativado,sem captura/browser/transmissão.
Cleanup próprio confirmado. Falta troca/restart em transporte e UI/remote;
release/r55 intactos. Totais10/53:6/32/8/7 mantidos.

13/10 —3.3/4.4 previewFrame ligado ao servidor: binding por ACK do item/
decoder,CUE novo limpa amostra,restart limpa geração; getter exige telemetria
<=2s e distingue preroll pausado de live recente.3contratosparserPASS,
types servidorPASS. Fixturecompensation-cue passa a exigirdelivered real,
ainda NOT_RUN com binário recompilado. Falta teste transporte/mock de troca,
buildengine/servidor/ensaio; r55 intacta. Totais10/53:6/32/8/7.

13/10 —3.3/4.4 engine implementa previewFrame por decoder/item:
delivered exige video_ready+buffer válido entregue,ageMs preservada,
pausedFile distingue preroll de arquivo de live recente. Publicado na cadência
de posição sem novo decode. cargo checkPASS. Falta parser/guard servidor,
negativos de geração/troca e ensaio native; nenhum quadro aprovado só pelo
check. Engine release/r55 não atualizados. Totais10/53:6/32/8/7 mantidos.

13/10 —3.3/4.4 auditoria de telemetria PVW:main.rs emite levelsPVW áudio,
VideoProbe apenasPGM; previewPosition sem identidade de geração e pode ser
prefill0 no transporte. Não serve como prova de quadro decodificado.
Próxima implementação requerida: observação PVW vinculada ao decoder atual,
com idade/entrega vídeo real, contrato engine-servidor e negativos de geração
antiga. Evita aprovar fixturexSZrrI como prova visual. Totais10/53:6/32/8/7.

13/10 —4.4 runtime/native CUE isoladoxSZrrI PASS: comando aguardado,
estado previewfuture-filler,PGMvt/decoder1preservado,commit pós-review recusa
CUE/0auditorias. Cleanup confirmado no finally. PVW on-demand não ativado;
posição inicial0 pode ser preenchida pelo transporte, NÃO prova quadro
decodificado. Ainda falta captura/framePVW/browser/remoto. Fixture novo
--compensation-cue; runtime produção não modificado. Totais10/53:6/32/8/7.

13/10 —4.4 preparação CUE nativo: cenário priority-playout tem profile
PROGRAM desligado e nenhum caminhoMediaMTX/PVW. toEngineProfile(PREVIEW)
depende do path.preview; inserir só um profile SRT não habilita CUE. Não
executado falso ensaio Null como provaCUE. Próximo ensaio deve fornecer PVW
isolado sob demanda + verificar decode,PGM preservado e recusa pós-review.
ContratosDB jáPASS;physical/browser continuam abertos. Totais10/53:6/32/8/7.

13/10 —4.4 negativas pós-review PASS2/17filtradas: alvo entraCUEouPGM,
commit recusa,revisão/duração/auditoria compensação intactas. Rota inspecionada
usa contexto runtime atual dentro mutatePlaylist,no commit síncrono; não
reusa contexto do review antigo. ContratosDB, não preview nativo/browser.
Lote decimal engineHuaFCW não tinha PVW;CUE físico segue aberto.
Totais10/53:6/32/8/7 mantidos;r55 intacta.

13/10 —4.4 ensaio compilado/native decimalHuaFCW PASS: interrupção/retomada,
compensação/reenvio,rollback,proteção,VTtrim e EOS. Filler nominal50→113 por
delta63, timing executável300 e EOS300. Recibo original tem literais antigos
25/75 (não usar esses campos); verificação readonly separada da revisão em
decimal-revision.json confirma63/113. Script corrigido para próximos recibos.
Saída Null/mídia sintética; CUE/browser/sinais físicos não homologados.
Totais10/53:6/32/8/7 mantidos;r55 intacta.

13/10 —4.4 lote decimal/sinal compilado typesPASS,VitePASS(index-BF66aHkj).
Novo ensaio integrado helper UI→review→commit SQLite PASS1/16filtrados:
2,5s=63frames,filler500→563 na revisão congelada,rascunho500preservado.
Primeira execução falhou importfixture,caminho corrigido sem mudar produto.
Não testa HTTP/engine/EOS/operador remoto. r55 intacta;totais10/53:6/32/8/7.

13/10 —4.4 troca de ação preserva texto decimal/precisão e muda só sinal;
não converte2,5em30 por Number inválido. Texto inválido mantido para recusa
explícita no review.18contratos/markupPASS. Inspeção confirmou revisão mostra
nominal/executável e reenvio usa requestIdoriginal. Falta types/build desta
mudança e operação integrada/remota; r55 intacta. Totais10/53:6/32/8/7.

13/10 —4.4 arredondamento fracionário agora simétrico: +/-2,5s em25fps
gera +/-63quadros, empate afastado de zero; antes -62/+63.17contratos/markup
PASS, VitePASS(index-DBECIuXq.js). Interface transmite quadros inteiros ao
review existente; servidor preserva limites de duração/proteção. Falta fluxo
integrado/operador remoto. Registro anterior sobre Math.round negativo foi
superado por esta correção. r55 intacta. Totais10/53:6/32/8/7 mantidos.

13/10 —4.4 entrada de compensação aceita ponto/vírgula decimal (ex:-2,5s),
campo textual inputMode decimal, mantendo limite600s/cadência/sinal/revisão.
Recusa separadores misturados,exponentes/hex;16testes helper+markupPASS.
Math.round existente preservado (empate negativo segue JS); não fecha
precisão editorial por quadro nem fluxo urgente remoto. Falta types/build e
conferência integrada; r55 intacta. Totais10/53:6/32/8/7 mantidos.

13/10 —3.7 lote de buffers/aba oculta compilado VitePASS,
index-Bg9DMiz8.js; typesPASS e10contratos de amostra anteriores PASS.
Inspeção confirmou gráficos fora do modo escolhido desmontados (refsnull),
sem desenhá-los extra. Sem nova alteração desnecessária. Não há medição
CPU/RAM/navegador após otimização, nem homologação remota; r55 intacta.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —3.7 scopes: reutilização de buffers FFT/áudio por tamanho, removida
cópia extra do snapshot getImageData, desenho suspenso em document.hidden.
Ao voltar visível,freshness recalculada pelo relógio atual; regras de sinal
antigo não removidas.10 testes de validade PASS. Falta medição navegador
CPU/RAM/visibilidade e build; r55 intacta. Totais10/53:6/32/8/7 mantidos.

13/10 —3.2 refactor de geração compilado: types webPASS, VitePASS,
index-DjVWTakv.js. Guard unitário PASS anterior não substitui navegador.
Grupo3 restante:3.2anúncio/refresh real;3.3outros protocolos QC direto;
3.4vertical/resize/fullscreen fallback;3.5arquivo playback/áudio e remoto;
3.6CPU/RAM/rede remota;3.7responsividade/áudio/tally/multiview remoto.
3.1já concluída. Build local posterior à r55,não altera ZIP instalado.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —3.2 guard compartilhado latestRequestGate usado pelas duas telas,
3 contratos PASS:consulta antiga,desmontagem,remontagem sem reativar anterior.
2markup de seleção mantidos PASS. Isso prova mecanismo de geração, não
interação/refresh fora de ordem no navegador. Falta build/tipos do refactor;
r55 intacta. Totais10/53:6/32/8/7 mantidos.

13/10 —3.2 descoberta concorrente protegida no seletor canônico e cadastro:
apenas geração mais recente atualiza lista/erro/loading; respostas antigas e
após desmontagem descartadas. Inspeção revelou ausência anterior desse guard.
Falta ensaio de respostas fora de ordem no navegador e build correspondente;
r55 permanece inalterada. Totais10/53:6/32/8/7 mantidos.

13/10 —10.x r55 instalação isolada/catalogação/extração/hashes PASS,
atalhos criados só em scratch, nenhuma instalação anterior alterada.
Smoke com Node incluído/PATH mínimo PASS8SlDH9:2278ms,health/interface200,
banco próprio e encerramento confirmado,PGM desligado. Windows limpo,
launch pelos atalhos/sinais físicos/licenças continuam abertos. ZIP inalterado.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —10.x instalador parcial r55 gerado exit0 com lote QC/nomes,
538646852bytes,SHA F4300A8B797E5C17224E35EF6F864E2A9210BE99B9098E30409F53ED4BB44ED9.
Build web atual PASS(index-DeRheKEx),servidor atual compilado,engine release
r54 preservado. Catálogo externo conferido; instalação/startup r55 NOT_RUN.
Docs BUILD-PARCIAL-R55.md. Totais10/53:6/32/8/7 mantidos.

13/10 —3.2 NDI agora preserva referência escolhida quando consulta retorna
vazia, em vez de substituir por manual vazio; campo visível acompanha essa
referência e mudar para manual preenche o nome selecionado.9 testes PASS,
incluindo markup inicial NDI salvo; ainda falta teste visual de refresh vazio
após seleção descoberta e build desta alteração. Totais10/53:6/32/8/7.

13/10 —3.2 seleção anterior ausente da consulta agora tem opção explícita
NDI/OMT, evitando campo visual sugerir outra fonte enquanto URI antigo fica
ativo. OMT salvo continua visível antes da descoberta; não anuncia sinal.
8 testes PASS e build web PASS (index-Cb49KziQ.js); types web anterior PASS,
sem novo typecheck após opções. Falta seleção visual de anúncio real/refresh
e instalador atualizado. Totais10/53:6/32/8/7 mantidos.

13/10 —3.2 corrigida correspondência de rótulo após canonicalização:
referências ndi:// e ndi: (OMT/SDI idem) equivalentes preservam nome descoberto,
acentos/case do nome e separação de protocolos; correspondência exata tem
precedência. Alias manual permanece do operador.7 testes PASS (configuração
e seleção); falta build web e seleção visual com anúncio real.3.2 continua
em andamento. Totais10/53:6/32/8/7 mantidos; nenhuma nova build instalável.

13/10 — lote da régua QC fechado localmente em build+ensaio integrado:
ntAIZs/result.json PASS, servidorSHA d4ac824d5069f3ba6094688cd5e5500b862b42
cb69398fb5361fc8035598ccf1. Proxy pronto:24JPEGs/550ms. Proxy marcado
indisponível só no banco da fixture:302miniatura estática/0quadros novos.
Original em qualidade:740ms/1JPEG.0QC/0as-run,PGM desligado,servidor
encerrado confirmado. Não qualifica layout/rede remota/CPU/posição exata;
3.6/3.7 seguem abertos. r54 não atualizado. Totais10/53:6/32/8/7 mantidos.

13/10 —3.6 régua sem proxy pronta agora retorna miniatura estática em vez
de abrir original pesado implicitamente; qualidade mantém original verificado.
12 testes de rotas PASS, incluindo ausência de proxy e hash obsoleto antes de
extração. Quadros econômicos usam KEY_UNIT e centro da fatia: navegação
aproximada, não conferência exata de corte. Qualidade usa busca ACCURATE.
Esta última alteração ainda precisa compilar/ensaio integrado; r54 inalterado.
Totais10/53:6concluídas/32andamento/8pendentes/7v3 mantidos.

13/10 —3.6/3.7 otimização QC compilada e ensaio integrado PASS:
scratch/qc-fallback-browser-0lX7lV/result.json, servidorSHA b8312b21c1e6f9c
74001a62f0840e8dc11963debe99985ae168a7176b9d986a2. Régua24JPEGs,
primeiro em531ms via proxy; qualidade original710ms/1JPEG.0QC/0as-run,
PGM desligado, encerramento servidor confirmado. Comparação com6s anterior
é indicativa, não benchmark controlado nem medição CPU/rede remota/posição
temporal de conteúdo variável. Pacote r54 inalterado; alteração só no build
local atual. Totais10/53(6concluídas/32andamento/8pendentes/7v3) mantidos.

13/10 —3.6/3.7 otimização da régua QC implementada: com proxy pronto,
miniaturas econômicas usam sua edição/hash, não abrem original grande para
24 seeks. Original conferido permanece exclusivo da inspeção em qualidade;
legado sem proxy mantém fallback anterior.10 testes de rotas PASS, incluindo
novo contrato proxy/original. Motivação: primeiras miniaturas6s no cenário
4XSV7s; não foi medida melhora nativa/CPU/rede após esta mudança. Falta build
e ensaio integrado correspondente; r54 não contém esta alteração.
Totais10/53:6concluídas/32em andamento/8pendentes/7v3 mantidos.

13/10 —3.4/3.5 Edge fallback FFV1 PASS: imagem do original visível,
avisos de JPEG/sem áudio/play desabilitado; safe inicialmente desligado e
overlay4:3 medido sobre imagem, não nas barras laterais. Retorno ao leve
acionado. Cenário isolado4XSV7s; docs/QC-FALLBACK-VISUAL-2026-10-13.md.
Vertical/fullscreen deste caso/estação remota ainda abertos. Totais mantidos
10grupos/53verificações:6concluídas/32em andamento/8pendentes/7v3.

13/10 —3.5 fallback de qualidade: ensaio HTTP compilado PASS com arquivo
FFV1 anamórfico 720x576 PAR16/15, original convertido sob demanda para
primeiro JPEG em731ms, somente1quadro gerado (não toda a régua).
Resultado persistido scratch/qc-fallback-browser-Y3YciQ/result.json,
servidor encerrado confirmado,0decisões QC/0as-run,PGM desabilitado.
Verificador agora guarda artefatos em scratch e persiste prova de encerramento.
Não validou navegador/áudio/rede remota nem layout4:3/vertical;3.5 continua
em andamento. Total10grupos/53verificações:6concluídas/32em andamento/
8pendentes/7adiadas v3, sem nova build nesta etapa.

13/10 — grupo 2 OMT: 7 testes unitários PASS e ensaio nativo explícito
PASS (13,47s) com runtime r54: transmissão/recepção áudio/vídeo, appsrc,
CUE sem PGM, TAKE, perda e retorno com novo conteúdo/mesmo decoder.
Timeout stage=4 no isolamento; repetição autorizada fora dele PASS.
Fonte sintética local e saída Null: emissor externo, conta sem privilégios,
QC remoto e homologação física continuam abertos. DeckLink adiada; grupo 8
fica v3. Totais mantidos: 10 grupos/53 verificações, 6 concluídas,
32 em andamento, 8 pendentes e 7 adiadas para v3.

13/10 —10.x r54 verificador integralPASS: hashes/MSVCassinado/SQLite/plugins/
engine com PATH portátil, CRT da própria pasta, ready/shutdown. Grupo8não
testado. Pausa/restauração com engine release do pacotePASS(IFJ2Wo): cursor6,
11amostras imóveis, processos encerrados. Sem sinais físicos/Windows limpo/
licenças integralmente homologados. Totais10/53(6/32/8/7) inalterados.

13/10 —10.x r54 smoke original do pacotePASS fora do isolamento de rede:
causa das falhas anteriores eraEACCES no cliente, servidor chegava aHTTP
listening. Resultado fswIWj:2407ms,health/interface200,Node/SQLite incluídos,
PATH mínimo, servidor encerrado. Instalador/hashes/7atalhos QA jáPASS; ainda
não Windows limpo/atalhos abertos/sinais físicos. ZIP/hash inalterados;totais
10/53(6/32/8/7) mantidos. BUILD-PARCIAL-R54.md corrige diagnóstico anterior.

13/10 —10.x instalador r54/hashes completos/perfil/7atalhos QA PASS; servidor
FAIL em30s e diagnóstico90s. SQLite portátil separadoPASS. Pacote não aprovado
funcionalmente; startup em diagnóstico, trace opcional adicionado após ZIP.
Evidências em BUILD-PARCIAL-R54.md; totais10/53(6/32/8/7) inalterados.

13/10 —10.x build parcial r54 gerada com engine release atualizado, servidor
e interface atuais; builds e typecheck servidorPASS. Fixture de tipos foi
completada sem implementar/testar HA. ZIP537838347bytes, SHA15C127464F0FF7E20F
D726DBCF6C6C76A55B9A7C0BE665D5D0B355EB0AA616DC; conteúdo-core e engineSHA
verificados no payload real. Instalador/Windows limpo/6650hashes completos
ainda não validados nesta edição. Docs BUILD-PARCIAL-R54.md. Totais10/53
(6/32/8/7) inalterados;9.3/ativação backup HELD continuam abertos.

13/10 —9.3 transporte consome admissão pausada explícita com modo/cursor/
decoder/corte reconfirmados; normal recusaHELDe inconclusivo antes do envio.
17contratos+1caso transportPASS. Preparo/ativação do backup ainda não ligados,
review HELD permanece bloqueado. Grupo8não orquestrado;build/totais10/53
(6/32/8/7) inalterados.

13/10 —9.3 cursor de admissão nativo informa paused explícito e reconfirma
decoder/cursor/mute/quadro; normal rejeitaHELDe pausado exigecampo/cursor exato.
17contratos+2fixtures nativasPASS,cargo checkPASS. Ainda não ligado à admissão
das saídas do backup;grupo8não alterado. Build/totais10/53(6/32/8/7) inalterados.

13/10 —9.3 ativação de backup HELD permanece recusada por gate explícito:
falta admissão nativa do modo pausado nas saídas preparadas.3testes dirigidos
PASS preservam cursor/ativação; validade da cópia não autoriza PGM. Essa
lacuna não se confunde com recuperação local HELD já implementada. Build e
totais10/53(6/32/8/7) inalterados.

13/10 —9.3 backup HELD+composição real validado(et5ocF): checkpoint da cópia
idêntico, inventário distingue1held/0playing, execução não autorizada pela
cópia.8testesPASS; hardlink de manifesto não validado por EPERM do ambiente.
Ativação de backup/backend completo/pixels gráficos/pacote ainda abertos.
Totais10/53(6/32/8/7) inalterados.

13/10 —9.3 restauração de composição gráfica vinculada em HELD PASS em
runtime/banco/engine reais(SY13W1): novo recibo CONFIRMED, mesmo SVG/cursor,
checkpoint atualizado. Corrigida guarda pós-commit para conferir checkpoint
novo do dono atual, não ancestral já resolvido;18testesPASS. Pixels gráficos
não capturados; backup/backend completo/pacote pendentes. Totais10/53(6/32/8/7).

13/10 —9.3 grafismos/eventos automáticos bloqueados enquanto recuperação
pendente ou PGM pausado; composição já confirmada pode ser restaurada após
commit, sem tick de novas deixas.18testesPASS incluindo pausa/liberação do
scheduler. Render/ACK de composição e equipamentos ainda não homologados
nesse fluxo. Totais10/53(6/32/8/7) e build inalterados.

13/10 —9.3 watchdog HELD integrado ao restoreProgramHold+commit atômico,
sem TAKE normal. Ensaio realPASS(Q54xjk): engine33584→10148, cursor10
pausado/execução/corte/SHA/dono preservados, ready só após commit. Inconclusivo
e ausência de callback seguem bloqueados. Falta backend completo/backup/
gráficos/pacote. Totais10/53(6/32/8/7) inalterados.

13/10 —9.3 SIGKILL após COMMIT PASS(Z8rqgq): checkpoint28 confirmado
preservado, cursor25 ancestral recusado, continuidade sem replay. Ramo
antes-COMMIT PASS(hPUWIA): rollback conserva25 e cadeia não resolvida.
Workers SQL sem engine; falta backend completo+PGM/gráficos/backup/watchdog/
pacote. Totais10/53(6/32/8/7) e build inalterados.

13/10 —9.3 SIGKILL durante transação real de AsRun/Checkpoint/posse PASS:
worker26020 terminou observado, banco reaberto preservou payload anterior,
1segmento aberto e integridade; nova geração recuperou cadeia assinada.
Evidência scratch/held-tx-crash-GQr94R. Sem engine nesse worker; não é queda
combinada backend+PGM nem energia do host. Falta após-commit/gráficos/backup/
watchdog/pacote. Totais10/53(6/32/8/7) e build inalterados.

13/10 —9.3 recuperação admite somente cadeia assinada local de tentativas
interrompidas não resolvidas, com parada comprovada, e reconcilia as-run
nessa mesma cadeia.56testesPASS+1caso dirigido de segmento ancestralPASS.
Bloqueia além de tentativa confirmada/adulteração/contexto sem prova. Falta
ensaio de kill do backend; build/totais10/53(6/32/8/7) inalterados.

13/10 —9.3 as-run/checkpoint/posse agora compartilham transação síncrona,
com rollback de memória e eventos externos só após commit.25testesPASS;
ensaios reais de sucesso(xQLQMh) e falha de checkpoint(GLyGHf)PASS: falha
não deixa novo segmento as-run. Ainda falta backend morto no meio do commit,
backup/gráficos/watchdog/pacote. Totais10/53(6/32/8/7) inalterados.

13/10 —9.3 checkpoint novo+resolução do predecessor agora atômicos entre si,
antes de liberar proteção.17testesPASS e ensaio banco/runtime/engine real
com trigger de falhaPASS(scratch/held-runtime-gbCD8x): payload antigo intacto,
predecessor não resolvido e runtime inconclusivo. As-run permanece etapa
anterior, portanto ainda falta recuperação de crash entre segmentos/commit.
Build/totais10/53(6/32/8/7) inalterados.

13/10 —9.3 ensaio conjunto real PASS: publicação/runtime/SQLite/engine/posse,
queda do engine e novo runtime restauram HELD no cursor9, execução/corte/SHA
preservados, checkpoint do novo dono e as-run continuidade. Evidência
scratch/held-runtime-ghamxT. Null output; não é queda do servidor/host nem
crash entre commits/gráficos/backup.9.3 e totais10/53(6/32/8/7) em andamento,
sem build instalável nova.

13/10 —9.3 commit validado com SQLite/posse/as-run reais e engine mock:
corrigida resolução do predecessor somente após quadro/registro confirmados.
2casos dirigidosPASS: sucesso preserva execução e novo vínculo; trigger de
falha mantém checkpoint antigo e predecessor não resolvido. Falta ensaio
banco+engine real conjunto e crash entre commits. Totais10/53(6/32/8/7)
e build inalterados.

13/10 —9.3 startup de checkpoint HELD ligado ao recoverHeld/commit específico:
reconfirma posse/revisão/corte/decoder/cursor, aguarda as-run sem novo TAKE e
preserva executionId antes de liberar checkpoint.14testes runtime e12dirigidos
transportePASS. Falta homologação banco+engine real juntos, atomicidade/crash
nos estágios de commit e gráficos; watchdog HELD ainda bloqueado. Build e
totais10/53(6/32/8/7) inalterados.

13/10 —9.3 corrigido risco de watchdog converter PGM pausado/inconclusivo em
PLAYING: modo e cursor preservados, recuperação comum bloqueada sem replay.
2testes dirigidosPASS. Commit operacional/as-run/startup pausado ainda aberto;
build/totais10/53(6/32/8/7) inalterados.

13/10 —9.3 recoverHeld no transporte prepara recuperação de arquivo/corte/SHA
verificados, ligada ao filho atual e versão antes/depois do comando.3testes
dirigidosPASS incluindo alterações antes/durante preparação, sem replay ou
callback TAKE. Ainda não ligado ao commit/runtime/startup; não fecha9.3.
Build e totais10/53(6/32/8/7) inalterados.

13/10 —9.3 ensaio com dois processos reais PASS: anterior SIGKILL/exit
observado, novo restoreProgramHold confirmou cursor6/HELD/ACK e12amostras
imóveis com saída ativa; shutdown exit0. Evidência scratch/held-process-D8lPUK.
Não é recuperação operacional do banco/as-run/posse nem pixels do subprocesso.
Falta ligação ao runtime, pacote atualizado e homologação integral. Totais
10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

13/10 —9.3 transporte consome recibo de restoreProgramHold com id/item/cursor
exatos e geração nova positiva; só confirma junto com State HELD e ACK da
mesma geração.7casos de transporte e4validadoresPASS, em mocks/contratos.
Ainda não ligado à recuperação operacional nem testado por crash/processo
separado. Guardas de startup pausado preservadas, build/totais inalterados.

13/10 — 9.3 RPC nativo restoreProgramHold adicionado, sem habilitar recuperação
no servidor. Captura via dispatcher expôs flash de preroll estéreo após STOP;
causa: load reutilizava superfície ainda selecionada com PGM lógico vazio.
Corrigido para preparar na superfície oposta;5 testes dirigidos de HOLD e1
regressão de Mark In/recusas PASS. Falha inicial e limites documentados no
relatório de9.3. Ainda faltam consumidor de recibo novo e crash/processo
separado. Build/totais inalterados10/53(6/32/8/7).

13/10 — 9.3 avançou: comando/recibo HOLD nativo, telemetria
RUNNING/HELD/UNCONFIRMED e checkpoint HELD explícito implementados. Novo
decoder preparado em Paused no cursor, sem áudio; referência independente
confirmou pixels do quadro absoluto 86. Captura contínua da preparação/ativação
PASS em estéreo/16 canais, somente vazio→alvo, sem quadro indevido ou áudio.
Não há restauração automática/crash homologada, RPC de restauração, interface
ou build nova; recusa de retomada pausada permanece. Detalhes e limites em
GRUPO-09-RECUPERACAO-PAUSADA-2026-10-12.md. Totais10/53:6concluídas,
32andamento,8pendentes,7v3. Typecheck global ainda falha na fixture HA registrada.

12/10 —9.3 auditoria confirmou ausência de HOLD/PAUSE operacional nativo e
checkpoint com corte exigeplayingtrue: recuperação de quadro pausado continua
NÃO IMPLEMENTADA/homologada, não remover recusa. Regressão dirigida2PASS/
22skipped prova recusa/cursor preservado/reserva adquirida-liberada, não vídeo
real. Falhas de expectativas da fixture documentadas. Totais10/53 mantidos
6concluídas,32andamento,8pendentes,7v3; GRUPO-09-RECUPERACAO-PAUSADA-2026-10-12.md.

12/10 —4.4/4.5 auditoria persiste âncora antes/depois na transação do commit,
SOFT/WINDOW;20 testes afetados e buildservidor PASS, histórico legado intacto.
Não é validação adicional de rede/físico; alteração posterior àr53. Totais
10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 —4.5 corrigido retorno UNCERTAIN rotulado como simulado; mensagens
agora seguemfase durável e orientam consulta sem replay apósresposta perdida.
21testes/tipos/buildPASS; sem novoensaio browser/crash/físico. Posterior àr53;
totais10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 —4.4 duas contas/sessõesQA concorrentes PASS:um200/outro409,commitúnico,
recibo protegido porator,replaydeduplicado,PGMnativo preservado. RTTlocalhost
581,71/578,40ms, não é rede/browsers remotos ou benchmark sobcarga. Cleanup
confirmado;4.4remoto aberto. Totais10/53 mantidos6concluídas,32andamento,
8pendentes,7v3.

12/10 —4.4 corrigida ligação Conflitos→Distribuição que sobrepunha gaveta;
browser confirma abertura exclusiva. Resumo SOFT validado com alvo antes/depois,
tolerância e distinção do início executável.4 testes/tipos/build PASS, duas
conferências sem commit/SQLzero compensações. Cleanup próprios confirmado.
Operação remota ainda aberta; totais10/53 mantidos6concluídas,32andamento,
8pendentes,7v3; alterações fora da r53.

12/10 —4.4 revisãoACCEPT_DELAY mostra horário antes/depois do servidor,
incluindo janela WINDOW e atraso, sem inferir pelo cliente.19 testes afetados
e tipos PASS; ainda conferir novo resumo no navegador/remoto. Posterior àr53;
totais10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 —4.4 demais ações browser PASS emlote:TRIM5→4s/rev2,opcional removido
rev3,SOFT+120s/rev4,FIXED preservado,zona protegida recusada. Leitura readonly
confirmou3commits/4revisões/editorial intacto; renumeração esperada apósDROP
verificada explicitamente. Falta resumo de horário explícito para atraso,
latência/atores/estações distintos; totais10/53 mantidos6concluídas,32andamento,
8pendentes,7v3. Owncleanup confirmado e abaQA fechada.

12/10 —4.4 concorrência HTTP compilada/engine ativo PASS:duas confirmações
mesma revisão→um200/outro409;uma compensação/duas revisões;GET e retry
deduplicado;PGMitem/startedAt e editorial preservados. Owncleanup confirmado.
Não prova hosts/atores distintos/latência remota/demais ações visuais; totais
10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 —4.4 browser/falha real: disconnect préheaders provocou retry automático
deduplicado; JSONtruncado póscommit exercitou desconhecido→ConsultarGET→revisão2,
sem segundoPOST. SQLuma compensação/duas revisões/editorial intacto. Relay,
engine null e servidores próprios encerrados; não é rede remota/físico.
Concorrência/demais ações abertas; totais10/53 mantidos6concluídas,32andamento,
8pendentes,7v3. Evidência no relatório compensação rápida.

12/10 —4.4 consulta de recibo GET porrequestId implementada sem replay/refresh;
ator/canal e no-store, ausência não significa rejeição. UI separa consulta e
POST explícito.31 casos distintos/tipos/builds PASS; navegador com resposta
perdida ainda aberto. Posterior àr53; totais10/53 mantidos6concluídas,
32andamento,8pendentes,7v3.

12/10 —4.4 comunicação corrigida: refreshError não esconde commit/revisão;
resposta perdida indica desconhecido e preserva mesmo requestId.29 testes
web/backend e tipos PASS; não é injeção visual de falha nem rede homologada.
Posterior àr53; totais10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 —4.4 browser Master: preset+5/conferir2→7s/confirmar revisão2 PASS em
fixture nativa saída null; SQLuma compensação/editorial50frames/PGMvt preservado.
TRIM muda sinal e presets/orientação. Processos próprios/aba encerrados.
Não executou filler, outras ações/latência remota abertas; totais10/53 mantidos
6concluídas,32andamento,8pendentes,7v3. Ver relatório compensação rápida.

12/10 —4.4 orientações prévias por ação no painel, sem ocultar itens ou
autorizar pelo editorial.26 casos distintos web/backend PASS, incluindo
proteção CUE/zonas/revisão e deduplicação; tipos PASS. Não mede latência/remoto
nem fecha4.4; ajustes posteriores àr53. Totais10/53:6concluídas,32andamento,
8pendentes,7v3.

12/10 —4.4 atalhos de5/15/30/120/180s implementados com sinal por ação;
presets só preenchem campo, revisão/confirmação obrigatórias preservadas.
Entrada vazia/zero/não finita/sinal inválido/subframe recusada antes da API.
11 testes/tipos PASS; homologação visual/remota ainda aberta. Posterior àr53,
não incluída naqueleZIP. Totais10/53:6concluídas,32andamento,8pendentes,7v3.
Ver GRUPO-04-COMPENSACAO-RAPIDA-2026-10-12.md.

12/10 — r53 integrada537781278bytes/hash2C0C7C73F02E8BFAD256D50B3C5F3ED43FF4EB12A8112EEC0A5909585F05296C.
INSTALAR doZIP concluiu emQA, recibo r53/integridade/perfil/cofre e7links
conferidos independentemente. Wrapper LASTEXITCODE gerou falso erro pós-sucesso,
registrado sem esconder exit1. Links não abertos/Windowslimpo não homologado.
Totais10/53 mantidos6concluídas,32andamento,8pendentes,7v3; BUILD-PARCIAL-R53.md.

12/10 —10.3 preflight fonte PASS: payload externo rotulado r52 corretamente,
destino existente recusado sem escrita. Edição ausente agora falha fechada,
sem inventar r24; fixture inválida recusada antes de criar destino. Fonte
posterior ao ZIP r52, incorporar ao próximo pacote junto ao cofre isolado.
Ainda não abriram atalhos/Windowslimpo; totais10/53 mantidos6concluídas,
32andamento,8pendentes,7v3.

12/10 — instalador fonte posterior àr52 isola cofre por instalação e permite
QA de atalhos emscratch. Extração/integridade/profile e7links conferidos PASS,
sem abrir programas ou alterar menu. Rótulo legado encontrado com payload
externo, leitura corrigida ainda sem replay. Não incluído no ZIP r52 e não
fecha10.3; totais10/53 mantidos6concluídas,32andamento,8pendentes,7v3.

12/10 — r52 gerada537781239bytes/hash744FFF73F4E4E8A0AD5FD3602130019BDB54E6AC7E4D6C5D64BAB73F10858C77.
Inclui DPAPI absoluto. Smoke do payload com PATH semPowerShell PASS:
banco/cofre temporários,health/UI/hashJS e shutdown;PGM desabilitado.
Sem Windowslimpo/atalhos/físico;grupo10aberto. Totais10/53 mantidos6concluídas,
32andamento,8pendentes,7v3. R51preservada; registro BUILD-PARCIAL-R52.md.

12/10 —6/10: cofre agora invoca PowerShell absoluto do Windows, sem busca
no PATH.11 testes PASS, incluindo DPAPI temporário com PATH vazio; build
servidor PASS. Correção posterior ao r51, ainda NÃO incluída naquele ZIP.
Sem substituição de cofre/chave ou enfraquecimento da proteção. Incorporar no
próximo pacote e validar partida; totais10/53 mantidos6concluídas,32andamento,
8pendentes,7v3.

12/10 — smoke do servidor/UI r51 PASS com Node do payload, banco/cofre
temporários:health/página200, JS servido com hash idêntico ao pacote, shutdown
observado. PATH precisa do WindowsPowerShell do SO para DPAPI; dois ensaios
iniciais omitiram essa pasta e falharam, preservados. Não usa runtime global
Node/GStreamer.10.3 permanece pendente de Windows limpo/atalhos/fluxo completo.
Totais10/53:6concluídas,32andamento,8pendentes,7v3; BUILD-PARCIAL-R51.md.

12/10 — r51 payload extraído isoladamente e verificador portátil exit0:
manifesto/hashes, assinaturas MSVC, Node+SQLite nativo em memória, plugins e
engine ready/shutdown com PATH só do pacote PASS; MSVC carregado da própria
pasta. Não executado instalador/atalhos, sem Windows limpo ou hardware real.
HA NÃO VALIDADA/adiada.10.2/10.3 abertos; totais10/53 mantidos6concluídas,
32andamento,8pendentes,7v3. Registro externo BUILD-PARCIAL-R51.md.

12/10 — build parcial r51 gerada:537780008bytes, ZIP novo emrelease, servidor
AA08FB5F e engineD55F2110 atuais, auxiliares recompilados; graphic-probe
corrigido para API quick-xml0.42,2 testes de validação PASS. Interface QC
atual incluída. Empacotador conferiu hashes da base/runtime e arquivos de
origem; NÃO houve instalação/execução funcional do pacote ou Windows limpo.
Grupo10 continua aberto; totais10/53:6concluídas,32andamento,8pendentes,
7adiadasv3. Ver BUILD-PARCIAL-R51.md; não é build final homologada.

12/10 —3.6: volume de proxies de4fixtures medido sem nova geração:248–277kbps
médios,85,77–87,46% menos bytes que originais. Hashes conferidos, banco readonly.
Não é throughput/CPU/RAM remoto ou WHEP:3.6 permanece pendente. Evidência no
relatórioQC/preview-budget.json; total10/53 permanece6concluídas,32andamento,
8pendentes,7adiadasv3.

12/10 —3.7: eliminadas atualizações React redundantes de waveform/vectorscope
quando todos os valores são iguais; desenho10Hz e transições de alarmes
preservados.15 testes afetados/tipos PASS. Sem benchmark remoto ou nova
homologação de áudio; contagens permanecem10grupos/53verificações:6 concluídas,
32 em andamento,8 pendentes e7 adiadasv3.

12/10 —3.4: layout4:3 medido em1280/960; saída explícita da tela cheia
implementada e confirmada no browser. Corrigido arredondamento subpixel do
safe via contentRect/ResizeObserver;52 testes afetados PASS, sem
repetição de transportes. Ainda validar visualmente a correção/vertical e
estação remota. Totais10grupos/53:6 concluídas,32 em andamento,8 pendentes,
7 adiadas àv3; nenhum fechamento novo por evidência apenas unitária.

12/10 — fallback real FFV1: navegador decodificava só áudio (raster0×0) sem
erro; corrigido metadata sem imagem para entrar em quadros originais. Browser
confirmou JPEG640×360, SEM ESCUTA, régua e retorno ao proxy426×240 na posição
5,27s.39 testes/tipos/build PASS.3.5 permanece em andamento por homologação
live externa;3.4 resize/fullscreen e3.6/3.7 desempenho ainda abertos. Totais
10/53:6 concluídas,32 em andamento,8 pendentes,7 adiadas v3. Ver relatórioQC.

12/10 — QC arquivos: diagnóstico de vertical ignorado confirmado como regra
de ingestão, não falha; proxy/original 4:3 e vertical abertos no navegador,
safe dentro da imagem. Fallback corrigido para preservar posição aproximada
e ignorar erro de rendition desmontada. Lote40 testes/tipos web/build PASS.
Sem fechamento amplo: resize/fullscreen/fallback visual e desempenho remoto
seguem abertos. Total10 grupos/53:6 concluídas,32 em andamento,8 pendentes,
7 adiadas v3. Evidência GRUPO-03-QC-ARQUIVOS-2026-10-12.md.

12/10 — retomada após abandonar a cópia: API compilada + engine D55F2110
CUE/TAKE e QC nativo PASS em dois cenários isolados, sem repetir NDI/OMT.
Navegador Edge: QC direto com vídeo 428×240, inspeção 1280×720, PGM parado,
safe desligado por padrão e overlay dentro da imagem/tela cheia. Pasta
`ação ÇÃÓ 東京` aberta no seletor HTML do servidor, sem diálogo do SO:3.1
concluída.3.2 em andamento: nome NDI manual preenche após a referência e
preserva alias; lista descoberta NDI/OMT ainda não homologada. Corrigido aviso
de sintonia que persistia após PVW pronto, confirmado no navegador;25 testes
afetados/tipos web/build PASS.6 concluídas/32 em andamento/8 pendentes nesta
versão;7 adiadas à v3. Evidências: GRUPO-02-03-RETOMADA-2026-10-12.md.

12/10 — decisão mais recente: deixar a cópia de lado e continuar o projeto
em C:/IA/RPlayout. Nenhuma remoção adicional de C:/IA; finalizador desabilitado
no recibo e cópias no D: preservadas. Retomar grupo2→3 nesta pasta; DeckLink2.2
continua adiada e grupo8 reservado à v3. Contagem não mudou:9 grupos atuais,
46 verificações (5 concluídas/31 em andamento/10 pendentes),7 adiadas à v3.

12/10 — decisão explícita do usuário: pendência8 inteira ADIADA PARA V3;
não implementar nem homologar redundância nesta versão. Trabalho parcial
preservado, sem aprovação implícita. Escopo atual:9 grupos/46 verificações
(1 grupo concluído/8 abertos;5 concluídas/31 em andamento/10 pendentes).
Registro geral:10 grupos/53 verificações, incluindo1 grupo/7 verificações
adiadas para v3. Movimentação C:/IA→D:/IA e C:/RPlayout→D:/RPlayout autorizada;
preservar D:/IA existente, verificar cópia antes de remover originais e manter
compatibilidade dos caminhos atuais. Ver ESCOPO-ATUAL-E-V3-2026-10-12.md.

12/10 — grupo2 lote NDI/recuperação final: Rust94 PASS/3 ignored; NDI3 ciclos
de um caso PASS (30,57s), OMT final perda/retorno1 PASS (9,20s). Vídeo/áudio,
CUE separado, TAKE e imagem nova no retorno reais. Fila antes do processamento,
sem imagefreeze/preroll global para live; retry vinculado à abertura falha,
STOP/TAKE/LOAD posteriores vencem. Histórico de FAILs e limites da prova em
GRUPO-02-NDI-RECUPERACAO-2026-10-12.md. Caso adicional22998 PASS1/16,87s:
timeout real NDI, SourceLost sem avanço, retry nativo decoder2→3, imagem nova/
áudio e limpeza da tentativa antiga. Engine release PASS/hash no relatório.
Externos/estabilidade ainda abertos; DeckLinkadiada; sem instalador novo.
10(1/9),53(5/36/12).

12/10 — grupo2 OMT final local1/1 PASS/exit0/8,49s com rede autorizada:
descoberta/vídeo/áudio/appsrc/CUE separado/TAKE/PGM/cleanup reais. Mesmo binário
falhou sandbox75378 na criação do receptor; restrição de ambiente interfere,
não provar deadlock interno. Loader inicialização/discovery serializadas e
consulta inicial antes dos handles; buffer retornado copiado sob mutex.
Ver GRUPO-02-VALIDACAO-2026-10-12.md. Externo/estabilidade ainda abertos,
DeckLinkadiada;10(1/9),53(5/36/12),sem instalador novo.

12/10 — grupo2 OMT instrumentado32773 terminou exit124, bloqueio localizado
na etapa3/descoberta oficial; init e publisher construídos, nenhuma recepção
comprovada. Deadline fixture cobre chamadas nativas/cleanup sem reduzir
asserções. Sem exceção de log nessa rodada, não homologar runtime/rede.
Ver GRUPO-02-VALIDACAO-2026-10-12.md. Investigar descoberta antes de repetir.
2.2 adiada;10(1/9),53(5/36/12),sem instalador novo.

12/10 — grupo2 loopback48538 interrompido após confirmar processo exclusivo e
threads em espera; não PASS/causa ainda desconhecida. Fixture agora identifica
etapas e deadline global60s inclui SDK/cleanup, sem reduzir asserções. Nova
rodada instrumentada32773 iniciada; consultar mesmo handle. Ver validação
grupo2. DeckLinkadiada; fonte externa/estabilidade abertas;10(1/9),53(5/36/12).

12/10 — fechamento da rodada transporte final: engine-transport139/139 PASS
após correção de binding único do decoder pendente. QC14 PASS e diagnóstico/
UI36 PASS em arquivos distintos; RustOMT7 PASS. Falha original e replay
preservados, não somar reexecuções. Loopback oficial48538 ainda ativo/sem
resultado, fontes externas/estabilidade abertas. Ver validação grupo2.
2.2 adiada; nenhum fechamento amplo presumido;10(1/9),53(5/36/12).

12/10 — grupo2 validação em lote: OMT unit7 PASS; diagnóstico/interface36 PASS;
transporte/QC152 PASS/1 FAIL, corrigido vínculo único de identidade pendente
do TAKE ao estado armado nativo; replay dirigido1 PASS/138 skipped. Regressão
final iniciada e loopback oficial sessão48538 ativo/sem resultado. Não somar
replays ou declarar integral PASS. Ver GRUPO-02-VALIDACAO-2026-10-12.md.
2.2 adiada; fontes externas/estabilidade abertas. Sem instalador novo;
10(1/9),53(5/36/12).

12/10 — usuário adiou 2.2 DeckLink: manter pendente/adiada, sem homologação;
prosseguir demais grupo2 e depois3. 2.4/2.5 NOT_RUN: OMT rebase inicial/retorno/
reset usa running-time e base comum, DISCONT nos dois fluxos, sem reset por
timestamp negativo; timeout/inválido não renova entrega. Fixtures preparados.
Ver OMT-RECUPERACAO-RELOGIO-2026-10-12.md. Teste nativo/emissor real/filas/
estabilidade pendentes. Sem build;10(1/9),53(5/36/12).

12/10 — grupo2 prioritário, 2.4 NOT_RUN: loader OMT engine/devices configura
omt_setloggingfilename(null) oficial antes de descoberta/send/receive, sem
ACL/admin nem redirecionar settings/DiscoveryServer. Runtime sem export recusa.
Ver OMT-LOGGING-SEM-ADMIN-2026-10-12.md. Precisa compilar/ensaiar inicialização
estática e sinais reais; não afirmar exceção resolvida. Depois grupo3.
Sem nova build;10(1/9),53(5/36/12).

12/10 — prioridade do usuário: finalizar grupo2 e depois grupo3, suspendendo
prioridade HA sem perder escopo. 2.1 NOT_RUN: aviso de conteúdo raw amostrado
sem mudança por decoder, telemetria/diagnóstico/UI, sem alterar TAKE/tally.
Diagnóstico real nesta máquina: plugin DeckLink carregado/zero portas;
NDI/OMT zero fontes; CIM autorizado sem drivers correspondentes pelo nome;
OMT erro de permissão no log. Ver GRUPO-02-DIAGNOSTICO-LOCAL-2026-10-12.md.
Hardware não homologado; código novo sem testes/build;10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: plano sequência ligado origem/plano bus, ordem/timing/
corte operacional exatos; gaps/live/descartes/prova ausente bloqueiam edição
inteira, sem subconjunto ou RESET automático. Chave por timing/perfil/jobs
ordenados; fixtures preparados. Ver HA-AUDIO-BUS-CONTINUO.md. Recibos/workflow/
contratos pendentes/seletor operacional/AV ainda faltam. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

12/10 — 8.5/8.6 NOT_RUN: runner/leitor sequência servidor, jobs privados,
SHA/stamp antes-depois, cancelamento/pipe/limites, configuração/ordem/PCM
exatos e nenhuma qualificação operacional presumida. Fixtures preparados.
Ver HA-AUDIO-BUS-CONTINUO.md. Plano editorial/recibos/diário/Store/API/UI,
fronteiras/AV pendentes. Sem testes/build;10(1/9),53(5/36/12),fora R55.

12/10 — 8.5/8.6 NOT_RUN: renderer de sequência ligado ao medidor contínuo,
render_cut real compartilhado com isolado, cobertura por fonte, bus/teto
estáveis, pipe único/prazo global/até128cortes. Resultado distinto sem paths,
sem qualificar seletor operacional/transição/AV/PGM. Ver HA-AUDIO-BUS-CONTINUO.md.
Runner/plano/recibos/diário/UI/fronteiras/AV pendentes; regressão do isolado
necessária. Sem testes/build;10(1/9),53(5/36/12),fora R55.

12/10 — 8.5/8.6 NOT_RUN: medição contínua atribui PCM compensado por ordinal
ao corte original, medidores por item/par e sequência, sem reset DSP nem
guardar todo PCM. Resumo separado/sem prova de origem/PGM. Fixtures fronteira
2/8/16 preparados. Ver HA-AUDIO-BUS-CONTINUO.md. Renderer real/plano/recibos/
diário/UI/transições/AV pendentes. Sem testes/build;10(1/9),53(5/36/12).

12/10 — 8.5/8.6 NOT_RUN: DSP contínuo para sequência de cortes com estado único
BusLimiter, ordem/contagem/PCM estritos, startup único/flush final e ordinal
global; incluído como módulo na sonda, ainda sem renderer chamando.
Fixtures PCM 2/8/16/cauda/ordem/incompleto preparados. Ver
HA-AUDIO-BUS-CONTINUO.md. Renderer/plano/provas/medição fronteiras/AV/UI e
qualificação pendentes. Sem testes/build;10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: fixtures avaliação real de recibos/per-pair/ausência/
falha/bloqueio/vazio ampliados, fixture sintético reutilizável; leitor UI agora
recusa falha de medição marcada dentro do perfil. Fixtures UI política/revisão
preparados. Ver HA-SONDA-BUS-COMPLETO.md. Diário integrado, contínuo/transições/
AV/qualificação ainda não validados. Sem testes/build;10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: Store captura/reconfere política bus e revisão local;
diário persiste política/avaliação de recibos exatos e recomputa leitura privada.
UI/API types mostram dentro/fora do perfil ou ausência/legado, sem aprovar QC/PGM.
Ver HA-SONDA-BUS-COMPLETO.md. Fixtures ampliados/validação integrada, transições/
AV/qualificação pendentes. Sem testes/build;10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: schema dos pares compartilhado edição/QC/projeto/HA;
recuperação HA deixa de descartar renderedBusPairs/requireProbe/liveSignalPolicy.
Fixtures JSON/strict/projeto e restauração HA ampliados, não executados.
Ver HA-SONDA-BUS-COMPLETO.md. Captura/reconfirmação Store/diário/avaliação UI,
restauração real/transições/AV/qualificação pendentes. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: renderedBusPairs no perfil QC e API existente, campos
por par na tela com configuração explícita/sem ativação ao abrir; captura
local exige canal/bus/política exatos e revisão. Fixtures preparados.
Ver HA-SONDA-BUS-COMPLETO.md. Store/diário/avaliação UI e preservação em
backup/retorno, transições/AV/qualificação pendentes. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: avaliador técnico bus por política explícita de todos
os pares, peak/loudness por item/par, vínculo ao plano e política/revisão;
sem inferir faixa master para auxiliares, sem aprovar vazio ou PGM.
Ver HA-SONDA-BUS-COMPLETO.md. Captura/configuração local/persistência/UI/QC,
transições/AV/qualificação pendentes. Sem testes/build;10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: painel bus junto da cópia STAGED, intenção antes de
POST e consulta sem replay; leitor UI de proveniência/resumo, API client.
BUS_REVIEW ligado listagem/recuperação servidor/UI com consulta fresca e
correlação de ID, fase/data/processo/owner preservados. Fixtures UI preparados.
Ver HA-SONDA-BUS-COMPLETO.md. Política/transições/AV/qualificação e testes
integrados pendentes. Sem testes/build;10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: início/consulta bus ligados Store/Replication/API,
cópia própria STAGED/decisão AUTO/perfil capturados e reconferidos; intenção
antes do runner, quota na fila, SHA/stamp/cofre/QC/runtime antes-depois,
sessão/owner/cancelamento e IDs apenas. Ver HA-SONDA-BUS-COMPLETO.md.
UI/listagem/recuperação/política/transições/AV pendentes. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: diário bus cifrado/ID-only/captura/owner/fases/quota,
transições exatas e evidência privada vinculada ao plano/MAC/runtime; Store
cria/contabiliza/consulta e namespace inclui tabela. Fixtures preparados.
Ver HA-SONDA-BUS-COMPLETO.md. Início/cópia STAGED/Store/API/UI/listagem/
recuperação/política/transições/AV pendentes. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: plano/medição/recibos bus completos ligados em domínio,
ganho efetivo e provas pre-gain reutilizados, auxiliares/canais reais explícitos;
chaves e resultados sem paths vinculados ao plano/perfil/MAC/decisão/runtime.
Fixtures preparados. Ver HA-SONDA-BUS-COMPLETO.md. Diário/cópia STAGED/Store/
API/UI/política/transições/AV/homologação pendentes. Sem testes/build;
10(1/9),53(5/36/12),fora R55.

11/10 — 8.5/8.6 NOT_RUN: runner servidor da sonda bus usa executor isolado,
cancelamento/ownership/limites/SHA-stamp antes-depois; leitor estrito exige
config/corte/pares/cauda/cobertura exatos e nenhuma aprovação presumida.
Fixtures preparados, config binário adicionada. Ver HA-SONDA-BUS-COMPLETO.md.
Plano/recibos vinculados/diário/UI/política/transições/AV pendentes.
Sem testes/build, fora R55; totais10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: sonda nativa de bus completo usa ramos/kernel reais,
corte após mix, cauda compensada e cobertura PCM original (não padding).
Fixtures 2/8/16/corte/cauda preparados; binário exigido nas receitas Windows.
Ver HA-SONDA-BUS-COMPLETO.md. Runner/plano/recibos/diário/UI/política/transições/
A-V/qualificação pendentes. Sem testes/build, fora R55; 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: construção/ligação reais de ramos master/auxiliares
extraídas de channel e compartilhadas em audio_bus, engine ligado; mantém
tee antes do ganho, resample8/matrix/volume comum/mixer/caps e limiter na saída.
Ver HA-RAMOS-AUDIO-BUS-COMPARTILHADOS.md. Sonda bus/cortes/recibos/transições/
A-V/qualificação/QC/retorno pendentes; mudança exige regressão do lote.
Sem testes/build, fora R55; totais10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: kernel BusLimiter compartilhado entre elemento engine
e helper pós-ganho, estado independente por par, scratch reutilizado e redução/
atraso comuns; caps/PCM parcial recusados. Fixtures2/8/16 contra referência
preparadas, não executadas. Ver HA-KERNEL-LIMITER-BUS.md. Render bus real/
transições/A-V/qualificação/QC/retorno pendentes. Sem testes/build, fora R55;
totais 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: nova política pós-ganho COMPENSATE_AND_FLUSH, remove
startup240 e descarrega240 com contagem PCM exata; recibo específico/reader/key
não confundem legado. Limiter expõe atraso, finalização única e maior redução
inclui cauda. Ver HA-CAUDA-AUDIO-POS-GANHO.md. Apenas offline isolado; política/
bus/transições/A-V/QC/retorno/homologação pendentes. Sem testes/build, fora R55;
totais 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: painel pós-ganho integrado à cópia STAGED, confirmação/
intenção salva antes de POST, resumo e proveniência exatos, consulta sem replay.
Tipo POSTGAIN_REVIEW ligado listagem/recuperação UI/API/Store, só fases pendentes
com owner/processo/estado/data; quota/histórico preservados. Ver
HA-UI-AUDIO-POS-GANHO.md. Política/contingência/bus/cauda/transições/A-V/QC/
retorno/homologação pendentes. Sem testes/build, fora R55; 10(1/9),53(5/36/12).

11/10 — 8.5/8.6 NOT_RUN: início pós-ganho ligado Store/fila/Replication/API,
perfil local explícito/cópia STAGED/decisão AUTO registrados; SHA/stamp/cofre/
sidecars da cópia e evidência/QC/runtime/perfil reconferidos antes/depois.
Intenção antes do runner, consulta sem replay, quota/ator/canal/auditoria.
Ver HA-ORQUESTRACAO-AUDIO-POS-GANHO.md. UI/listagem/recuperação/política/bus/
cauda/transições/A-V/QC/retorno pendentes. Sem testes/build, fora R55;
totais 10 (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: diário pós-ganho cifrado com intenção/captura, fases,
reserva64MiB/prova16MiB, transações exatas, consulta sem replay e bind MAC/plano.
Store cria/contabiliza quota e consulta interna; namespace inclui tabela. Ver
HA-DIARIO-AUDIO-POS-GANHO.md. Início/captura confiável/Store/API/UI/recuperação,
política/bus/cauda/transições/A-V/QC/retorno ainda pendentes. Sem testes/build,
fora R55; totais 10 (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: runner pós-ganho agora gera recibos estritos sem paths,
chaves semânticas recomputadas, plano exato/PCM/DSP/runtime correlacionados,
falha sem recibo e resumo separado. Ver HA-RECIBOS-AUDIO-POS-GANHO.md.
Ainda sem diário/Store/API/UI; bus/cauda/transições/A-V/QC/retorno pendentes.
Sem testes/build, fora R55; totais 10 (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: planejamento/runner pós-ganho usam ganho efetivo
OFF/MANUAL/AUTO e perfil/cadência/bus explícitos; auxiliares independentes,
key por perfil/MAC/decisão/corte, AUTO sem evidência e ganho fora da faixa
bloqueados. Resampling qualidade 8 alinhado ao item do engine. Ver
HA-PLANO-AUDIO-POS-GANHO.md. Persistência/UI/política/bus/cauda/transições/A-V/
homologação pendentes. Sem testes/build, fora R55; totais 10 (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: medidor nativo ganhou modo isolado pós-ganho com DSP
Limiter compartilhado e constantes comuns; runner/leitor servidor estritos,
recibo separado de pre-gain, sem qualificar bus/transições/A-V/PGM. Ver
HA-SONDA-AUDIO-POS-GANHO.md. Persistência/UI/perfil/ganho efetivo/cauda e
qualificação completa pendentes. Sem testes/compilação/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: listagem/recuperação HISTORY_IMPORT/HISTORY_VARIANT
ligadas UI/API/Store e recibo operacional. Só pré-commit pode encerrar, com
owner/processo/estado/data e recibo ausente antes/depois; COMMITTING apenas
consultável, sem replay/falha presumida. Ver HA-RECUPERACAO-INTENCOES-HISTORICO.md.
Pedidos não registrados/decisões de commits incertos/qualificação/retorno real
pendentes. Sem testes/build, fora R55; totais 10 (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: histórico/variantes agora registram intenção durável
antes da extração, com owner/ator/quota; pedido existente não reenfileirado.
Commit incerto exige recibo operacional; UI distingue interrompido/incerto/
falha sem presumir importação ou PGM. Ver HA-HISTORICO-TRABALHOS-DURAVEIS.md.
Listagem/encerramento dessas intenções, pedidos não registrados e recuperação
operacional/qualificação pendentes. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: recuperação/listagem ampliadas à revisão técnica do
banco e reproteção, UI/API/Store. Novas revisões registram owner privado;
legados sem owner consultáveis, sem encerramento presumido. Gates de processo/
fase/data, quota/parciais preservados. Ver HA-RECUPERACAO-REVISAO-REPROTECAO.md.
Intenções não registradas/outros jobs/qualificação/retomada real pendentes.
Sem testes/build, fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: encerramento/listagem ampliados a candidato e aplicação
de vínculos, com UI/API/Store, fases específicas, alvo fresco e proteção de
STAGED. Mantidos owner/quota/parciais e unicidade das tentativas. Ver
HA-RECUPERACAO-CANDIDATO-VINCULOS.md. Outras etapas/intenções não registradas/
qualificação/recuperação operacional ainda pendentes. Sem testes/build,
fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: listagem paginada de revisão/cópia pendentes por canal
integrada API/Store/UI, inclusive outra execução, sem depender de sessão salva.
Até 25 registros/página; página vazia pode ter cursor, sem snapshot/PGM/estado
de processo presumido. Encerramento explícito por linha. Ver
HA-LISTAGEM-PEDIDOS-PENDENTES.md. Outras etapas/intenções não registradas e
recuperação operacional/qualificação pendentes. Sem testes/build, fora R55;
totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: encerramento ligado às telas de revisão/cópia, com
justificativa/confirmação, consulta fresca do alvo, intenção persistida antes
do POST e consulta sem replay. Histórico/parciais/quota preservados; não libera
PGM. Ver HA-UI-ENCERRAMENTO-PEDIDOS.md. Listagem/outras etapas/intenções não
registradas e recuperação completa pendentes. Sem testes/build, fora R55.
Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — 8.5/8.6 NOT_RUN: encerramento de revisão/cópia interrompida ligado
Store/quota/namespace/API; estado/data exatos, ausência PID local comprovada,
diário imutável e FAILED atômicos, parciais/quota preservados. Não retoma nem
transfere owner/PGM. UI/listagem/outras fases ainda pendentes. Ver
HA-ENCERRAMENTO-PEDIDOS-INTERROMPIDOS.md. Sem testes/build, fora R55.
Totais 10 grupos (1/9), 53 (5 concluídas/36 andamento/12 pendentes).

11/10 — lote NOT_RUN: corte de áudio declarado unificado com durationOverride
na análise local/publicação/visão/HA/master/auxiliar/AUTO. Recibo antigo muda
de identidade; duração inválida/fora do arquivo recusada. Timing dinâmico
ainda exige medição correspondente; ganho final/QC/retorno continuam pendentes.
Ver AUDIO-CORTE-DECLARADO-UNIFICADO.md. Sem testes/build, fora R55.
Totais 10 grupos (1/9), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — 8.5/8.6 NOT_RUN: adoção explícita AUTO conectada UI/pedido/Store/worker/
derivada. Decisão local registrada, MAC/SHA/itens exatos, só falta de medição
selecionada dispensada; originais/ganho/modo preservados. Não qualifica QC/
ganho final/barramento/PGM. Ver HA-ADOTAR-AUTO-NA-COPIA.md. Restam recuperação,
contingência, qualificação/grafismos/saídas/engine/autoridade/retorno/rejoin e
homologação. Sem testes/build, fora R55. Totais 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: página de revisão integrada à decisão AUTO,
seleção explícita de masters medidos, justificativa e intenção guardada antes
do POST; consulta do mesmo UUID sem repetição. Não aplica decisão à cópia nem
libera PGM. Ver HA-UI-DECISAO-AUTO.md. Aplicação/recuperação/contingência/QC/
qualificação/retorno e homologação continuam. Sem testes/build, fora R55.
Totais: 10 grupos (1 concluído/9 abertos), 53 (5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6 NOT_RUN: decisão AUTO ligada Store/quota256KiB/fila/
Replication/namespace/API consulta/opções/gravação, admin/canal/ator estável/
auditoria. Reconferência admite só medição AUTO faltante na decisão, nunca no
construtor comum. NÃO aplicada à derivada, UI/contingência pendentes. Ver
HA-ORQUESTRACAO-DECISAO-AUTO.md. Próximo UI/aplicação/contingência/QC/qualificação/
grafismos/saídas/engine/autoridade/retorno/rejoin/recuperação/homologação.
Sem testes/build, fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: contrato/proposta privada/diário imutável de decisão
AUTO implementados. Só master já AUTO com recibo MEASURED, sem paths/medição do
cliente, sem converter MANUAL/OFF/aprovar QC. NÃO ligados Store/quota/API/UI/
worker; contingência requer contrato próprio. Ver HA-DECISAO-AUTO-RETORNO.md.
Próximo orquestração/opções/reconferência/aplicação/contingência/QC/qualificação,
grafismos/saídas/engine/autoridade/retorno/rejoin/homologação. Sem testes/build,
fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: recibos de áudio ligados à derivada/diário/API/UI,
plano recomposto e chaves recalculadas por edição/corte/trilha/mix/par/ganho/modo.
Runtime reconferido antes/depois; resumo aplicado exato. Não altera AUTO/medição
editorial e mantém pós-ganho/limiter/barramento pendentes. Ver
HA-APLICACAO-EVIDENCIA-AUDIO.md. Próximo decisão AUTO/QC/qualificação/grafismos/
saídas/engine/autoridade/retorno/rejoin/recuperação/homologação. Sem testes/build,
fora R55; totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: áudio por corte/trilha/master/auxiliares ligado
revisão/fila/Store/Replication/diário/API/UI. Recibos cifrados, resumo público,
runtime reconferido; falhas bloqueiam, ausência/curtos explícitos. Ainda NÃO
aplicado à derivada/AUTO, ganho/limiter/barramento não qualificados. Ver
HA-REVISAO-AUDIO-PERSISTIDA.md. Próximo aplicação/QC/qualificação/grafismos/
saídas/engine/autoridade/retorno/rejoin/homologação. Sem testes/build, fora R55;
10 grupos (1/9), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: planejador de áudio por corte/trilha/master/par
auxiliar e executor do medidor nativo com cobertura PCM exata, SHA/runtime/
cancelamento/pipe pai implementados. Ainda NÃO ligados revisão/diário/Store/API/
UI/derivada. Prova pré-ganho não qualifica ganho/limiter/barramento; cortes<400ms
pendentes explícitos. Ver HA-MONTAGENS-AUDIO-RETORNO.md. Próximo integração/
evidência/aplicação/AUTO/qualificação, grafismos/saídas/engine/autoridade/retorno/
rejoin/homologação. Sem testes/build, fora R55; 10(1/9), 53(5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: recibos gráficos ligados à derivada media.db por
edição/item/posição/digest, com reconferência runtime antes/depois do worker.
Resumo aplicado diário/API/UI; render passa a pendência visual/composição,
não a autorização. Legacy sem prova preservado; fonte/históricos intactos.
Ver HA-APLICACAO-EVIDENCIA-GRAFISMOS.md. Próximo aprovação visual/recursos/
fontes/camadas/transições/mixes/automação/saídas/engine/autoridade/retorno/rejoin/
homologação. Sem testes/build, fora R55; 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: sonda gráfica ligada fila/Store/Replication/diário/
API/UI da revisão de mídia. Recibos por composição cifrados/MAC, totais públicos,
status render/ausência/falha/bloqueio separados da aprovação visual. Runtime
reconferido antes da gravação, históricos não reinterpretados. Ainda NÃO aplica
prova gráfica à derivada nem autoriza operação. Ver HA-REVISAO-GRAFISMOS-PERSISTIDA.md.
Próximo aplicação/decisão visual/recursos/camadas/transições/mixes/saídas/engine/
autoridade/retorno/rejoin/homologação. Sem testes/build, fora R55; 10(1/9),53(5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: sonda nativa separada de grafismos (rsvgoverlay),
leitor privado de quadro RGBA com SHA/limites/cancelamento e viewport compartilhado
com operação; receitas Windows incluem helper. Quick-xml resolvido offline,
sem build/teste. NÃO ligada ainda ao diário/Store/API/UI, nem aprova visual/
camadas/transições/fontes/recursos/autoridade. Ver HA-SONDA-GRAFISMOS-LOCAL.md.
Próximo: fila/evidência persistida e composição, mixes/saídas/engine/autoridade/
retorno/rejoin/homologação. Fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: conferência de grafismos/automação compartilhada
entre revisão de mídia e criação de derivada. Campos de deixas/eventos preenchidos
antes do inventário de recursos; bloqueios entram no relatório persistido, sem
paths resolvidos. Templates duplicados/limites recusados; render nativo continua
pendente. Históricos preservados. Ver HA-CONFERENCIA-GRAFISMOS-RETORNO.md.
Faltam render/mixes/recursos/automação/saídas/engine/autoridade/retorno/rejoin/
homologação. Sem testes/build, fora R55; totais 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: criação de media.db integrada diário/quota512MiB/
fila/Store/Replication/API/UI; intenção antes de preparar/arquivos, fonte/destino/
evidência/plano/QC/runtime/provas reconferidos. Worker gera variantes uma vez,
sem duplicação no servidor. Cópia continua parada/quarentenada, sem outputs/
nativo/autoridade. Próximo: mixes/grafismos/automação/saídas/principal/KEEP_PRIMARY/
híbrido/engine/autoridade/retorno/rejoin/recuperação/histórico/homologação. Ver
HA-ORQUESTRACAO-DERIVADA-MIDIA-RETORNO.md. Sem testes/build; fora R55. Totais
10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: construtor de media.db ligado ao worker; copia
bound.db selada, valida proveniência/MAC exato, grava novas edições com mídia
local e cursor parado, marker novo bloqueia bootstrap. Fonte preservada, sem
saídas/nativo/autoridade. Próximo: diário/quota/Store/API/UI da criação, depois
mixes/grafismos/saídas/principal/KEEP_PRIMARY/híbrido/nativo/autoridade/retorno/
rejoin/homologação/recuperação. Ver HA-CONSTRUTOR-DERIVADA-MIDIA-RETORNO.md.
Sem testes/build; fora R55. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: leitura de evidência protegida + reconferência
bytes/QC/runtime e variantes de mídia ligadas internamente ao Store/fila.
Recusa outro backend/canal/aplicação e cadência/barramento diferentes sem decisão
explícita. NÃO grava nova DB nem expõe resultado privado pela API. Próximo:
construtor/diário/quota/worker/API/UI da derivada, mixes/grafismos/saídas/nativo/
principal/KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação/recuperação.
Ver HA-PREPARACAO-EVIDENCIA-MIDIA-RETORNO.md. Sem testes/build; fora R55.
Totais 10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: escolha explícita em mídia local ambígua ligada
Store/Replication/API/UI. ID/SHA/tipo local e inventoryMac por aplicação/acervo/
QC, sem paths; escolhas persistem na intenção e são reconferidas na fila. Seletor
limitado1000 conteúdos/10000 opções, sem truncamento pronto; paginação maior
pendente. Próximo: evidência aplicada a derivada/mixes/grafismos/saídas/nativo/
principal/KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação/recuperação.
Ver HA-ESCOLHA-MIDIA-LOCAL-RETORNO.md. Sem testes/build; fora R55. Totais
10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: análise local ligada a aplicação STAGED via diário/
quota64MiB/fila/Store/Replication/App/API/UI. Evidência privada cifrada; resposta
sanitizada com totais e até200 pendências, consulta sem repetir. Confere aplicação
selada/plano/acervo/QC/runtime/sessão; revisão não habilita mídia ou PGM. Próximo:
derivada com evidência aplicada, ambiguidades, mixes/grafismos/saídas/nativo/
principal/KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação e recuperação
explícita de pedidos interrompidos. Ver HA-REVISAO-DURAVEL-MIDIA-RETORNO.md.
Sem testes/build; fora R55. Totais 10 grupos (1/9), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: primitivas de mídia local implementadas, acervo
inteiro por SHA e QC explícito em transação, bytes antes/depois da sonda, cortes/
trilhas/mixes/contingência via inspetor compartilhado e resultado privado. NÃO
integradas ainda a diário/Store/API/UI; sem arquivos/sonda executados. Próximo:
revisão durável e derivada com mídia/QC/mixes/grafismos/saídas, principal atual/
KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação. Ver HA-ANALISE-MIDIA-
LOCAL-RETORNO.md. Sem testes/build; fora R55. Totais 10 grupos (1/9), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: aplicação de entradas ligada Store/fila/diário/
quota256MiB/worker/Replication/API/UI. Fonte e plano próprios, SHA/identidade/
cofre antes/depois, sessão/posse leve durante SHA e revisão completa nas fronteiras.
Nova bound.db STAGED continua arquivada/parada, mídia BLOCKED e sem saídas/
nativo/autoridade. Próximo: arquivos/QC/mixes/grafismos/automação/principal/
KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação e recuperação explícita
de pedidos interrompidos. Ver HA-ORQUESTRACAO-APLICACAO-RETORNO.md. Sem testes/
build; fora R55. Totais 10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: construtor privado de bound.db ligado ao worker;
copia candidato selado sem modificar fonte, aplica referências locais de live,
cria novas revisões/cursor parado e bloqueia bootstrap por novo marcador. Mídia/
QC/grafismos/eventos/saídas/nativo/autoridade ainda não habilitados. Próximo:
Store/diário/quota/API/UI da aplicação, depois arquivos/QC/mixes/grafismos/
principal/KEEP_PRIMARY/híbrido/autoridade/retorno/rejoin/homologação. Detalhes
HA-CONSTRUTOR-VINCULOS-RETORNO.md. Sem testes/build; fora R55. Totais
10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

11/10 — complemento 8.5/8.6 NOT_RUN: consulta de vínculos pelo UUID, inclusive
decisões substituídas. Novos planos cifrados têm identidade de candidato/seleção;
consulta/escrita/uso recusam associação a outro candidato. Legados sem identidade
preservados, não adotados. API/UI consultam requestPlan sanitizado e encerram
consulta histórica confirmada sem apagar diário. Intenção não registrada ainda
requer recuperação explícita; aplicação a derivada/mídia/QC/nativo/autoridade/
retorno/rejoin/KEEP_PRIMARY/híbrido/homologação permanecem. Sem testes/build;
fora R55. Totais 10 grupos (1 concluído/9 abertos), 53 (5/36/12).

11/10 — lote 8.5/8.6 NOT_RUN: vínculos do candidato integrados Store/Replication/
API/UI. Plano cifrado/imutável separado; todas edições selecionadas exigem fontes
locais, saídas vêm do principal atual, token associa candidato e configuração/
inventário/plano. Navegador guarda apenas IDs e consulta sem reenviar. Sem abrir
nativo/PGM. Falta aplicar a nova derivada com arquivos/QC/mixes/grafismos, revisar
principal/KEEP_PRIMARY/híbrido, autoridade/retorno/rejoin e homologação. Detalhes
HA-VINCULOS-CANDIDATO-RETORNO.md. Sem testes/build; fora R55. Totais: 10 grupos
(1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6 NOT_RUN: origem privada do candidato ligada ao Store/fila/
cancelamento/worker readonly; seleção inteira, mapeamentos, cofre e SHA/identidade
antes/depois conferidos. Não expõe proveniência na API nem habilita publicação.
Próximo: visão sanitizada e vínculos locais associados ao candidato; mídia/QC/
nativo/autoridade/KEEP_PRIMARY/híbrido/rejoin ainda faltam. Detalhes em
HA-LEITURA-PRIVADA-CANDIDATO-RETORNO.md. Sem testes/build; fora R55.
Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes).

11/10 — lote 8.5/8.6, NOT_RUN: criação guiada de candidato ligada ao Store/fila/
diário/quota256MiB/worker/Replication/API/página. Intenção antes de arquivos,
SHA/tamanho/identidade/sidecars origem/destino e fingerprint/provas reconferidos;
falhas e históricos preservados sem retry. STAGED arquivado/parado, sem bindings/
nativo/autoridade/PGM. Faltam nova derivada com vínculos/arquivos/QC/mixes/grafismos/
comandos, principal atual/KEEP_PRIMARY/híbrido, autoridade/retorno/rejoin e
homologação. Sem testes/build; fora R55. Totais 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — complemento NOT_RUN do construtor: bootstrap genérico recusa marcador
de candidato HA antes de journal/migração/operação, mesmo proveniência vazia.
Não apagar marcador como autorização. Ativação explícita validada permanece
pendente. Totais inalterados 10 grupos (1/9), 53 verificações (5/36/12); sem build.

11/10 — lote 8.5/8.6, NOT_RUN: construtor de candidato local NOVO e runner/worker
implementados, ainda NÃO ligados ao Store/API/UI. Schema local, canal arquivado,
cursor parado, IDs locais e originais cifrados; paths/endpoints/grafismos/eventos
não importados como execução. Variante bloqueada, bindings/native false. Faltam
orquestração/quota/diário/SHA e bloqueio de ativação, bindings/mídia/QC/nativo/
autoridade/retorno/rejoin/homologação. Sem testes/build; fora R55. Totais
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6, NOT_RUN: seleção explícita RETURNED_REKEYED_COPY integrada
candidatos/referências/diário cifrado imutável/API/página. Conjunto+edição+política
de cursor+justificativa, MAC/SHA/revisão próprios; futuras ativas preservadas,
UUID só consulta sem replay. SELECTION_RECORDED não prepara engine/mídia nem
autoriza PGM. Faltam materialização/candidato, KEEP_PRIMARY/híbrido, vínculos/
arquivos/QC/nativo/comandos/autoridade/retorno/rejoin/homologação. Sem testes/build;
fora R55. 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6, NOT_RUN: requisitos mídia/QC/montagem integrados à revisão
de conteúdo/página, reutilizando contrato HA de trim/track/mix/pares/medição.
Versão por asset/SHA, QC em ordem incluindo revogação global e vínculos/sinal
live exigidos; não segue caminhos estrangeiros nem comprova bytes/probe local.
Plano de seleção ainda NÃO persistido/aplicado; falta resolver cópias locais,
seleção/arquivos/nativo/autoridade/retorno/rejoin e validar. Sem testes/build;
fora R55. 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6, NOT_RUN: comparação de payloads publicados e checkpoint
integrada à revisão reprotegida/página. Mesmo ID com conteúdo divergente detectado;
JSON canônico/HMAC local, sem expor segredos; value do checkpoint comparável e
referências edição/grade/item diagnosticadas sem corrigir/selecionar. Faltam plano/
seleção revisados, mídia/QC/comandos/abertos, retenção/geração perdida, autoridade/
retorno/rejoin/homologação. Sem testes/typecheck/build; fora R55. Totais mantidos:
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).

11/10 — lote 8.5/8.6, NOT_RUN: revisão opcional de rekeyId integrada à quota/
diário/cópia privada/worker/API/UI. SHA reprotegido, legibilidade de protectedColumns
no cofre efetivo e atestado estrangeiro reconferidos; sem plaintext na resposta,
sem aprovação de conteúdo/autoridade. Históricos continuam usando revisão original.
Colisão de chamadas web plano/revisão corrigida. Faltam semântica de edição/mídia/
cursor/comandos/abertos, origins/contextos restantes, retenção/geração perdida,
autoridade/retorno/rejoin e homologação. 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes). Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: atestado de assinaturas estrangeiras integrado
exportação/ponte/reproteção/worker/resultado/página. Origem valida posse/distribuição/
servidor/manutenção/restauração; principal conserva assinaturas originais como
histórico, sem reassinar autoridade local. Checkpoint é JSON; journals HA em
operator_decisions já usam contexto padrão (corrige hipótese anterior). Faltam
revisão semântica/derivada, edição/mídia/cursor/comandos/abertos, contextos restantes,
retenção/geração perdida, autoridade/retorno/rejoin e homologação. Totais mantidos:
10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/
12 pendentes). Sem testes/typecheck/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: reproteção no principal ligada à derivada privada/
SHA/quota/worker/fingerprint/diário/API/página. Recebido e banco ativo preservados,
chave privada não copiada; resultado REKEYED_STAGED não aprova operação. Faltam
contextos especiais, revisão da derivada/edição/mídia/cursor/comandos, retenção/
geração perdida, plano/retorno/rejoin e homologação. 10 grupos (1 concluído/
9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).
Sem testes/build; mudanças fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: ponte de campos protegidos conhecidos ligada à
exportação privada/worker/selo. Chave derivada por exportação/pareamento, PK e
inventário autenticados; chave privada de instalação não trafega. SHA bruto/final
separados. Importador isolado implementado no auxiliar, ainda NÃO habilitado no
principal; faltam orquestração/rekey completo de journals, edição/mídia/cursor/
comandos/retorno/rejoin/homologação. 10 grupos (1 concluído/9 abertos),
53 verificações (5 concluídas/36 andamento/12 pendentes). Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: política explícita de conflitos CHANGED/PRIMARY_ONLY
integrada revisão/worker/commit real/API/página. Hash atual do principal e recebido
reconferidos; variantes completas+justificativa arquivadas atomicamente/cifradas,
sem overwrite/fechamento/duplicar as-run ou confirmar incerteza nativa. Faltam
verdade operacional de conflitos/abertos, chaves/edição/mídia/cursor/comandos,
retenção/geração perdida, retorno/rejoin e homologação. Totais 10 grupos
(1 concluído/9 abertos), 53 verificações (5 concluídas/36 andamento/12 pendentes).
Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: append explícito de as-run novos/encerrados/nativos
integrado revisão/worker/commit real no App/API/página. ID/hash de todos os campos,
SHA antes/depois e registros+auditoria numa transação; UUID confirmado sem replay.
Não substitui conflitos nem conclui reconciliação inteira. Faltam conflitos/abertos,
chaves/edição/mídia/cursor/comandos, retenção/geração perdida, retorno/rejoin e
homologação. 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes). Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: revisão técnica do recebido ligada ao diário/
API/painel e novo worker empacotável. Derivada privada preserva recebido, quota
inclui revisões/parciais, SHA antes/depois, SQLite/schema/edições/as-run/cursor
diagnosticados sem migração/merge/instalação. Principal alterado bloqueia aprovação.
Faltam reconciliação efetiva/chaves/mídia/cursor/comandos, retenção/geração perdida,
retorno/rejoin/homologação. 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes). Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: retomada explícita de transferência parcial
integrada ao diário/token/STATUS fresco/SHA/API/página, sem BEGIN/truncamento/
replay/adoção de geração perdida. Limitador compartilhado entre envios reversos
conta custo conservador de rede e cancela ao encerrar. Faltam geração perdida/
retenção, reconciliação SQLite/chaves/mídia/edição/cursor/as-run, retorno/rejoin
e homologação. 10 grupos (1 concluído/9 abertos); 53 verificações
(5 concluídas/36 em andamento/12 pendentes). Sem testes/build; fora R55.

11/10 — lote 8.5/8.6, NOT_RUN: remetente reverso da exportação própria ligado
ao receptor RETURN, diário cifrado antes de transmitir, SHA atual, recibo
correlacionado e API/painel com intenção persistida/consulta STATUS sem replay.
Recebimento permanece QUARENTENA, sem instalação/sincronização operacional ou
aprovação/autoridade. Faltam parciais/geração perdida, limite de rede/retenção,
reconciliação SQLite/chaves/mídia/edição/cursor/as-run, retorno/rejoin e homologação.
10 grupos (1 concluído, 9 abertos); 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Sem testes/build; alterações não incluídas em R55.

11/10 — lote 8.5/8.6, NOT_RUN: receptor reverso no principal integrado ao
pareamento RETURN cifrado/assinado, quarentena privada, diário cifrado, quota,
blocos idempotentes por bytes/offset, SHA real e recibo RECEIVED_QUARANTINE.
Consulta administrativa por canal/painel sem caminhos privados ou instalação.
Ainda falta remetente explícito/recibo no reserva, reconciliação SQLite/chaves/
edição/mídia/cursor/as-run, retorno/rejoin e homologação. Totais: 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Nenhum teste/build; R55 permanece sem estas alterações.

11/10 — lote 8.5/8.6, NOT_RUN: exportação privada selada do banco efetivamente
executado ligada à parada própria/diário cifrado/API/painel. UUID sem replay,
origem preservada, SHA real do destino, selo distinto da preparação. Plano remove
somente bloqueio de exportação; NÃO confirma sincronização/reconciliação/retorno.
Faltam transporte reverso com recibo, validação SQLite/chaves, reconciliação no
principal, rejoin, homologação e build. Totais inalterados: 10 grupos (1 concluído,
9 abertos), 53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
Nenhum teste/build executado; pacote atual permanece R55, sem estas alterações.

11/10 — lote 8.5/8.6, NOT_RUN: conferência read-only de retorno integrada
diário de parada/assignment assinado/API/painel. Mostra lease vigente, instância/
autoridade alteradas e controles não reconciliados. Retorno NÃO habilitado:
faltam exportação selada, sincronização reversa e revisão no principal antes
da transferência/retomada admitidas. Totais 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

11/10 — lote 8.3, NOT_RUN: encerramento explícito da execução própria integrado
conferência/diário/API/painel. UUID sem replay, confirmação de interrupção,
bloqueio de novos comandos e parada engine+mídia/warmup/backend antes de liberar
storage. Timeout/handle perdido/accounting incerto não confirmam; diários antigos
preservados, sem retorno/novo engine implícitos. Faltam parada perdida/offline,
devolução de autoridade/fronteiras/contingência/habilitação/reverse replication/
rejoin/validação. Totais 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

11/10 — lote 8.3, NOT_RUN: revisão CUE/TAKE com recibo correlacionado ao UUID/
edição/owner/term integrada transporte/diário/API/painel. Não compara apenas
item no ar; TAKE exige novo decoder. Token e concessão reconferidos; registro
original preservado, revisão cifrada sem comando/replay. Sem recibo/perda de
geração mantém bloqueio. Faltam revisão de geração perdida/fronteiras/contingência/
habilitação/reverse replication/rejoin/validação. Totais 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Fixtures NOT_RUN; sem testes/build.

11/10 — lote 8.3, NOT_RUN: painel CUE/TAKE ligado à edição publicada/controle
admitido. Seleção de lista não é CUE; TAKE usa CUE exato. UUID salvo antes do
envio, erro/reload não repetem comandos, prova nativa obrigatória no retorno.
Nova confirmação CUE evita esperar refresh para TAKE; consulta histórica não
atualiza seleção operacional. Faltam revisão de controle, fronteiras/contingência/
habilitação/reverse replication/rejoin e validação. Totais 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Fixtures NOT_RUN; sem testes/build.

11/10 — lote 8.3, NOT_RUN: CUE/TAKE integrados transporte/handle/API/diário cifrado.
Mesmo item/edição/CUE/owner/term, fila única e concessão atual; live aguarda prova
nativa, não ACK de abertura. UUID não repete; pendência/incerteza bloqueia comando.
Faltam interface e reconciliação de controle, fronteiras/contingência/revisões/
habilitação/reverse replication/rejoin/validação. Totais 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Fixtures NOT_RUN; sem testes/build.

11/10 — lote 8.3, NOT_RUN: saúde de mídia própria integrada à operação/painel,
API+incarnação/portas/posse sem sobreposição. Perda encerra mídia própria, sem
adotar/reiniciar; encerra engine somente se PGM depende dela, não por falha só
de PVW/MON. Cleanup engine+mídia independente e confirmação de ambos obrigatória.
Faltam recuperação/reconfiguração, controles/fronteiras/contingência/revisões/
habilitação/reverse replication/rejoin e validação. Totais 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Fixtures NOT_RUN; sem testes/build.

11/10 — lote 8.3, NOT_RUN: mídia própria/adaptador/paths/observação/painel WHEP
integrados em fonte. Path vem do destino loopback revisado e handle próprio;
browser usa host da interface, sem credenciais ou destino remoto presumido.
Ligar/Desligar e Ver são explícitos; nenhum novo engine/CUE/TAKE. Falta validar
conexão real e completar saúde/controles/fronteiras/contingência/revisões/
habilitação/reverse replication/rejoin. Totais: 10 grupos (1 concluído,
9 abertos), 53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
Sem testes/build; não declarar preview real ou HA pronta.

11/10 — lote 8.3, NOT_RUN: adaptador ligado à mídia própria após transferência
e parada confirmada de warmup; reserva distribuição na cópia, configura paths
loopback revisados e confirma readiness antes da geração cercada. Stop exige
engine+mídia confirmados; cancelamento não impede cleanup. Destinos remotos não
viram locais. Faltam WHEP/saúde durante operação, controles/fronteiras/contingência/
revisões/habilitação/reverse replication/rejoin e validação. Totais: 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Sem testes/build; preview no painel ainda não conectado.

11/10 — lote 8.3, NOT_RUN: MediaMtx preparado com startConfirmed sob admissão
atual/configuração/posse/cerca e stopConfirmed por callbacks de TODOS os filhos
da instância. Timeout/kill/porta não viram prova de parada. Restam integração ao
adaptador e reserva de distribuição, paths/WHEP, fronteiras/contingência/revisões,
habilitação, reverse replication/rejoin e validação. Totais: 10 grupos
(1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). Sem testes/build; preview da reserva ainda não conectado.

11/10 — lote 8.3, NOT_RUN: mudança de item integra decoder nativo confirmado,
nova identidade local de ocorrência, scheduler da edição congelada e as-run.
Checkpoint aguarda decoder/accounting correspondentes; não reutiliza execução
anterior. Retomada inicial mantém supressão de eventos estrangeiros; ocorrência
nova tem fases locais próprias. Restam fronteiras/troca de edição, contingência,
comandos de operação, outras revisões, MediaMTX, habilitação, replicação reversa/
rejoin e validação consolidada. Totais: 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

11/10 — lote 8.3, NOT_RUN: revisão explícita do monitor incerto integrada
diário/API/interface. Novo UUID define estado após conferência assinada atual,
sem execução concorrente do anterior; só novo ACK com autoridade/geração atuais
resolve a cadeia. Pedido antigo preservado incerto, sem confirmação retroativa.
REFUSED/consulta/reload não resolvem nem repetem comandos. Restam revisão de
transferência/grafismos/eventos, MediaMTX, transições/contingência, habilitação,
replicação reversa/rejoin e validação. Totais permanecem 10 grupos (1 concluído,
9 abertos), 53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
Fixtures NOT_RUN; sem testes ou build; R55 não contém este lote.

11/10 — lote 8.3, NOT_RUN: monitor PVW/MON integrado da interface ao engine
promovido rastreado. Pedido UUID cifrado, consulta GET sem reenvio, concessão
assinada/posse/host/geração e autorização por canal antes/depois do ACK.
Comando nativo próprio com cerca; PGM intacto, sem novo runtime/CUE/TAKE.
Pedido desconhecido preservado na sessão do browser; incerteza bloqueia novo
envio. Restam revisão explícita, MediaMTX, transições/contingência, habilitação
do adaptador, replicação reversa/rejoin e validação consolidada. Totais:
10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em
andamento, 12 pendentes). Sem testes/build; R55 não contém este lote.

10/10 — lote 8.3, NOT_RUN: observação da execução promovida ligada ao diário,
rota read-only por canal autorizada e painel da reserva. Confirmação histórica
separada de handle atual/posição nativa; sem autoridade/sinal presumidos.
Refresh sem sobreposição e aviso de dado antigo. Restam comandos/monitor/
MediaMTX/transições/contingência/revisão de incertezas/habilitação/replicação
reversa e validação. Totais: 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

10/10 — lote 8.3, NOT_RUN: Preview local congelado no bootstrap, publicador
retido no native startup e liberação única após admissão PGM/accounting, sem
novo endereço no comando. Cerca/ACK/geração obrigatórios; falha para processo
próprio sem replay. Restam painel/monitor/MediaMTX da execução promovida,
transições/contingência/revisão de incertezas, habilitação e replicação reversa.
Sem testes/build; totais: 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: adaptador nativo interno implementado sobre factory
privada, preparo/retomada retidos e activate/stop únicos sem replay. Não libera
saída nem transfere autoridade por conta própria; constructor perdido permanece
incerto. Ainda não é default no produto: faltam operação/edições/contingência/
painel/Preview, revisão de incertezas e validação. Totais: 10 grupos (1 concluído,
9 abertos), 53 verificações (5 concluídas, 36 em andamento, 12 pendentes).
Fixtures mockados NOT_RUN; sem testes/build nesta etapa.

10/10 — lote 8.3/8.4, NOT_RUN: renovação da concessão separada do SHA completo
do candidato. Continua exigindo posse local e assignment assinado atual exato
antes/depois; provas pesadas mantidas em LOAD/TAKE/composição/accounting/release.
Retirada duplicação de prova no preparo cercado. Ganho de latência não medido.
Faltam revisão de incertezas, transições/contingência/painel/Preview/adaptador,
replicação reversa e homologação. Totais: 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

10/10 — lote 8.3, NOT_RUN: diário HA_SECONDARY projetado read-only no espelho
e consultado pelo ledger comum após restart, com cronologia/identidade/SHA.
Fases incertas continuam bloqueadas; fases passadas não viram novos envios ou
linhas ordinárias presumidas. SUPERSEDED não é execução física. Falta revisão
explícita de incerteza, fronteiras/contingência/painel/Preview/adaptador e
replicação reversa. Sem testes/build; totais: 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: vínculo gráfico local no checkpoint, namespace
próprio/SHA/cronologia; snapshot e restore normal leem ponte HA explicitamente
e não convertem ACK antigo em publicação atual. Mudança posterior incerta ou
novo display confirmado bloqueia cursor gráfico antigo. Execução gráfica e
checkpoint compartilham UUID local. Faltam eventos após novo reinício,
fronteiras/contingência/painel/Preview/adaptador e replicação reversa.
Sem testes/build; totais: 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: checkpoint próprio após release e periódico, com
posse/execução/edição locais. Position nativo passa decoderId; cursor exige
amostra recente da mesma geração, sem legado/estimativa/clamp/EOS fora do corte.
Faltam vínculo gráfico local restaurável, fronteiras/contingência, eventos de
novas ocorrências, painel/Preview/adaptador e replicação reversa. Sem testes/build.
Totais: 10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas,
36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: as-run NATIVE local ligado à prova de release da
geração cercada, ignorando TAKE interno retido. Vínculo de posse/edição, fila de
callbacks TAKE/limpeza, proveniência da promoção e fechamento próprio após
exit; erro de registro encerra transporte sem replay. Histórico estrangeiro
preservado, sem execução presumida. Faltam checkpoint/fronteiras/contingência,
novas ocorrências gráficas, painel/Preview/adaptador e replicação reversa.
Sem testes/build; totais: 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: dispatch dos eventos gráficos futuros ligado ao
compositor da ocorrência retomada com UUID/recibos locais e identidade de
decoder. Passado não é reenviado; HIDE de camada substituída é SUPERSEDED.
Cadência só autoriza quando há trabalho. Equipamento/SCTE sem vínculo recusados.
Faltam admissão de novas ocorrências/edições, continuidade/as-run, Preview e
adaptador completo. Totais: 10 grupos (1 concluído, 9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build/hardware.

10/10 — lote 8.3, NOT_RUN: plano de eventos secundários da ocorrência original
ligado ao candidato e seed do compositor. Fases antigas/prazos já alcançados
suprimidos sem replay; FIRING bloqueia preparo; futuros/manuais separados e
eventos ativos exigem dono local. Não cria EXECUTED estrangeiro nem dispara
destinos. Faltam dispatch futuro com ledger/donos novos, continuidade/as-run,
Preview e adaptador completo. Totais mantidos: 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes). Sem testes/build.

10/10 — lote 8.3, NOT_RUN: manutenção de expiração gráfica ligada após liberação
nativa e antes de confirmar promoção; prazos preservados, recibos locais,
sem sobreposição/replay e parada própria em falha. Cadência sem I/O quando nada
vence. Shutdown cancela/aguarda manutenção. Faltam reconciliação de eventos,
continuidade operacional/as-run, Preview e adaptador completo. Sem testes/build;
totais: 10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas,
36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: composição gráfica confirmada passa ao snapshot e
ao candidato; ausência legada é UNVERIFIED, incerteza bloqueia display. Preparo
gráfico na geração cercada ligado antes da retomada interna, com recibo local
novo/SHA/ACK, recursos externos recusados e sem replay de donos estrangeiros.
Não libera saída nem fecha homologação. Faltam operação durável, expiração/
eventos locais após ativação, Preview posterior e adaptador completo. Totais
inalterados: 10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). Sem testes/build nesta etapa.

10/10 — continuação do lote 8.3, NOT_RUN: geração cercada ligada à factory
interna do orquestrador/adaptador, exige transferência/admissão atuais e parada
comprovada do warmup. Handle rastreado, concessão renovada, destinos locais
retidos e retomada do cursor no PGM interno; live aguarda decoder nativo, não
apenas ACK. Liberação externa ainda não ocorre nessa fase. Faltam composição/
grafismos, operação durável, Preview posterior e habilitação do adaptador real.
Sem testes/build; totais inalterados: 10 grupos (1 concluído, 9 abertos),
53 verificações (5 concluídas, 36 em andamento, 12 pendentes).

10/10 — lote 8.3, NOT_RUN: preparo de destinos ligado ao candidato autenticado.
Cada saída habilitada exige vínculo local exato ou desativação com motivo.
Formato/bitrate são preservados; Preview/monitor usam protocolo efetivo SRT e
limites leves; endereço gerenciado não é derivado do host principal. Mudanças
nos perfis completos invalidam o plano local. Não abre publisher nem concede
PGM. Ativação cercada, composição/mixes e continuidade operacional continuam
em andamento. Sem testes/build nesta etapa; totais de fechamento inalterados:
10 grupos (1 concluído, 9 abertos), 53 verificações (5 concluídas, 36 em andamento,
12 pendentes). R55 não contém estas alterações.

Inventário de fechamento em 08/10/2026. Escopo preservado: relatório anotado e
todos os pedidos anteriores. IDs fixos; não renumerar para esconder pendências.
Novos requisitos recebem novos IDs e mudança explícita da contagem.

Estes são **marcos de fechamento**, não o número de defeitos, funcionalidades
ausentes ou testes automatizados. Código implementado não equivale a fluxo
homologado. A matriz `IMPLEMENTACOES-BROADCAST-2026-09-30.md` continua sendo a
evidência detalhada por requisito; seus resultados históricos mantêm a atribuição
à fonte/build correspondente. Não recomeçar funções já implementadas.

Estados: **concluída** exige evidência no escopo indicado; **em andamento** tem
trabalho atual; **pendente** aguarda implementação, integração ou homologação
final indicada. Nenhum requisito físico pode ser encerrado por simulação.

## Política de execução e validação

Continuação 8.3: decoder real de preparo ligado ao orquestrador após backend
copiado, com posse própria, consumidores nulos e LOAD no corte/offset da edição
congelada. Sem TAKE/PGM externo/checkpoint/as-run importado. Live LOAD não prova
quadro; VT confirma preroll, não mix/grafismo/entrega. Handle/stop observados,
sem restart automático. Contrato HA-DECODER-DE-PREPARO.md; fixtures NOT_RUN.
Ativação cercada/destinos/cursor/composição e operação ainda faltam; adaptador
nulo continua recusando. Totais mantidos, sem testes/build.

Continuação 8.3: backend distinto da cópia ligado ao orquestrador/adaptador sob
mesma reserva. Fingerprint/registro/auditoria na abertura, transferência sem
release, quarentena de runtime/saídas/MediaMTX/descoberta. Encerramento deduplicado
mantém banco/broker sob controle do orquestrador até parada confirmada. Falta
admitir a execução nativa, destinos/cursor/mixes/grafismos e operar promoção.
Fixtures atuais NOT_RUN, sem testes/build. Totais de fechamento preservados.

Continuação 8.3: posse da cópia agora ligada ao orquestrador. Broker nativo
local + prova fresca, cópia autenticada/schema corrente/quarentena e reserva
storage assinada antes do adaptador. Capacidade interna não serializável,
transferência de conexão sem release, parada incerta conserva MAINTENANCE.
Contrato em HA-POSSE-DA-COPIA.md, fixtures NOT_RUN. Factory operacional ainda
falta e adaptador nulo continua recusando antes de efeitos. Sem testes/build;
totais de fechamento mantidos (10 grupos; 53 verificações: 5/36/12).

Continuação 8.3/10.3: pasta gerada de execução recebe proteção própria no
auxiliar nativo, com DACL restrita e herdável; não altera raiz nem pasta com
conteúdo. Backend autentica origem cifrada e confere cópia/UUID/canal/SHA antes
do adaptador. Fixtures de proteção/recusa e origem alterada preparados, NOT_RUN.
Build conjunta com auxiliar novo obrigatória; não houve build/testes. Posse
host/storage e factory da execução ainda faltam. Totais de fechamento mantidos.

Continuação 8.3: diário registra UUID de cópia antes dos efeitos; cria banco
distinto em executions/UUID, protegido antes dos bytes, com SHA/identidade/
fsync/espaço/autorização e origem cifrada. Adaptador recebe a cópia, não deve
mutar a preparação original. Repetição não sobrescreve nem retoma pasta;
parcial permanece isolado. Sem desarquivar canal, dar posse ou abrir PGM.
Factory admitida/sidecars/destinos/cursor/mixes/grafismos ainda faltam. Contrato
em HA-COPIA-DE-EXECUCAO.md; fixtures NOT_RUN, sem novo build. Totais preservados.

Continuação 8.3: orquestrador recebe transporte nativo admitido/retido, confere
edição/cursor e concessão antes de liberar, obtém prova do próprio transporte e
persiste decoder. Adaptador não entrega confirmação fabricada por callback.
Histórico antigo sem decoder é preservado e marcado como prova incompleta,
nunca usado para reativação. Fixtures de transporte incorreto, cursor divergente,
lease inativa e saídas não retidas: NOT_RUN. Adaptador completo/API/UI ainda
faltam, promoção permanece desabilitada; totais de fechamento inalterados.

Continuação 8.3/8.4: liberação retorna posição e corte observados pelo pipeline
nativo, com quadro recente/roteamento. TAKE pendente, VT encerrado ou sinal
perdido recusam admissão; falha após montagem encerra essa geração no próprio
engine. Backend recusa prova ausente/posição anterior/corte divergente e devolve
prova do mesmo pedido. Fixtures adicionais NOT_RUN; adaptador completo e
homologação continuam faltando. Totais mantidos: 10 grupos, 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes). Sem build nova.

Continuação 8.3: cleanup do transporte acompanha todas as gerações próprias de
engine e só confirma parada após exit observado/erro de spawn sem PID. Kill,
erro com PID e timeout mantêm incerteza. Auxílio integrado ao engine real;
fixtures de geração anterior e encerramento preparados, não executados.
Adaptador completo deve somar confirmação de relays/recursos próprios antes de
encerrar o diário. Nenhuma verificação de fechamento promovida por esse código.

Lote 8.3/8.4: preparação nativa agora retém consumidores de PGM e exige
liberação vinculada a owner/termo/item/decoder. Backend recusa binário sem esse
contrato, ACK isolado e confirmação espontânea/divergente; incerteza após envio
encerra somente o filho próprio sem replay. Fixtures preparadas, NOT_RUN.
Contrato em HA-PREPARACAO-NATIVA-PGM.md. Adaptador completo, admissão de execução
local, integração operacional e sinais físicos ainda faltam; promoção continua
desabilitada. Totais preservados: 10 grupos; 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). Nenhuma build nova nesta etapa.

Diretriz atual do usuário (10/10): implementar o lote antes da revisão consolidada,
sem repetir testes a cada alteração de status. Alterações atuais de código não
qualificam por si mesmas fechamento, hardware ou novo instalador.

Lote atual, pendências 6.2/9.2: alerta de recuperação gráfica separado de erro
genérico; resolução auditada somente após composição nativa nova no mesmo
canal/execução/revisão/item. Comandos manuais, secundários, emergência,
restauração, cues e expiração capturam o contexto de PGM no envio e confirmação.
O início da ocorrência também faz parte do vínculo, distinguindo novas passagens
do mesmo item no loop.
Mudança antes do envio recusa o efeito; mudança após envio preserva incerteza.
Recibo legado sem contexto não limpa alerta. Colisões de auditoria conservam
histórico e alerta. Cenários adicionados para a revisão posterior; este lote
posterior à R55 ainda não foi testado nem incluído em instalador.

Totais atuais: 10 grupos (1 concluído, 9 abertos); 53 verificações de
fechamento (5 concluídas, 36 em andamento, 12 pendentes). Banco separado (7)
iniciado neste lote; HA entre máquinas (8) ainda exige implementação e homologação.

10.4 — lote de retorno (NOT_RUN): comparação de históricos por ID/colunas,
novos/alterados/ausentes, relatório protegido e integração no pacote. Não
autoriza rollback nem descarta o as-run posterior. Ainda falta conciliar histórico,
produzir/ativar cópia compatível com a versão anterior e qualificar Windows.
Testes/build permanecem para a rodada consolidada; nenhuma verificação encerrada.

Grupo 7, lote sem testes: SQLite operacional delegado a processo Node separado,
via bridge privada e IPC herdado (sem porta SQL na rede). Adapter preserva
Drizzle síncrono, BEGIN/COMMIT/savepoints, resultados tipados e cursores paginados.
Perda de resposta bloqueia conexão; nenhum restart/replay transparente. Build
compilada usa PROCESS por padrão, desenvolvimento INLINE explícito; ausência dos
auxiliares recusa inicialização. DDL, cofre e reserva continuam com os contratos
atuais, sem copiar/migrar bancos de usuário. Backup assíncrono, timeout, diagnóstico
administrativo e painel HOST integrados. Contrato e fixture adicionados em
scripts/verify-storage-process.mts; não executados. Fechamento 7.1–7.4 depende da
revisão conjunta de compatibilidade, concorrência, falhas, dados/cofre e carga
com engine. Não confundir isolamento de processo com serviço multi-host ou HA.
Contrato detalhado em BANCO-OPERACIONAL-SEPARADO.md. Falha do serviço bloqueia
API/WS e novos trabalhos/automação/distribuição/replicação, sem emitir TAKE/STOP
ou considerar confirmado um resultado de gravação desconhecido.

Grupo 8.4, lote sem testes: relays externos agora integram concessão subordinada
de saída na testemunha, presa ao dono/termo do engine, canal e consumidor próprio.
O relay aguarda concessão antes de abrir destino e expira por deadline nativo,
independente do Node/stdio/driver; não renova o engine nem promove reserva.
Troca de engine impede renovação. Source e fixtures adicionados, ainda sem
compilação/testes; servidor, testemunha e relay precisam de build conjunta.
Contrato e limites em HA-CERCA-DE-RETRANSMISSOES.md. Fencing externo/entre máquinas
não homologado; failoverReady/promotionReady continuam falsos. R55 não contém
este lote novo. Nenhuma saída externa ou placa de usuário foi aberta para testar.

Grupo 8.2, lote sem testes: conferência de vínculos locais integrada ao API e
painel HA do reserva. Inventário de entradas/saídas separado por direção;
entradas/protocolos e cada destino/desativação exigem escolha explícita. Planos
cifrados/imutáveis, idempotência UUID e revisão autenticada impedem alteração
cega. Telemetria nova sem mudar edição/configuração não invalida a revisão.
Permissões frescas por canal/sessão; nomes locais preservados. Plano não instala
runtime nem abre entrada/saída. HA-VINCULOS-LOCAIS.md detalha limites; fixtures
preparados, não executados. Mídia/QC, tracks/mixes/trims, sinal e integração à
promoção continuam abertos. R55 não contém este lote e não houve nova build.

Último 10/10: cC7MZ0 PASS nativo após falha injetada de persistência da confirmação.
Efeito no receptor observado, durável SENDING, crash próprio; REVIEWED não restaura
display antigo nem comprova resultado físico. Nova intervenção CONFIRMED define
novo checkpoint; histórico2→3, cursor83→181, execução/revisão e as-run único.
Não é perda de ACK no protocolo (wireAckLossInjected=false). 21 testes afetados/
types/build PASS, server9ED3338E/engine28916DE9. Cleanup próprio confirmado.
R55 efetivamente gerada ANTES do ensaio, instalação sem teste: 535651285 bytes,
SHA256 C4FD7BB7951D20E4FA8AC8B67384285BA04BD16DCF20B4EC30530227CE107538,
D:/RPlayout-builds/RPlayout-1.1-parcial-20261010-r55-instalador.zip.
Faltam wire ACK loss, áudio pós-crash, nativo multilayer/substituição/emergência,
legado sem snapshot, reconciliação de alerta ativo após correção explícita,
demais grupos/hardware/browser/HA/soak/instalação. 6.2/10.1 em andamento.
Evidência scratch/group06-reviewed-uncertainty-native-20261010.json.
Totais 10 grupos1/9;53checks5/26/22. Não repetir lote por atualização de status.

Última prova 10/10: RipsqZ PASS nativo para crash do backend/SRT próprio com
composição secundária vinculada. Vídeo e gráfico voltaram; cursor62 preservado,
mesma execução/revisão, as-run ativo único, uma ocorrência/uma reconciliação,
dois recibos (segundo é reconstrução explícita). Checkpoint vinculado ao recibo
confirmado antes da queda; limpeza própria confirmada, sem matar PIDs históricos.
Server2A9512D5/engine28916DE9 da parcial r54. 60 testes de software/types/build PASS.
R54 gerada antes do ensaio: D:/RPlayout-builds/RPlayout-1.1-parcial-20261010-r54-instalador.zip,
535650454 bytes SHA256 590BCA8ECCBC0DF5D230B4D02CED8B4E252AC8999259DA5A7EDAD4444D0BEE95.
Instalação NÃO testada; README embutido é anterior ao PASS nativo limitado.
Ainda faltam perda de ACK/comando incerto reconhecido sem estado físico conhecido,
crash nativo de multilayer/substituição/emergência, áudio após queda, legado sem
snapshot/revisão operacional e demais grupos/hardware/remote/HA/soak/instalação.
Não confundir REVIEWED com destino restaurado. 6.2/10.1 permanecem em andamento.
Evidência scratch/group06-composition-native-recovery-20261010.json.
Totais: 10 grupos 1/9; 53 checks 5/26/22. Sem repetir testes por mudança de status.

Lote 10/10 r54: composição completa durável integrada ao recibo confirmado e
checkpoint. Camadas/ownership/hold absoluto, substituição manual e emergência
restauráveis sem replay externo. Deixa legada já confirmada não substitui display.
60 testes afetados/types/build PASS, server 2A9512D5/engine 28916DE9. Criar parcial
com EngineBinary novo ANTES do ensaio nativo; instalação sem teste. Ensaio completo
ainda não validado; 6.2/10.1 abertos, totais 10 grupos 1/9; 53 checks 5/26/22.

Último ensaio 10/10: FsekVy FAIL completo, porém cursor e imagem live comprovados
no receptor próprio após crash: salvo 60→recuperado 89, luma superior138.37/
inferior107.32/desvio70.89. Novo engine 28916DE9 soma offset salvo apenas para
live (arquivos mantêm seek, sem duplicar offset); server EFF62925 limpa erro
anterior na confirmação e respeita decoder do TAKE. Dois testes nativos, oito
dirigidos/types/ambas compilações PASS. Falta reconstruir composição gráfica
durável/ownership: secundário EXECUTED não significa display restaurado. Não
replay automático de SCTE/equipamentos. Evidência scratch/group06-live-cursor-engine-20261010.json.
Binários em D:/RPlayout-builds/native-target/release e r54-server-dist; NÃO existe
instalador r54. R53 permanece última parcial e não contém esse engine novo.
Empacotador aceita EngineBinary explícito para a próxima integração, ainda sem
ensaio de pacote com esse override. Totais 10 grupos 1/9; 53 checks 5/26/22.

Último resultado: WMDaeE FAIL, server 97C072BB da parcial r53. Estado PGM voltou
à live e ocorrência secundária vinculada foi reconciliada FIRING→EXECUTED, mas
display secundário não voltou. Cursor observado 0 vs salvo 84; raster capturado
preto (luma 16, desvio 0). Não comprova imagem da live nem preservação de tempo.
Próximo lote: offset de posição live, prova de imagem após crash e composição
gráfica confirmada/ownership durável (MANUAL é pulado pelo scheduler). Não reemitir
efeitos externos nem históricos arbitrários. Evidência scratch/group06-live-recovery-r53-20261010.json.
Parcial r53 gerada ANTES do ensaio, instalação sem teste; 535646717 bytes,
SHA256 319BA026069DF73808FF8918926D12C52603BA30F04FAB34403066FF3B30144B.
6.2/10.1 continuam abertos; 10 grupos 1/9; 53 checks 5/26/22.

10/10 — integração r53: recusa tardia de live após ACK vinculada ao decoder da
tentativa chega ao runtime. Retry limitado mantém contexto/posse/checkpoint;
PVW/decoder antigo/timeout não autorizam reenvio. 25 testes dirigidos/types/build
PASS, server 97C072BB. Recuperação nativa completa e reconstrução seguem abertas:
qm2i5F/JE25xA/VddK8F falharam no PGM antes desta integração. Não repetir o lote
de software por atualização de status. Parcial solicitada sem teste de instalação.
6.2/10.1 em andamento; totais inalterados: 10 grupos 1/9; 53 checks 5/26/22.

Última evidência 10/10: mxilhz PASS nativo com mesmos binários da parcial r52.
Receptor local decodifica estéreo 48k antes/durante/depois da emergência: 49152/
70656/68608 frames por fase, RMS ~0.03531 em ambos os canais, silêncio/seqgap/
timestampgap/SSRCchange zero. PGM/origem/avanço/as-run único preservados e replay
antigo não reativa. Quatro testes do medidor/types PASS; sem rebuild/reempacotamento.
Prova limitada de amostras decodificadas, não latência de reprodução/DAC/hardware/
navegador/soak. Medidor é ferramenta de verificação, não otimização dos scopes.
6.2 ainda aberto: crash/ACK nativo completo, reconstrução e legado sem vínculo.
Totais 10 grupos 1/9; 53 verificações 5/26/22. Evidência
scratch/group06-native-emergency-audio-20261010.json. Histórico abaixo.

ENTREGA MAIS RECENTE: parcial r52 GERADA no D:/RPlayout-builds, 449805495 bytes,
SHA256 8387ADFE0A8B2154CEA5732F9DB77A7CE5DDEB8D6379EC79299FAB511E26BEEF.
Inclui servidor EEAFE7B6 e auxiliar ACL corrigido F2EA9F86. Instalação NÃO testada.
OcTLPd PASS nativo: SRT próprio em PGM, emergência opaca confirmada, RESET
restaura raster real preservando origem/avanço e um as-run; replay após RESET
não reativa. Áudio contínuo, hardware, UI remota e crash completo não validados.
Quatro testes nativos ACL PASS e probe real em diretório Modify do D: protegido
só usuário/SYSTEM sem trocar dono já correto; sem permissões recursivas alteradas.
6.2/10.1 continuam em andamento; legado/crashACK/failover/soak/upgrade pendentes.
10 grupos 1/9; 53 checks 5/26/22. Evidências scratch/group06-native-emergency-program-20261010.json
e scratch/build-r52-partial-20261010.json. Notas abaixo históricas.

Último lote 10/10: recibos gráficos secundários novos vinculam FIRING/ocorrência
exata; admissão recupera EXECUTED somente com terminal CONFIRMED/SIMULATED
vinculado, sem despacho, com auditoria transacional. Falha de gravação após efeito
preserva FIRING, não vira recusa fictícia. 53 testes distintos/types/build PASS
(coincidência com 53 marcos, não fechamento desses marcos). Processo próprio
mdcUFz morreu/reabriu: SIMULATED recuperado sem reenvio; UNCERTAIN não recuperado
nem após REVIEWED. Não houve engine/sinal físico/crash completo do backend.
Legado sem vínculo permanece protegido, revisão/liberação ainda pendente.
Servidor novo EEAFE7B6 em D:/RPlayout-builds/r52-server-dist; sem r52 instalador.
Último instalador real r51 não inclui esse lote. 6.2 aberto; 10 grupos 1/9,
53 verificações 5/26/22. Evidência scratch/group06-secondary-bound-reconciliation-20261010.json.

ENTREGA PARCIAL 10/10: r51 GERADA em
D:/RPlayout-builds/RPlayout-1.1-parcial-20261010-r51-instalador.zip,
449803457 bytes, SHA256 6C0762FFF8B1C0ABF577A171C4E6C6326620B9B5D53D5E971857B48AD62AB273.
Servidor recompilado no D: A1CFB1E1; dist no workspace continua 720B8BFC antigo.
Inclui proteção global de comandos gráficos perante FIRING secundário fora do
trabalho ativo na mesma conexão, com nova checagem antes de envio. 47 testes do
lote/types/build PASS. Não implementa liberação auditada dos órfãos antigos.
Arquivo/edição/hash conferidos, SEM instalação/testes funcionais da build parcial.
Runtimes incluídos da base r30; drivers/hardware/remote/soak não homologados.
Nenhum pacote/evidência apagado. 10.1 permanece em andamento, não encerrado.
Totais mantidos 10 grupos 1/9; 53 checks 5/26/22. Evidências:
scratch/group06-secondary-uncertainty-fence-20261010.json e
scratch/build-r51-partial-20261010.json. Entradas abaixo históricas.

Último corte 10/10, backend 720B8BFC: admissão do canal persiste alerta CRITICAL
por evento secundário FIRING, antes de abrir engine. Transacional, por canal,
sem duplicar alerta/apagar reconhecimento; não muda resultado nem reenvia.
Não comprova morte do predecessor ou recuperação física. 33 testes distintos,
types/build PASS; inclui isolamento de ocorrência/template dos dois lotes anteriores.
Sem ensaio nativo deste hash. Ainda falta resolução/controle global dos órfãos e
recuperação completa. 6.2 permanece em andamento; 10 grupos 1/9, 53 checks 5/26/22.
R51 não gerada; r50 é último instalador. Disco 7675904 bytes; ZIP exige 620000000.
Evidência scratch/group06-secondary-unconfirmed-admission-20261010.json.

Lote runtime secundário 10/10: cálculo de hold, pré-requisito de DISMISS e resposta
manual consultam FIRE do canal/execução/item/revisão exata. Template explicitamente
selecionado e ausente falha sem envio/fallback genérico; ID vazio legado permanece.
34 testes do lote PASS. Fonte posterior ao compilado A6EB6CDD; sem prova nativa
desta mudança. 6.2 continua aberto, órfãos e recuperação completa pendentes.
R51 não gerada por disco; contagem mantida 10 grupos 1/9, 53 checks 5/26/22.
Evidência scratch/group06-secondary-runtime-context-20261010.json.

Último lote 10/10: recuperação gráfica secundária exige confirmação do mesmo
canal, execução, item e revisão exata; revisão NULL não é coringa. 13 testes do
lote e types servidor PASS. Código posterior ao backend compilado A6EB6CDD;
sem build/prova nativa desta mudança. Recuperação completa e órfãos ainda abertos.
6.2 em andamento. R51 não gerada; último instalador real r50. Disco observado
15417344 bytes, ZIP exige 620000000. Nenhuma exclusão material.
Totais inalterados: 10 grupos 1/9; 53 verificações 5/26/22.
Evidência scratch/group06-secondary-restore-context-20261010.json.

Último resultado 10/10: receptor do verificador com dois buffers fixos, sem raw
crescente. 3 testes e types PASS. Ensaio nativo 2ACuQn PASS no servidor A6EB6CDD:
apresentação idle entrou/saiu (pixels 16→125.5→16), dois comandos confirmados,
85 quadros decodificados, 115200 bytes de buffers; evidência total 2687034 bytes.
Fixture agora ativa explicitamente a grade no runtime. Não houve TAKE/as-run.
Isso valida idle local, não mídia PGM, hardware, UI remota ou recuperação completa.
Captura limitada é ferramenta de ensaio, não correção do preview/scopes do produto.
6.2 continua aberto. R51 não gerada: 11309056 bytes livres, 620000000 necessários.
Nenhuma release/evidência apagada. 10 grupos: 1 fechado/9 abertos; 53 verificações:
5 concluídas/26 em andamento/22 pendentes. Evidência:
scratch/group06-bounded-native-idle-20261010.json. Cortes seguintes históricos.

Último corte10/10/serverA6EB6CDD: janela do grafismo pertence à ocorrênciaPGM,
não ao reinício. Duração restante calculada na fila; manual usa quadro de FIRE
persistido, relativa ao fim usa duração montada. SHOW após fim recusado; DISMISS
exige FIRE EXECUTED. Propriedade de camada por evento/versão preserva substituição
manual, sem impedir retirada da própria camada quando só outra foi alterada.
53 testes distintos do lote PASS (não os53 marcos de fechamento); types/build
servidorPASS. Sem prova nativa/crash real neste hash. Órfãos antigos e restauração
completa ainda abertos. Espaço segue insuficiente para fixture/ZIP, nenhum
arquivo removido.6.2 aberto;53checks5/26/22;10grupos1/9.
Evidência scratch/group06-secondary-graphic-window-20261010.json.

Último corte10/10/serverA1C1BF37: migração49 cria projeção durável/indexada de
comandos gráficos pendentes e índice do histórico; aceitação/terminal atualizam
projeção na mesma transação. UNCERTAIN não libera. Histórico gráfico append-only,
proteção de projeção contra remoção sem terminal; outras decisões editáveis.
Admissão e validação de backup recusam schema/projeção divergentes; legado sem49
permanece legível e migração reconstrói pendências sem alterar histórico.
35 casos distintos PASS/types/build servidorPASS. Caso5000 comandos/10000 fases
em memória: protótipo134997ms, intermediário72325ms, final2468ms. São tempos do
caso local, não garantia de desempenho/soak. Busca pendente usa índice por escopo.
Dois ajustes de fixture: ordem de consulta não garantida e backup agora com
schema completo do aplicativo. Teste real de backup alterado recusou pendência
ausente mantendo UNCERTAIN no banco ativo; rollback de migração coberto.
Sem ensaio nativo/upgrade/rollback instalado do schema49; falta disco cheio real,
carga histórica prolongada, idle corrigido/crashACK/restore/failover/remoto/físico.
6.2/9.2/10.1 seguem abertos;53checks5/26/22;10grupos1/9. R51 não gerada;
36163584livres<100000000ensaio/<620000000pacote. Nenhum arquivo removido.
Evidência scratch/group06-graphic-pending-projection-20261010.json.

Último corte10/10/serverED740649: apresentação idle SHOW/retirada usa ledger
durável/ACK, guarda de configuração/PGM/composição/emergência e bloqueio por
comando incerto. Propriedade por camada: retirada não apaga marca manual em
outra camada; substituição manual da própria camada não é removida. Mudança de
configuração não chama hide legado.81 testes distintos/types/build servidor PASS.
VLZ1b0/99BD0225 FAIL: ensaio não ativou grade no runtime; consultar editorial
não carrega templates. Verificador corrigido para load-rundown explícito.
NÃO reexecutado:38744064bytes livres<100000000mínimo seguro; guarda statfs
adicionada antes de criar fixture/serviços, sem apagar evidências/pacotes.
ED740649 não tem prova nativa nova. Edp5eQ pertence a5F6C6417 anterior.
6.2 aberto para ensaio idle corrigido, mídiaPGM/emergência/crashACK/restore/
failover/UIremota/físicos/soak.53checks5/26/22;10grupos1/9. R51 não gerada.
Evidência scratch/group06-idle-graphic-command-20261010.json.

Último corte10/10/server5F6C6417/webCkuhX6pK: emergência SHOW/RESET usa ledger
durável, seleção congelada, ACK e chave de pedido; autorização/canal/sessão
reconferidos na fila. Template opaco mesmo em grupo SVG; RESET confirmado
limpa camadas. Pedido manual tem callback próprio, não herda confirmação de
automação pendente. Auto-slate reconfirma política armada antes do envio.
51 testes distintos/types servidor+web/build PASS. Edp5eQ/5F6C6417 PASS engine/
receptor próprios SRT320x180 pixels16→125.5→16; SHOW/RESET CONFIRMED, replay
enquanto ativo sem reenvio; asrun0/semTAKE/owncleanup. Replay após RESET é unit,
não ensaio nativo. Apresentação automática idle desabilitada no clear isolado.
dHbMNZ FAIL baseline já com apresentação;6Qe0C9 FAIL expectativa de preto após
RESET, que deixou apresentação automática retornar; cenários preservados.
Faltam PGM com mídia durante emergência, crash/perdaACK/restauração, apresentação
idle legada, failover físico/UIremota/soak.6.2 aberto;53checks5/26/22;10grupos1/9.
R51 não gerada por espaço; nenhuma release removida.
Evidência scratch/group06-emergency-graphic-command-20261010.json.

Último corte10/10/server29F82620: prazo interno de camadas usa data absoluta,
atravessa meia-noite e novo hold começa após ACK; camadas existentes não ganham
tempo ao compor outra. Eventos secundários gráficos passam pelo mesmo ledger
manual/legado/expiração; timeout mantém FIRING secundário+UNCERTAIN compartilhado.
Resultado incerto adia automáticos sem consumir deixa, conferência explícita
libera avaliação; evento/deixa simultâneos executam em ciclos separados.
60 testes distintos do lote PASS (replays não somados), types/build PASS.
g536mG/29F82620 PASS engine/receptor SRT próprios320x180 pixels16→125.5→16,
expiração75frames CONFIRMED e replaySHOW sem reenvio/asrun0/semTAKE/owncleanup.
Meia-noite/ACK lento e conflitos são testes locais, não soak físico.
Faltam emergência/failover, crashACK completo, restauração gráfica com ledger
unificado e registros antigos sem recibo, relógio/carga/soak/UIremota/hardware.
6.2 aberto;53checks5/26/22;10grupos1/9. R51 não gerada212254720<620000000.
Evidência scratch/group06-graphic-timing-coordination-20261010.json.

Último corte 10/10 — server11051AB5: deixas legadas itemGraphics e expiração
automática agora passam pelo ledger durável e composição confirmada. Uma deixa
por ciclo; item/execução/revisão/startedAt e emergência reconferidos na fila.
Expiração vincula a composição capturada, não retira uma substituição nova.
Falhas ficam visíveis, sem reenvio automático. 50 testes distintos do lote,
types servidor/build PASS. QUKi06/11051AB5 PASS: engine real/receptor próprio
SRT320x180 mediu16→125.5→16; retirada por75frames sem HIDE manual gerou recibo
AUTOMATIC CONFIRMED. Repetir SHOW antigo não recolocou tarja; asrun0/semTAKE,
owncleanup. Não homologou NDI/OMT/DeckLink, destino externo ou navegador.
Faltam ciclo emergência/failover, servidor inteiro com crash/perda de ACK,
UI remota e operação prolongada.6.2 aberto;53checks5/26/22;10grupos1/9.
R51 não gerada por espaço230154240<620000000; não apagar sem autorização.
Evidência scratch/group06-automatic-graphic-commands-20261010.json.

Último corte 10/10 — server3CF8E838: eventos secundários GRAPHICS_OVERLAY
SHOW/DISMISS agora usam composição staged e ACK nativo; execução/item/revisão,
runtime aberto e exclusão de emergência reconferidos dentro da fila. FIRING
durável vira EXECUTED somente após ACK; timeout após envio conserva FIRING
incerto/alarme, sem reenvio. Recusa nativa e bloqueio pré-envio ficam FAILED.
45 testes do lote afetado/types servidor/build PASS. Não houve ensaio nativo
deste corte; Dujmi5 continua atribuído ao server61F1EF53 anterior.
Deixas antigas itemGraphics, expiração tick e ciclo completo de emergência
ainda não migrados. UI remota/hardware/ACK perdido em crash seguem abertos.
6.2 segue em andamento.53 verificações5/26/22;10grupos1/9. R51 não gerada.
Evidência scratch/group06-secondary-graphic-confirmation-20261010.json.

Atualização 10/10 — 6.2, recibos de grafismo: server61F1EF53 e webBbw4Fk4J.
Ensaio adicional cq3Lsz PASS: queda real/reabertura de processos isolados do
ledger em ACCEPTED/SENDING/CONFIRMED. Dono vivo impede revisão; depois da
parada comprovada, revisão explícita não reenvia o pedido antigo; novo pedido
é permitido. CONFIRMED sobrevive e repetição não executa trabalho. Cinco
verificações do ensaio; não somar aos53 marcos. Não envia comando nativo nem
prova queda do servidor completo/ACK perdido/UI/hardware.6.2 segue aberto.
ACCEPTED/SENDING persistidos antes do envio; confirmação durável após ACK,
seleção criptografada e chave repetida não reenviam SHOW/HIDE. Falha após envio
fica UNCERTAIN e bloqueia novos pedidos; revisão explícita exige permissão,
versão atual e dono comprovadamente encerrado quando necessário. A revisão
não reenvia, não resolve alarme e não declara recuperação física.
Painel consulta histórico e oferece conferência sem reenvio. 28 testes distintos
PASS, build PASS. Dujmi5/61F1EF53 PASS: receptor SRT próprio320x180 mediu
preto16→tarja125.5→preto16; repetir SHOW antigo após HIDE não recolocou tarja;
dois recibos, nenhum TAKE/asrun0, limpeza dos processos próprios confirmada.
Faltam crash/restart do servidor completo com ACK perdido, falha/timeout nativo, UI remota,
grafismos automáticos legados, ciclo completo de emergência/failover e físicos.
6.2 permanece em andamento; totais mantidos:10 grupos1 concluído/9 abertos;
53 verificações5 concluídas/26 em andamento/22 pendentes.
R51 não gerada; último espaço observado249614336bytes<620000000.
R50 não inclui essas mudanças. Evidência scratch/group06-graphic-command-ledger-20261010.json.
As notas abaixo são históricas e não descrevem o corte atual.

Lote6.2 integrado/serverFINAL6AAC56FE: SHOW/HIDE/layer manual aguarda ACK
nativo antes de publicar estado, sem envio duplicado; fila sequencial e
autoridade/canal reconferidos antes do envio. Slate ativo/pendente bloqueia
substituição; timers/deixas adiam durante confirmação. Canal explícito e
template existente/do mesmo canal; simulação identificada. Viewport template
SD/720p/UHD preservado em composição canônica; HIDE limpa identidade da camada.
81 casos distintos PASS (replays não somados), types/buildfinal PASS.
njD66w/A1F0D07D FAIL: ACK sem tarja de tamanho esperado, template640x360
pequeno em viewport1920x1080. Correção aplicada, lBCRTV/76941915 PASS pixels
SRTreceiver320x180 preto16→tarja125.5→preto16, SHOW/HIDE ACK, asrun0/PGM sem
TAKE/owncleanup. Endurecimento de atributo/selfclosing e identidade veio
depois: unit PASS/final6AAC56FE; não reatribuir pixelproof ao hashfinal.
6.2 agora em andamento. Faltam recibo durável/estado incerto, falha/timeout/
restart, eventos automáticos legados, ciclo completo de emergência/failover
e UI/remota/físicos. R51 sem ZIP por espaço, R50 não inclui alterações atuais.
53checks5 concluídas/26 em andamento/22 pendentes;10grupos1/9. Evidência
scratch/group06-graphic-confirmation-20261010.json.

Lote6.3 pós-filaR51 integrado/server9C4ECF4F: datas/fusos de sessão avaliados
como tempo absoluto, datas inválidas negam acesso; read não grava. Expiração
independente da retenção de health, startup/60s/lote100, SESSION_EXPIRED
atômico com exclusão, sem token/digest na auditoria. Falha audit reverte lote.
Login80/1024 limitado e scrypt com formato fixo.41 testes distintos/types/build
PASS; krMonQ/9C4ECF4F PASS HTTP401, WS4401 após expiry controlada noDB próprio,
rollback audit, limpeza no restart uma vez, limites login e owncleanup.
Não foi12h de espera, UI real, estação remota ou upgrade.6.3 passa de pendente
a em andamento:53checks5 concluídas/25 em andamento/23 pendentes;10grupos1/9.
R51 ainda não empacotada,345571328byteslivres<620000000. Último instaladorR50
não inclui código de fila nem segurançaR51. Não apagar sem autorização.
Evidência scratch/group06-session-expiry-20261010.json; próximo homologação
visual/remota6.3, demais grupos e journaldurável/carga9, sem repetição por status.

R51 CÓDIGO INTEGRADO/server77A1FE1C, engineAEBDED62/web preservados.
Reserva assinada inicia observationClosed=false; shutdown para callbacks,
esvazia fila e só então sela. Falha de gravação/quarentena não sela; liberação
de processo sozinha também não. Admissão registra CRITICAL/audit/outbox
deduplicados se predecessor não selou. Sem inventar amostras/contexto perdido.
50 testes do lote fila+posse PASS/types/build servidor PASS.
dwhgy4/77A1FE1C PASS: fault SQLite em callback nativo, crash real do servidor
próprio, família nativa saiu, reinício registrou aviso uma vez/loopback1;
parada limpa e terceira execução sem novo gap. Asrun0. Não prova full-disk
físico, preservação exata da fila volátil ou inputs/destinos físicos.
R51ZIP NÃO GERADO:345608192bytes livres, mínimo620000000. Sem arquivo parcial
e sem apagar releases. Último instalador éR50, NÃO contém código novoR51.
9.2/10.1 seguem em andamento. Totais10grupos1/9;53checks5/24/24.
Evidência scratch/group09-observation-closure-crash-20261010.json.
Próximo: liberar espaço com autorização, gerarR51 sem instalação; avançar
journal durável/armazenamento real/carga e demais homologações, sem repetir
testes para mudanças de status/documentação.

R50 gerada:450449852bytes SHA256
A2CF183FC49CB721159140EA71EBC3E70C158E49A5084FEC460C6245F060BB80,
release/RPlayout-1.1-parcial-20261010-r50-instalador.zip. Server4C56E221,
engineAEBDED62; web preservada. Primeiro ensaio46sn2P/engine8390A48C FAIL:
receiver decodificou vídeo mas queda não persistiu em45s. Plugin local
srtsink auto-reconnect=true ocultava falha. Correção: publisher controla retry,
desativa reconexão interna quando propriedade existe. Teste pipeline PASS.
NBUFrt/engineAEBDED62 PASS: output SRT→receiver próprio→H264decode320x180;
queda real retrying/geração6 e retorno onAir/geração7 com novas entregas,
incidente/resolução persistidos, contexto e ACK original preservados, PGM
nunca TAKE/asrun0 e owncleanup confirmado. Carrier preto com PGM parado;
não prova conteúdo editorial, qualidade de áudio ou destino externo.
17 testes dirigidos distintos PASS, types/builds PASS. Instalação não testada;
LEIA-ME interno precede PASS final. Evidência externa:
scratch/group09-publisher-loss-return-20261010.json.9.2 em andamento.
Próximo lote: storage/crash antes do commit e carga/perf, depois qualificações
físicas/remotas/prolongadas.10grupos1/9;53checks5/24/24 preservados.

R49 gerada:450445752bytes SHA256
40F9D82D73CB6B2CB0FBDCF1AE92D87BD2A9884A102EA2DDA7EB0C07C32A2841,
release/RPlayout-1.1-parcial-20261010-r49-instalador.zip. Server4C56E221,
engine8390A48C; interface preservada. Incidente OUTPUT vinculado ao destino
além do perfil; mudança de URL encerra observação, não resolve destino antigo.
Geração nativa do contador permite novas entregas após recriar publisher,
rejeita geração velha/ausente e geração nova com zero entrega. Saída nativa
notifica sem fonte live; runtime fechado não persiste após liberar posse.
14 testes do ciclo +1 transporte +1 nativo PASS; tipos servidor/builds PASS.
Ensaio dirigido de receiver SRT próprio em andamento; não antecipar PASS.
Instalação não testada, pacote parcial emitido imediatamente após integração.
Totais preservados:10grupos1 concluído/9 abertos;53checks5/24/24.9.2 aberto.

R48:450447001bytes SHA256
719F3913B42533E7B2D183A01027C2A0880DE8E86CF894AAED21F9536B80C8AC,
release/RPlayout-1.1-parcial-20261010-r48-instalador.zip. ServerB868E6E8,
web/engine preservados. Captura não descarta telemetria quando leitura de nomes
no banco falha; nomes N/D, identidade/sinal preservados. Teste dirigido do
collector e types/build PASS; não repetida matriz anterior por status.
Ensaio final s0kvze/B868E6E8 PASS: SRT ingest→MediaMTX→RTSP decoder→SRT PVW→
RTSP receiver; imagem428x240 antes/depois, emissor antigo encerrado e novoID
comprovado, perda registrada, re-CUE explícito, vídeo+áudio novos confirmam
resolução do incidente original com contexto/ACK preservados; asrun0/PGM nunca
selecionado, owncleanup confirmado. Não prova reconexão automática, NDI/OMT/
DeckLink, browser, hardware, estação remota ou soak. Instalação não testada.
Tentativas anteriores falharam no verificador: u6Rcxy comparava guest com
endpoint resolvido; wO8DFF não distinguia emissor anterior/novo; bmabeU abria
PVW antes de publicação pronta. Preservadas; somente s0kvze prova ciclo completo.
Próximo9: testar perdas de publisher/destino e perfil de source sob carga,
falha de storage/crash antes de commit e alertas correlacionados. Seguem
homologações físicas/remotas/prolongadas. Totais53:5/24/24;10grupos1/9.

R47 agora gerada após aprovação restabelecida:450446977bytes SHA256
189E45ACF4C975DD4B6B65407EAE466FF67D2FB6FF67FD2CD66CAA767F78C473,
release/RPlayout-1.1-parcial-20261010-r47-instalador.zip. Server51CE5E4C,
webDeUoJJaB/1C3CC58C, engine preservado. Instalação não testada; último corte
inclui invalidação LOST/FAILED e ausência de CRITICAL duplicado.
EnsaioAgZKD4/51CE5E4C PASS LIMITADO: CUEING e recusa nativa registrados com
contexto e sem endpoint privado no histórico; fonte não foi conectada porque
o log comprova "este canal não tem barramento de preview". CUE500/asrun0,
servidor/engine próprios encerrados. Não chamar de teste da conexão SRT nem
falha/retorno de entrada real. Flags antigas do result.json são refinadas pela
inspeção do log; script futuro explicita previewBusConfigured=false.
Bloqueio do serviço de aprovação resolvido, não é pendência atual. Falta
configurar PVW no ensaio isolado para testar conexão/perda/retorno reais;
depois carga/armazenamento/crash, operação remota/prolongada e hardware.
Totais10grupos1/9 e53checks5/24/24 inalterados.

Checkpoint10/10 apósR45: captura nativa síncrona+fila ordenada512+lacuna explícita
após overflow; snapshots em memória enquanto banco não confirma. Informativos
voltaram com dedup SQLite e signalRecovered=false; callbacks rejeitam item
descartado. Rótulos do painel corrigidos. LOST/FAILED invalidam medição anterior:
sourceReady precisa nova telemetria para SIGNAL_OK. Informativo não duplica
CRITICAL. 17 testes afetados distintos PASS em lotes; tipos finais PASS.
Server final51CE5E4C, webDeUoJJaB/1C3CC58C, engine preservado.
R46ZIP450446844bytes SHA256
925DCB83FCA958FA78F3D3BCB5B919B8E67745A1391A17D5CB60616F8B12DE75,
preservada mas sem as duas últimas correções. ProvaApjCqe/AF0CE539 cobre
somente admissão anterior com históricos sintéticos, auditorias2/loopback2/
asrun0; não é prova do server final nem nova prova CUE.
R47 NÃO gerada: aprovação de execução atingiu limite de uso; ensaio final
--native-cue-failure preparado, NÃO executado. Não repetir sem aprovação para
contornar o mecanismo. Retomar ensaio e pacote após aprovação disponível.
Faltam prova compilada CUE indisponível, pacote final, perf/armazenamento
degradado/crash antes de commit e homologação física/remota/prolongada.
Totais53:5/24/24;10grupos1/9 preservados. Evidência
scratch/group09-native-observation-queue-20261010.json.

R45 (10/10/2026): lote9.2 implementa falhas de fontes PGM/PVW e publishers,
recuperação medida, fim de observação, contexto cifrado/HMAC, fila/auditoria
atômicas, retenção e risco histórico com fontes/saídas. Retry conserva snapshot
original, mesmo após mudança do item. READY/ACK/cadastro não resolve; saída
exige entrega acima do baseline. Reconciliação a cada1s, sem TAKE automático.
32 testes afetados distintos PASS (9 novos,3 retenção,12 paginação,6 rotas,
2 marcação); tipos/build servidor PASS, web compilada. Ensaio final66rmAb /
server62573A62: duas instâncias próprias sucessivas e respectivos engines
encerrados, incidentes históricos sintéticos PGM/OUTPUT terminam observação
sem resolver, contexto/ACK preservados, duas auditorias/entregas loopback,
as-run0/saída nula. Não homologa falha física, instalação ou operação prolongada.
ZIP release/RPlayout-1.1-parcial-20261010-r45-instalador.zip,450445614bytes,
SHA2567D95169C1A90CD6245246C5243B3D37DFEB8B2AD9285BB51F945B54E5675C9D5.
R44 preservada como corte anterior (sem recorder de retry),450445136bytes,
SHA25645DB55B886387E5FD1630C0DDDB2074F7A6221D8F49CE86A6A80439D894077EE;
provaTc9rWE atribuída ao serverAF16FCEA, não ao final62573A62.
Próximo9.2: capturar transições subsegundo por eventos nativos; revisar aliases
informativos além dos incidentes correlacionados e rótulos auxiliares do painel
(heading atualizado; aria/descritivo ainda menciona PGM); validar fonte/saída
real e configuração/troca de destino. Físico/remoto/prolongado permanecem abertos.
Totais53:5 concluídas/24 em andamento/24 pendentes;10 grupos1 concluído/9 abertos.

Lote posterior à r41 (10/10/2026): admissão nativa com lease assinado encerra
observações PGM antigas sem resolver ou reconhecer incidentes. Contexto
original preservado; evento/fim/auditoria/outbox atômicos e idempotentes.
Outro canal, posse encerrada e quarentena não alteram histórico. Consulta
antecipada com sonda vazia não bloqueia a reconciliação; alertas atuais e
transições pendentes da sonda atual são protegidos. Seis novos testes locais
PASS e sete testes afetados da ponte PGM PASS. Não contam como homologação
de reinício físico. R42 preservada (primeiro corte, sem proteção específica
de consulta antecipada); R43 é o corte atualizado. Instalação não testada.
Ensaio compilado YCy82r PASS: dois servidores/engines sucessivos encerrados,
predecessor assinado vinculado; falha histórica sintética com contexto/ACK
preservados, sem recuperação inventada, uma auditoria/entrega loopback, as-run0.
R43:450443105bytes SHA256
9F96AC6D2E1F133FDAB39718E9B3C94799732D17F50FA2411D65D946CB8F0A7A;
serverDF413F3A, engine/interface preservados, instalação não testada.
Próximo9.2: persistência e
reconciliação de falhas fontes/publishers, homologação física/remota/prolongada.
Totais inalterados:53 verificações 5 concluídas/24 em andamento/24 pendentes;
10 grupos 1 concluído/9 abertos.

R41 concluída: release/RPlayout-1.1-parcial-20261010-r41-instalador.zip,
450442256 bytes; SHA256A046D95C7A4DB5827F4C55EB1352D21873EE013B70F5626E04735EF8D32AD548.
Server83CD413C/webCE4F4AF4/engine1195A55A preservado. Semtesteinstalação.
Browser2iQ4an PASS contexto details/riscohistórico, 253eventos janela fixa após
inserção nova e voltaàprimeira,254 sóMAISRECENTES. HANG mostra deadline10s,
filtro cancelaespera→INFOcarregado/aviso some;31READs max1ativa/4abortadas,
27concluídas/0ativasapósclose. Clique manual indisponível pois poll já carregava;
inspeçãofresh confirmou erro, semretrycego. Engineoff/asrun0/ownserverexit.
50testsdistintos/tipos/builds PASS; prova nativeproducer09d78b13 atribuída
separadamente do DTOguard/final83CD413C. Evidência
scratch/group09-incident-context-polling-20261010.json e 2PNGs.
Próximo9.2: fechamento de observação após reinício do servidor sem inventar
recuperação e persistência de falhas fontes/publishers além da sondaPGM;
homologação física/remota/prolongada segueaberta. Totais53:5/24/24;10grupos1/9.

10/10 —9.2 lote de contexto/consultas: âncora mantida ao voltar àprimeira
página atéMAISRECENTES; leitura agregada10s com cancelamento de substituída
e pollingsemoverlap. Só READ recebe abort, não mutações. Contexto imutável
capturado pela sonda na transição, antes de retry/troca de item, com nomes
seguros/IDs protegidos de fontes e perfis; coleta sem discovery/CUE/engineopen.
Migração48 contexto cifrado nullable+índices, backup valida48/canal e aceita
pre48readonly; risco histórico inclui reconhecidos semresolver e separa fim
da observação/contexto ausente. DTO recusa contexto de outro canal/fora schema.
41servertests+9webtests distintos PASS (reparos dirigidos semreplaypgm14),
tipos/buildambos PASS. Cofre inicial falhou preparando UPDATEcontext antes48:
skipfieldsemvalores corrigido; teste de backup real47/48 preservaorigem e
recusa cópia adulterada. NativecompiledZWq3uF/server09d78b13 PASS contexto
naAPI/fila/migração48, saída nula, engine1195A55A intacto. DTOguard posterior
testedirigido PASS+serverrebuild; browser novo ainda em andamento.
R41 em geração semtesteinstalação, engine semrebuild. Não físico/remoto/soak.
Totais10grupos1/9;53checks5/24/24;objetivo integral não atingido.

R40 concluída: release/RPlayout-1.1-parcial-20261010-r40-instalador.zip,
450393956 bytes; SHA2568095768CB029E8D486DD9A4CD618C61AD57005BD0E1D55AEEEF64F60E25F06FA.
ServerC4B76A9E/webB88DCBE6, engine1195A55A preservado. Semtesteinstalação.
Próximos pontos9.2: preservar âncora ao voltar àprimeira página (r40 retorna
janela atual), cancelamento/deadline/nooverlap de consultas da distribuição,
correlação incidente/item/edição/execução/fonte/saída e risco operacional.
Essas lacunas permanecem no mesmo marco9.2; totais inalterados, não fechado.

10/10 —9.2 histórico de incidentes paginado: API aplica severidade/ACK/ACL
antes de limitar, keyset por horário+ID, janela fixa e contagem SQL de pendentes
do canal inteiro. UI mais recentes primeiro,30/página, anterior/maisrecentes,
filtros reais, loading/N-D e aviso de dados anteriores em erro. Corrige slice30
que ocultava eventos e limite200 sem navegação. CSV declara teto10000 recentes.
18testesserver+2markup PASS; tipos/build ambos PASS após nullguard dirigido.
Primeiro comando server não encontrou testes por root incorreta; rodou raiz
com arquivos exatos, não considerar tentativa um teste aprovado.
Compiledbrowser iyd3WO PASS9páginas/253eventos/245históricos únicos, filtro
CRITICAL+PENDING encontra evento antigo além200; ACK200 remove do filtro,
reaparece reconhecido semrecuperação. Outro canal ausente. Engineoff/asrun0;
sem físicas/remotas/soak. WebC0-GhWvg, r40 em geração semtesteinstalação.
Evidência group09-health-pagination-20261010.json e PNG/browser-pages JSON.
Totais10grupos1/9;53verificações5/24/24;9.2 não encerrado.

R39 concluída: release/RPlayout-1.1-parcial-20261010-r39-instalador.zip,
450391895 bytes, SHA256184BFB3F304A792BBF3A5CFE1623B1A22C1320E6BD35C5C139EAD752AE8A64F2.
Inclui acesso direto/aviso persistente9.2, semtesteinstalação. R38 preservada.

10/10 —9.2 visual local aprovado: acesso INCIDENTES DO CANAL direto no Monitor;
ACK200/auditoria única sem resolução; falha409 sem ACK mantém botão disponível
e aviso persistente após atualização automática. Recuperação medida e observação
encerrada aparecem separadas; outro canal ausente da lista A. Fixture0zjCDd,
engine desabilitado/as-run0/ownserverexit. Dois testes de interface, tipos/build
web PASS (index-CwJTwjet). Evidência group09-health-browser-20261010.json e PNG.
Revisão visual encontrou e corrigiu apagamento do erro por polling; não repetiu
provas nativas/API aprovadas. R38 NÃO contém esta correção; r39 em geração.
9.2 permanece em andamento, não homologação física/remota/prolongada.
Totais:10grupos1concluído/9abertos;53verificações5concluídas/24andamento/24pendentes.

R38 empacotamento concluído: release/RPlayout-1.1-parcial-20261010-r38-instalador.zip,
450391431 bytes, engine/servidor atuais e migração47. Sem teste de instalação.
Não fecha marco físico/remoto ou operacional; r37 e anteriores preservados.

10/10 — precisão9.2: engine envia freezeDurationMs e sampleAgeMs (aditivos),
mantendo freeze bool legado2s. Sonda aplica limite sobre duração nativa sem
debounce duplo; amostra repetida não acumula outra espera. Frame sem leitura
recente/null/>1500ms rejeitado mesmo com evento novo. STILL recebe duração0
para não disparar freeze intencional.16testesafetados/2files PASS, tipos/build
servidor PASS, engine release PASS. Nativecompiled QkkTMZ PASS limite600ms→
627ms medidos;7deliveries/8HTTPloopback/503sameID, recuperação semACK e47API,
ownserver/engineexit. WKv8kc FAIL cenário quasepreto ball gerou alarmeblack extra;
controle saudável agoraSMPTE com ruído animado, detector preservado. Evidência
group09-native-freeze-duration-20261010.json. Sem físico/browser/allprofiles/soak.
R38 parcial em empacotamento semtesteinstalação, inclui engine1195A55A,
serverEFE3D1BA e web anterior yahayJa_. Totais53:5/24/24;10grupos1/9.

10/10 —9.2 resolução/retention: migração47 health_events.resolved_at e
observation_ended_at, sem converter ACK em recuperação. Backfill apenas evento
PGM de identidade correspondente. Persistência atômica atualiza incidente
original e fila; fim da observação não resolve. Retenção preserva incidente
PGM não resolvido, inclusive reconhecido/semobservação; resolução e ACK recentes
também preservados. CSV/UI separam os estados. Backup valida47 readonly e
rejeita resolução corrompida.28 distintos/4files PASS (27lote+1backup real,
replay2retention afetados); tipos/build ambos PASS. Nativecompiled8gzf19/
600BA09D PASS:3originais recuperados semACK, camposAPI/migração47,7deliveries/
8HTTPloopback/503mesmoID, ownserver/engineexit. Cópia SQLite real preservou
resolution e inválida foi recusada sem alterar origem. UI não homologada;
não físico/retention prolongada. Evidência group09-health-resolution-retention-
20261010.json. R37 NÃO contém47 nem estes fluxos; usar pasta nova/backup, não
considerar retorno a pacote antigo uma estratégia de rollback homologada.
Totais10grupos1/9;53checks5concluídas/24em andamento/24pendentes.

10/10 — continuação9.2: sonda configurável agora registra black/freeze/silence
e recuperações em health_events com identidade estável; incidente e outbox
commitam juntos. Falha conserva transição para retry. idle/métrica ausente não
certificam recuperação; fim da observação é *_unobserved. Telemetria PGM sem
evento recente expira em1500ms, sem usar medição do navegador; simulado retorna
null. Removido detector paralelo de silêncio5s e classificação por texto de
warning. Assinatura antiga signal.recovered de silêncio preservada; UI enumera
eventos disponíveis.35casosdistintos/4files PASS após reparos dirigidos, tipos/
build server+web PASS. Nativecompiled xZuRKJ PASS com arquivos locais próprios:
black+silence, branco estático freeze e ball recovery;7 entregas/8HTTPloopback,
503retry mesmoID, correlação incidente/entrega, semautoPGM, ownserver/engineexit.
Não físico/browser/latência de limites em todos perfis/soak. Tentativas TKLosi e
yxqPev FAIL de cenário (preto nãofreeze, SMPTE temruído animado), sem afrouxar
detecção. Evidência group09-pgm-signal-incidents-20261010.json; r37 não contém
este lote. Total53 continua5concluídas/24em andamento/24pendentes,10grupos1/9.

10/10 — incidentes 9.2 passa de pendente para em andamento. Reconhecimento
agora atômico com auditoria/ator/canal/evento, idempotente e sem confirmar
recuperação do sinal; inexistente404, falha audit/update409 sem gravar falso
reconhecimento. Lista/CSV aplicam ACL antes do limite, sem alertas globais para
conta restrita. UI trata erro e bloqueia repetição enquanto registra. 11 testes
distintos/2 arquivos PASS (10 lote + 1 novo guard dirigido); tipos/build server
e web PASS. Compilado qDNRXG PASS: persistência/replay após reinício,403/404/409,
ator e único ACK auditado, zero as-run/engineoff, ownexit observado. Fixture
inicial U5gkZT falhou ao usar JSON em payload cifrado; corrigido somente roteiro,
não rebaixada a proteção. Evidência group09-health-incidents-20261010.json.
R37 permanece anterior a este lote; não contém estas alterações. Falta revisão
visual e fechamento de limites preto/freeze/silêncio e entrega externa.

10/10 — após gerar r37, pontos restantes locais 3.1/3.2 conferidos na página:
NDI B sugeriu e salvou Estúdio Óptico NDI B (POST201/banco canal a). Pasta
Unicode browse200; editar caminho ocultou a lista antiga e exibiu aviso ABRIR.
Fixture FPw1gQ com descoberta sintética, zero as-run e engine PGM desligado;
encerramento próprio observado exit0. Evidência group03-settings-flow-20261010.json
e duas capturas. Não fecha os marcos físicos/remotos. Não repetir esses pontos.

R37 empacotamento concluído: release/RPlayout-1.1-parcial-20261010-r37-instalador.zip,
450385939 bytes. Sem teste de instalação; nenhum marco de fechamento encerrado.

10/10 — r37 parcial em geração a pedido do usuário, antes de concluir o fluxo
3.1/3.2 e sem teste de instalação. Interface compilada index-pDy_fGyY.js:
confirmação de pasta vinculada ao caminho revisado, lista antiga ocultada quando
o caminho muda e identificação acessível do campo de nome da entrada. Leitura
do manifesto do pacote corrigida para UTF-8 (Windows PowerShell interpretava
o caminho Unicode de uma fixture de dependência como ANSI).
Evidência anterior de navegador isolado ooAdnu: pasta Unicode cadastrada no
servidor, seleção NDI altera sugestão de nome, apelido manual preservado e
cadastro OMT salvo com nome selecionado. Descoberta sintética, sem sinais reais.
Ainda falta confirmar o cadastro NDI persistido e a lista invalidada na página.
Não repetir a prova OMT aprovada. Totais permanecem 10 grupos (1 concluído,
9 abertos) e 53 verificações (5 concluídas, 23 em andamento, 25 pendentes).

R36 ZIP concluído semtesteinstalação:536351446bytes;
SHA A5D249924C3FCE4D409820E3515CF84BC84647156BE10D96C0E25E094C14B607.
Inclui quadro QC único/preciso e sonda atualizada; nenhum marco de fechamento
encerrado por empacotar. Releases anteriores conservadas.

09/10 — QC quadro preciso/latência: rota qualidade→strip onlyFrame, dedup por
índice, receita qc-frame-v3 exigida; régua continua bulk leve. CLI inicialPAUSED,
seekACCURATE e capture→Playing, endpoint24pos i/23 com último antesEOS. JPEG
escrito temporário/rename antesflag2. Cacheframe-v3 conserva antigos.9HTTP+3
lifecycle+12nativePASS;tipos/serverbuild/probereleasePASS. Prova GOP longo
inicialYorIcxFAIL(0quadros), corrida reparada e replayUk1A5OPASS4pos/timestamps
e4JPEG distintos,1JPEG/call247–291ms. HTTPcompiledNVELC8PASS845ms/1JPEG,
zeroQC/asrun, próprio exit0. Não benchmark remoto/browsernovo; não fecha3.5.
Evidência group03-qc-accurate-frame-20261009.json. R36 parcial em empacotamento,
semtesteinstalador,web inalterada. Não repetir os fluxos aprovados por status.

09/10 — browser/HTTP compilado fallback QC PASS (GiwZjw): FFV1 próprio
720x576PAR16/15 não decodificado no browser→JPEG original720x540/200 real;
falha503 do quadro5 injetada em relay loopback próprio→sem imagem/safe area,
scopes AGUARDANDO/sem números; retry recupera JPEG/200 real e medição; volta
ao proxy320x240 ready4 posição1.108695 para seleção1.12. Zero QCdecisions/asrun,
PGMengine desativado, encerramento próprio observado. Texto Ignorados conferido.
Evidência group03-qc-fallback-browser-20261009.json/capturas. Primeira fita em
qualidade demorou7644ms (24quadros); não benchmark remoto. R35 entregue com
probe/server/web atuais, sem teste instalação. Não fecha3.5/3.6/3.7 ou físico.

09/10 — lote posterior à r34: fallback de quadro original falho agora mostra
status/retry manual, sem miniatura; limpa scopes e descarta eventos de outra
URL. Arquivos não reutilizam pixels retidos; somente live recente pode fazê-lo.
Safe area rebinda ao novo JPEG e desaparece se qualidade está indisponível.
Sonda extrai JPEG square-pixel/PAR, sem matte/upscale, bounded3840x2160;
cache da rota usa picture-v2 e não apaga/relabela JPEG anterior. Lote50/5PASS,
12testes nativosPASS. Tipo servidor detectou fixture readonly, corrigida sem
alterar produto; replay dirigido9HTTPPASS; tipos web/servidor e buildsPASS.
CLI releaseJPEG P5fHrvPASS:16:9/4:3 sem upscale, vertical2160x3840→1216x2160,
SD720x576PAR16/15→320x240. Ainda não prova browserfallback/HTTP compilado;
não fechar3.5. Fora da r34. Totais10grupos/53verificações mantidos.

09/10 — parcial r34 materializada e entregue sem teste do instalador; link em
release/RPlayout-1.1-parcial-20261009-r34-instalador.zip. Após gerar, iniciada
correção para falha de JPEG original não conservar scopes antigos nem usar
miniatura como QC; status e retry manual. Ainda não compilada/testada, fora
da r34; validação fica no próximo lote afetado, sem repetição por status.

09/10 — QC arquivos integrado no servidor compilado: scan de pasta Unicode,
ARCHIVE/PROXY READY com receita atual, bytes de preview/original conferidos.
Navegador local exibiu 16:9, 4:3 e vertical, original/proxy, posição preservada
em 16:9 e safe areas restritas à imagem; padrão OFF. Banco isolado permaneceu
com zero decisões QC e zero as-run; engine PGM desativado nessa prova.
Capturas em scratch/qc-file-*-20261009.jpg; workflow em pasta temporária
RPlayout-QC-file-browser-qQqAio. Ignorados não equivale a reprovação: texto
corrigido e web compilada, sem nova revisão visual desse texto. Parcial r34
solicitada sem teste de instalação. Totais de fechamento continuam inalterados.

09/10 — proxy de arquivo corrigido:426x240 fixo com faixas pretas incorporadas
impedia safearea seguir imagem4:3/vertical. Agora raster real/PAR ajusta geometria
par/bounded, sem bakedmatte:16:9→426x240,4:3→320x240,vertical→136x240,10fps/
220kbps+áudio. Receita picture-raster-v2 confirmada pelo binário; migração46
proxy_recipe mantém legados sem inferência. Ao acessar cache legado, só job é
FAILED porCAS; bytes, original e edição preservados; retry explícito regenera.
Worker não aprova saída de binário que não confirme receita. Lote58/5PASS,
tipos servidor74890PASS,2testes RustPASS(3transcodes reais/áudio/Unicode+PAR).
Releaseproxy38D57460... e server382B498C... compilados; CLIrelease/probe
SyujsaPASS3casos,20buffersvídeo104áudio cada. Não é servercompiled+worker juntos
nem browser de arquivo; ainda faltam ambos,4:3/verticalvisual, rotationtags,
remoto/carga/soak/físicos. R33fullinstaller criado; não instalado/homologado.
Evidência scratch/group03-file-proxy-picture-20261009.json. Web/mainengine
intactos; sem recompilar/retestar por status.10(1/9),53(5/23/25).

09/10 — startup WHEP corrigido:404/503 inicial aguarda5s/tentativas limitadas
na mesma oferta SDP, sem reconstruir peer a cada resposta; espera cancelável,
erro acesso/codec continua imediato. Conexão recuperada cancela timer de
rebuild; LIVE só confirmado por frame/raster do stream atual.37casos/4files
PASS (10novos), tipos web53916 PASS, build web index-Z6DQnhvy.js SHA3CEA62C1...
PASS com warningbundle. ServerA23DCA21.../engine4E71D478... não recompilados.
Browser isolado5549/UqmNLE: QC direto, WHEP428x240→1280x720→428x240 com vídeo
decodificado, PGM PARADO. HQ HTTP404→404→201 em0.92691s; sem afirmar benchmark
de primeiro frame ou ausência contínua de banner. CDP coleta inicial demorou
313s/truncou registros antigos; seguinte coleta timeout0 sem truncamento.
Aba fechada, stopFile único usado, exit0/cleanup próprio confirmado; ramo de
encerramento antes não testado agora validado. R32 fullinstaller536316772bytes,
SHA E2937E36F353981C2735471FF3A4DFD96727D1A0B927A9A52BC92613FAD91761;
sem instalação homologada. Evidência group03-whep-startup-recovery-20261009.json
e build-parcial-r32-20261009.json. Sem repetir suíte completa/engine por status.
Faltam QC arquivo/safe4:3/vertical, remoto/perf/soak/físicos e demais grupos.
Totais10(1/9),53(5/23/25) inalterados.

09/10 — QC/PVW publicado PASS32422/LKHMBA nos binários atuais: abertura
direta antes de PGM/publicação, pixels1280x720 em inspeção e428x240 econômico,
detalhe de origem acima do upscale, áudio Opus RMS0.02228, mesmo decoder,
PGM preservado, viewers independentes/lease expira, cleanup próprio confirmado.
Browser visual83685/HeLUA7 agora disponível: login de teste, fonte SRT própria
cadastrada pela API oficial, QC antes de MasterCUE/TAKE, WHEP raster real
428x240→1280x720→428x240, PGM PARADO, safe OFF padrão e após reload; overlay
alinha imagem16:9 e deixa faixas pretas em tela cheia. Capturas em scratch.
HTTP404 transitório durante início merece investigar corrida/latência de
recuperação; não declarar estabilidade completa. Escape pelo tool não saiu da
tela cheia; reload saiu. Fixture visual tinha stdin fechado, encerramento
não normal(exit13), processos próprios conferidos e encerrados; inventário
posterior vazio. Verificador agora usa stopFile único/expiração finita.
Evidências group03-published-qc-preview-20261009.json e group03-qc-browser-
20261009.json. Não é estação remota física, carga, arquivos4:3/vertical ou
protocolos/hardware. Sem produto/rebuild/pacote/suíte alterados por status.
Totais10(1/9),53(5/23/25) inalterados.
Lifecycle visual reparado:81374/hZymVU PASS exit0 por TTL1000ms; cleanup próprio
confirmado. Somente replay da falha de encerramento, sem repetir ensaioHQ.

09/10 — restauração compilada do vínculo PASS69700/0LVRmz com fonte SRT
contínua isolada. Preservou IDs editoriais, revisões publicadas, execução e
edição; retomada assinada52→84, as-run RESTART, PGM catalog-pgm, CUEqc
catalog-pvw, ambos vídeo/áudio recentes. STOP e cleanup próprios concluídos.
Evidência scratch/group02-restored-source-binding-20261009.json. Sem repetir
suíte, tipos ou compilação. Esta parte de restauração do vínculo está comprovada;
o grupo continua aberto para QC/imagem publicada/browser, físicos e soak.
R31 empacota o fix posterior à r30, sem testes do instalador ou recompilação.
Base materializada ausente recuperada do ZIP r30 com hash conferido em pasta
nova; nada excluído pelo agente. Totais10(1/9),53(5/23/25) inalterados.

09/10 — compilado PATCH/publicação/re-CUE9466/Fayeei PASS com SRT contínuo
próprio: nova referência usada, cadastro desvinculado, revisão antiga preservada,
PGM execução/atribuição mantidas e ambos buses vídeo/áudio recentes após editar.
Ensaio inicial27140 corretamente recebeu409 por item ainda no CUE; verificador
passou a exigir essa recusa, limpar explicitamente e obter nova conferência.
Nenhuma proteção do produto removida. Evidência
scratch/group02-compiled-connection-edit-20261009.json; serverA23DCA21...,
engine4E71D478.... Sem repeat de testes/tipos/build por status. Ainda faltam
restore do vínculo, imagem PVW/QC/browser, físicos e soak. R30 é anterior ao fix.
Totais/marcos permanecem iguais.

09/10 — ensaio contínuo SRT loopback30490/nt3YN3 PASS: TAKE/checkpoint e CUE
de segundo cadastro, amostra automática correlacionada com edição/execução/PID,
IDs/names distintos NATIVE_DECODER. Amostras mostram SIGNAL_OK/vídeo+áudio
recentes em PGM/PVW. Não é NDI/OMT/DeckLink, imagem publicada de PVW/browser,
carga ou soak; falha anterior com arquivo finito continua registrada.
Novo lote HTTP7 casos/2 arquivos PASS após replay dirigido de fixtures; corrigiu
edição manual de liveEndpoint/liveConfig que deixava sourceRef antiga. Tipos e
build somente servidor PASS. R30 NÃO inclui esta última correção; não refeita
por status. Evidência scratch/group02-realtime-source-catalog-20261009.json.
Restam restore compilado, QC/browser/imagem publicada, sinais físicos e carga.
Somente70 MB livres; preservar releases, pedir espaço para novo instalador.
Totais e marcos permanecem iguais.

09/10 — validação consolidada após r30:269 casos/10 arquivos PASS(6896),
tipos servidor/web PASS(34549). Ensaio compilado12199/13LVdq NÃO passou:
PGM inicialmente SIGNAL_OK, depois PGM/PVW NO_VIDEO apesar de áudio recente.
Leitura somente das amostras já gravadas comprovou nomes/IDs distintos e eco
NATIVE_DECODER nos dois buses; não comprova sinal sustentado. Fixture usa URI
de arquivo finito, não protocolo/hardware. Falhas anteriores de preparo do
PVW/listener foram diagnosticadas e reparadas sem rerodar testes/tipos.
Evidência scratch/group02-source-identity-validation-20261009.json. Investigar
com fonte contínua em tempo real, não relaxar a exigência de vídeo recente.
R30 preservada, sem rebuild por status; totais/marcos permanecem iguais.

09/10 — parcial r30 GERADA sem testes funcionais: build servidor/web e
cargo release bins PASS; empacotamento streaming completo reaproveita runtimes
r29 com hashes conferidos, inclui dist/executáveis atuais e novo manifesto.
ZIP536314854 bytes, SHA694967BEDAB1FE0E3F002217A5C72803A3FA248379ACCCA8A19EB3069EEB53AF.
Evidência scratch/build-parcial-r30-20261009.json. Não houve instalação,
typecheck ou execução funcional destes lotes. Nenhum release apagado; somente
110 MB livres após geração. Empacotamento deixou de estar bloqueado por espaço;
próxima validação será consolidada, sem recompilar por status. Totais iguais.

09/10 — compatibilidade de projetos integrada em código: ID opcional deve
ser não vazio, até200 caracteres e somente LIVE; legados sem ID permanecem
sem atribuição inferida. Migração45 verifica coluna nullable TEXT mesmo com
marker existente. Seis casos escritos (migração/projeto/roundtrip), NÃO
executados; nenhum tipos/build/pacote novo. Evidência
scratch/group02-source-binding-compatibility-20261009.json. Backup/restore
compilado e roundtrip ainda não validados. Espaço observado648 MB ainda menor
que processo padrão de empacotamento; releases preservados e totais iguais.

09/10 — identidade cadastral nativa implementada em código: EngineItem/
ItemSpec recebem configuredSourceId; Ready/Telemetry devolvem valor do decoder
montado no bus. Servidor só registra eco com item/decoder/ID atual correspondente;
limpa em reabertura/substituição/perda/falha/restart. Histórico distingue
PUBLISHED_ITEM/NATIVE_DECODER; nenhum deles substitui medição de sinal.
Um teste de transporte novo e extensões Rust/métricas escritos, NÃO executados;
sem tipos, compilação ou novo pacote. Evidência
scratch/group02-native-source-identity-20261009.json. Falta prova consolidada,
compilada/browser/física; dist/engine release/r29 permanecem anteriores.
364 MB livres ainda insuficientes para parcial; sem limpeza autorizada.
Totais inalterados. Notas anteriores são checkpoints, não evidência deste lote.

09/10 — 9.1 histórico com atribuição cadastral por bus implementado: lookup
por ID explícito do item e conexão exata no canal, PGM/PVW distintos mesmo
endpoint, IDs HMAC e nomes seguros. UI indica vínculo pelo item publicado,
não prova nativa/sinal. Legados/conexões divergentes não recebem atribuição.
Dois testes escritos, não executados; sem tipos/build/novo pacote. Evidência
scratch/group09-source-bus-catalog-20261009.json. Junto do lote migração45,
aguarda parcial sem testes e depois validação consolidada. Identidade nativa,
browser/físico/carga continuam abertos; totais inalterados.

09/10 — continuação em código sem novos testes: migração45 adiciona ID cadastral
opcional ao item, sem inferir legados por endereço. Diálogo envia seleção;
criação verifica canal/conexão/habilitação dentro da transação editorial;
publicação preserva campo e protege mudança no live em PGM. Edição manual
de conexão remove vínculo. Seis testes escritos, NÃO executados; tipos/build
também não executados, dist e r29 não contêm o lote. Evidência
scratch/group02-item-source-binding-20261009.json. Falta validar integração,
backup/projetos e propagar identidade nativa/histórica. Não é homologação.
Parcial continua aguardando espaço/autorização para limpeza; totais iguais.

09/10 — seleção de input integrada: mantém cadastros distintos mesmo com
endpoint igual, usa o nome selecionado e filtra acesso por canal sem alterar
cache compartilhado. 14 testes distintos em 5 arquivos; falha inicial de rota
corrigida com replay somente do caso afetado. Tipos/build servidor e web PASS;
última mudança de chave React recebeu apenas web build. Evidência:
scratch/group02-source-catalog-selection-20261009.json. Ainda faltam persistir
ID cadastral na playlist/engine, interação no navegador e sinais físicos.
Não encerra 2 ou 9.1; totais inalterados.

Nova parcial sem testes solicitada após integrar o fluxo. Empacotamento ainda
não iniciado: disco C com 255729664 bytes livres; referência r29 ocupa
1411981638 bytes extraída, além de payload/ZIP de aproximadamente 536 MB cada.
Precisa liberar cerca de 2,5 GB mais margem temporária. Nenhum release foi
apagado. R29 existente não inclui este lote nem as melhorias posteriores.

9.1 melhoria de retomada UI integrada: retry na mesma página, deadline10s e
cancelamento em troca de escopo.86974:9testesmarkup/API/tipos/webbuildPASS.
Browserhelper falhou antes de inventário e após reset/retry; nenhuma aprovação
visual. Evidência group09-operational-history-retry-ui-20261009.json. Interação
real, carga e sourcecatalog continuam pendentes; totais/marcos iguais.

9.1 retenção de14dias agora atômica com amostra/eventoHOST; cache só após
commit.84199:17testesafetados/tipos/serverbuildPASS, incluindo fronteira e
rollback/retryreal.96086/UEpxKJ compiladoPASS de expiração automática com
datas15/13dias injetadas. Evidência group09-operational-history-retention-
20261009.json. Não é soak14dias/carga representativa/browser; faltam esses
fechamentos e sourcecatalog. R29 preservada; marcos e totais inalterados.

9.1 coleta compilada79863/J7TgQH PASS para nomes de item/saída e ID de perfil:
reprodução/gravação locais reais, rename em DBfixture preserva amostra antiga e
ID; APIhistórica e gravação decodificada. Não valida cadastro/nomes de fontes,
APIdeedição, browser, retenção/carga ou sinal físico. Evidência group09-
operational-history-labels-compiled-20261009.json. R29 preservada, totais iguais.

9.1 publishers identificados por ID de perfil quando disponível; duplicação
de destino não mistura IDs/nomes. Cadastros de fonte sem vínculo inequívoco
ficam ambíguos, não recebem nome arbitrário.81202:129testesafetados/tipos/build
PASS; evidência group09-operational-history-identities-20261009.json. Ainda
faltam captura compilada deste lote, vínculo cadastral nativo de fonte quando
ambíguo, navegador e retenção/carga. Sem novoinstaller/marcos/totais alterados.

9.1 nomes históricos integrados em amostras/interface: acentos, lookup por
canal e alvos exatos, sem retropreencher legados nem derivar nomes de URL.
35661:16testesafetados/tipos/buildPASS; evidência group09-operational-history-
labels-20261009.json. Falta captura compilada/renomeação, desambiguação de
alvos duplicados, navegador e retenção/carga. Totais e marcos inalterados.

9.1 paginação no servidor compilado32787/1qiTXX PASS:2413registros sintéticos
em21páginas exatas, janela fixa/ACL/privacidade/cursor inválido/payloads
preservados. Falha inicial de expectativa globalACL no verificador corrigida
sem alterar produto. Evidência group09-operational-history-pagination-compiled-
20261009.json. Ainda faltam navegador, retenção/carga e nomes amigáveis.
R29 preservada, sem novo pacote; marcos e totais inalterados.

9.1 navegação histórica agora implementada por cursor e janela fixa, com
anteriores/voltar/recentes.30646:10testesafetados/tipos/buildPASS; evidência
scratch/group09-operational-history-pagination-20261009.json. Não é aprovação
de navegador, nova rota compilada ou retenção/carga. R29 anterior preservada.
Marcos de fechamento e totais permanecem iguais.

9.1 continuação após r29: ensaio compilado67423/ACEBbN PASS provou persistência
automática sem painel/API de métricas, correlação edição/execução/PID/PGM e
CPU/RAM reais. Mídia sintética/saída nula, não sinal físico nem UI. Evidência
scratch/group09-operational-history-native-20261009.json. Falta navegador,
retenção/carga e fechamento da navegação histórica; totais inalterados.

09/10: parcial instalável r29 entregue após integrar o fluxo histórico por
canal, sem novos testes funcionais, a pedido do operador. Manifesto
NOT_RUN_PARTIAL_BUILD; ver docs/BUILD-PARCIAL-R29.md. R28 preservada. O modo
--metrics-only de ensaio compilado foi preparado, mas ainda não executado.
Empacotamento não altera estados nem totais:10grupos1/9;53checks5/23/25.

Implementar o lote relacionado antes da validação consolidada. Mudanças de
status, inventário, documentação ou comunicação não disparam testes/build.
Reutilizar a evidência existente enquanto o código e o contrato correspondentes
não mudarem. Após uma falha, repetir apenas os casos afetados pela correção;
ampliar a regressão somente quando houver dependência ou risco de integração.
Não somar execuções sobrepostas nem apresentar testes automatizados como
marcos de fechamento ou homologação física.

Lote TAKE/QC de 08/10: o destino compartilhado de TAKE agora recusa arquivo
bloqueado/não aprovado ou incompatível com o perfil atual antes do comando
nativo, com resposta operacional e preservação do PGM. Validação consolidada:
123/124 PASS; uma fixture omitia campos do perfil padrão. Corrigida somente a
fixture, replay dirigido do único caso falho: PASS. Cobertura distinta:124 casos,
não125. Tipos e build do servidor PASS antes do replay; não repetidos porque
somente a fixture mudou. Integração compilada ponta a ponta ainda pendente;
nenhum marco ou total foi alterado por esse resultado.

## Pendência 1 — Proteção da distribuição local

- 1.1 Identidade nativa de processos e sockets: **concluída**. Kernel/cliente
  reais b6c5b7/95b936; handles por encarnação, processo encerrado não readmitido
  pelo mesmo PID, trava independente de DB/pasta. Não é prova de transmissão.
- 1.2 Bootstrap compilado com bancos distintos e configuração privada:
  **concluída**. Compilado gW0s1R PASS, auxiliar ACL embutido real; API alheia
  não consultada, configuração anterior preservada, peer recusado antes dos
  efeitos. Sucessor somente após encerramento real e reinício explícito.
- 1.3 Engine e relays pelo bootstrap protegido: **concluída** no escopo local.
  Compilado gW0s1R PASS com vídeo sintético real decodificado, entrega de buffers
  pelo relay em loopback, recuperação de geração do relay sem reiniciar VT e
  exclusão do peer. Perda/recusa de posse cobertas nos testes de admissão/kernel;
  todos os processos/listeners próprios encerrados. Não homologa saída física.
- 1.4 Regressão da fonte final do grupo: **concluída por cobertura com replay
  dirigido**, não por uma integral única verde. Rodada57152: 2.168 PASS/10 FAIL
  em5 fixtures simuladas. Após reparar apenas essas fixtures, rodada38396:
  36/36 PASS, mesmas asserções e arquivos falhos. Fora do replay: 2.142 PASS
  inalterados; cobertura distinta 2.178 testes/221 arquivos. Fonte do produto e
  binários não mudaram. Não somar rodadas sobrepostas nem ocultar a falha inicial.

Fechamento: 4/4 aprovadas no escopo local. Crash do broker encerra a própria
família por segurança; recuperação e continuidade permanecem nos grupos 8/9.

## Pendência 2 — Entradas e operação ao vivo

- 2.1 Estados de fonte e sinal: **em andamento**.
  Política live agora configurável por canal no Perfil técnico do QC:
  aviso habilitado/limite em intervalos/quadros de aquecimento. Persistência
  em qcProfile com revisão/auditoria; runtime usa a visão atual sem reabrir
  decoder. Desativar aviso não desativa detecção de ausência de vídeo/áudio.
  158 testes afetados/tipos/build servidor/web PASS; sem engine alterado.
  Falta homologação visual/física e freeze por conteúdo; política não é norma.
  Lote de descoberta na interface: cadastro deixa de contar como porta/fonte
  detectada, proveniência desconhecida não é descoberta; motivo do runtime
  fica visível mesmo com fontes salvas. DeckLink/NDI/OMT usam apresentação
  consistente; seletor e diálogo da grade não ocultam falha por cadastro nem
  afirmam driver presente sem prova.15 testes afetados distintos PASS; sem
  alteração do produtor nativo, ainda falta placa/rede e aprovação visual.
  Lote de degradação: diagnóstico compartilhado UNSTABLE para variação nativa
  acima de3 intervalos de quadro após50 quadros recebidos (política operacional,
  não norma nem jitter de rede). Sem áudio não aparece saudável/verde; alerta
  visível junto à imagem, sem trocar tally ou recusar TAKE por esse aviso.
  141 testes de contratos afetados +2 de markup distintos PASS, tipos e build
  servidor/web PASS; último markup compilado posteriormente. Falta freeze por
  conteúdo, políticas por canal, estados de descoberta e homologação física.
  Correção anterior em lote da idade do sinal no engine, servidor e página:
  131 testes afetados e compilação PASS;
  perda/retorno de buffers no engine PASS em caso dirigido. Não é fechamento
  completo do grupo nem homologação física. Lote posterior: diagnóstico de sinal
  compartilhado separado do tally; ready/telemetria vinculados ao item por bus,
  preservação do PGM durante TAKE pendente da mesma fonte, QC exige vídeo recente.
  122 testes afetados +14 específicos do QC PASS, tipos e build servidor/web PASS.
  Lote seguinte protege perda no PGM e erro de outro item da mesma fonte;
  91 testes do transporte, tipos/build do servidor PASS. Não somar aos89
  anteriores. Posse do PVW agora acompanha o comando efetivamente enviado,
  inclusive antes do ACK/limpeza e park; 93 testes/tipos/build servidor PASS.
  Engine passou a deduplicar readiness pela abertura real do decoder, não só
  pelo ID editorial:19 testes nativos afetados e build release PASS.
  Identidade agora propagada por ACK/estado/eventos ao servidor com capacidade
  nativa explícita:95 testes de transporte PASS; invalidação da medição antiga
  validada por replay dos2 casos afetados. Rust:17 PASS/1 FAIL na rodada do canal;
  caso falho passou isolado com diagnóstico adicional, causa ainda não provada.
  Serialização nativa PASS; servidor/engine compilados. Ensaio do transporte
  real do servidor com engine nativo PASS: CUE repetido, vídeo/áudio, TAKE,
  PVW/PGM independentes, limpeza/STOP e perda EOS/reconexão sem reiniciar engine
  ou avançar grade. Não é aprovação da API compilada/navegador/hardware.
  Falta resolver coleta intermitente de áudio, integração
  completa de descoberta/instabilidade e navegador. Separar
  descoberta, conexão, vídeo/áudio, instabilidade, PVW/PGM e falha, sem inferir
  sinal a partir de cadastro, HTTP200 ou processo vivo.
- 2.2 DeckLink: **pendente — adiada pelo usuário em 12/10**. Conferir plugin/runtime, Desktop
  Video, enumeração/subdispositivo e entrada sem sinal; registrar versões.
- 2.3 NDI: **em andamento**.
  Atualização16/10: timeout/EOS nativo corrigido; CTtr22 perda/retorno com um
  CUE e mesmo receptor/decoder PASS, com imagem e PCM novos, sem falhas HTTP.
  Engine da fonte161FB003 sobre r71 explícito; não é homologação externa.
  Histórico em GRUPO-02-NDI-RECUPERACAO-2026-10-12.md; falta emissor/receptor externos reais. Descoberta, resolução/FPS,
  vídeo/áudio, publicação, reconexão, freeze/jitter e estabilidade.
- 2.4 OMT: **em andamento**. Runtime oficial incluído passou em ensaio nativo
  Atualização16/10fVENXc: recuperação automática após perda aprovada na r71
  instalada, com um CUE, mesmo receptor/decoder e imagem/PCM novos. Falta
  retorno durante PGM em reprodução, sinais externos e estabilidade longa.
  Atualização15/10r71instalada BS8rwI: PVW real/API/despacho nativo e shutdown
  ordenadoPASS; erro de origem reproduzido após desligamento proposital do
  broker,comhorário/fase. Não homologa recuperação/soak nemdataerrohistórico.
  próprio: publicação/recepção de vídeo e áudio, descoberta, appsrc e CUE/TAKE.
  Falta ampliar a recuperação ao PGM ativo, estabilidade e homologação entre máquinas/sinais externos.
  Não é SMPTE-2110/NMOS; ensaio local não aprova rede ou equipamento físico.
- 2.5 CUE/TAKE/Próximo: **em andamento**.
  Retomada12/10: servidor AA08FB5F e engine D55F2110 passaram no cenário
  compilado/native; CUE repetido, conservação da origem do PGM, TAKE do CUE,
  recusa de fonte ambígua e ausência de fallback para Próximo. Preview real
  428×240; HQ não é requisito para TAKE. Cleanup próprio confirmado.
  Ver GRUPO-02-03-RETOMADA-2026-10-12.md; não aprova equipamento/rede externa.
  Corrigido opt-in de decoder descartado pelo ambiente: agora somente engine
  recebe RPLAYOUT_HARDWARE_DECODE=1 explícito; software padrão mantido e demais
  helpers/credenciais não recebem essa opção.121 testes afetados PASS, build
  servidor9871BEB4 PASS; não é homologação física da GPU/DeckLink.
  Lote compilado independente do QC:70979 PASS, GCF2Lw/result.json lido após
  cleanup próprio; servidor CE255336/engine92B7E56 inalterados, sem rebuild.
  CUE inicial/repetido não coloca no ar; CUE de outra ocorrência preserva
  item/origem do PGM e seu contador continua. TAKE implícito segue o CUE;
  fonte ambígua retorna409 e ausência de CUE retorna400, sem usar Próximo.
  PVW real decodificado428x240; HQ do QC permanece desligado, STOP confirmado.
  Evidência `scratch/group02-compiled-cue-take-20261008.json`. Ainda faltam
  navegador, fontes distintas/rede externa, áudio/perda e estabilidade longa.
  Histórico: TAKE não pode aceitar o primeiro
  quadro antigo como sinal atual; caso nativo dirigido confirmou rejeição,
  preservação de PGM e retorno de buffers. Rodada nativa geral interrompida
  por acesso à memória; isolamento também revelou falha de áudio A/B multicanal.
  Investigação posterior localizou os crashes no driver Intel DXVA. Política
  por software padrão, formato fixo A/B, callbacks fracos/fechamento protegido e
  confirmação dos seletores: 18 testes do canal PASS. Coleta por PTS/500ms de
  amostras reais, sem reduzir exigências de ganho/silêncio. Falhas históricas
  preservadas; faltam fluxo externo/navegador e estabilidade prolongada.
  CUE prepara PVW; TAKE leva
  o cued ao PGM após quadro válido; falha conserva PGM; Próximo é distinto.
  Validar QC direto sem Master e ausência de piscadas/trocas indevidas.
  Lote posterior corrigiu falhas comprovadas do decoder antes do TAKE:
  ensaio real com entrada sem vídeo recusou a tentativa, descartou armado e
  preservou PGM com vídeo/áudio recentes, sem reiniciar engine. OMT local PASS.
  Falta API/QC HQ/navegador, coleta de áudio STOP e estabilidade prolongada.
- 2.6 Dispositivos de automação: **em andamento**. Verificador nativo completo
  chegou ao arquivamento e falhou no checkpoint parado protegido. Após reparo,
  47 testes de contratos PASS e replay nativo só do limite de arquivamento PASS,
  com TAKE/STOP reais, histórico preservado e reativação sem iniciar PGM.
  Não é integral única verde nem homologação física. Falta
  homologar ATEM/GPIO/routers habilitados. Caso não aplicável, registrar
  justificativa explícita e configuração; não presumir hardware ausente.

Fechamento: 6/6, com evidência física separada e contratos operacionais claros.

Evidência do primeiro lote (histórico): `scratch/group02-live-freshness-summary-20261006.json`.
Fonte do produto congelada antes da rodada; reparo posterior somente na fixture
do novo caso de perda de sinal, com replay desse caso. 73 casos nativos distintos
PASS, 1 FAIL multicanal e 1 ignorado de runtime OMT: **não** é suíte integral PASS.
Status/documentação não motivaram nova rodada. Não somar resultados sobrepostos.

Etapa posterior: `scratch/group02-native-corrections-20261006.json`: canal18/18
PASS, OMT nativo oficial1/1 PASS, contratos de arquivamento/posse47/47 PASS,
replay nativo de arquivamento PASS, engine release e servidor atualizados.
Falhas anteriores mantidas, decodificação por software padrão para não selecionar
automaticamente o driver Intel onde o Windows registrou os crashes. Aceleração
exige opt-in e homologação; consumo será medido no grupo3. Nenhum novo ZIP/push.

Lote de diagnóstico/binding: `scratch/group02-signal-binding-summary-20261006.json`.
136 testes distintos em5 arquivos, sem repetir a suíte Rust: engine nativo não
mudou neste lote. Servidor/interface recompilados; ainda não é pacote portátil
final ou homologação física. Status/documentação não disparam nova validação.

Lote PVW: `scratch/group02-preview-ownership-summary-20261006.json`.
Não somar93 aos91/89 anteriores. Inspeção do produtor Rust identificou cache
  de readiness apenas por itemId, posteriormente corrigido na etapa
  `scratch/group02-repeated-cue-native-20261006.json`: identidade por abertura,
  reabertura QC com quadros reais/liberação do pipeline anterior PASS.
  Falta encarnação do decoder/abertura ponta a ponta, não simplesmente marcar pronto
por ACK ou telemetria. Não encerrado2.1/2.5.

Ligação de encarnação: `scratch/group02-decoder-wire-summary-20261006.json`.
Implementação engine/servidor, sem encerrar homologação: binário antigo sem
decoderIdentity mantém compatibilidade, não a garantia nova. Pacote final deve
usar engine/servidor correspondentes e provar o fluxo real. Falha nativa
original preservada; replay isolado não prova causa corrigida nem soak aprovado.

Ensaio local real: `scratch/group02-real-decoder-wire-20261006.json`.
Primeira execução falhou por preview ausente no verificador; produto recusou
corretamente. Após configurar barramento sem ativar publicação de rede, fluxo
PASS e extensão de perda/reconexão PASS; saída do engine próprio aguardada.
Não somar ensaios repetidos como verificações novas ou aprovação física.

Falha real de TAKE: `scratch/group02-real-take-failure-20261006.json`.
Produto agora trata Error/EOS/ausência comprovada de pad de vídeo no candidato;
fonte apenas aguardando sinal não é marcada como falha. Primeira execução do
verificador falhou por indexação de lista reordenada; replay com identidade
de fonte PASS. Fonte final:2 contratos nativos PASS e OMT oficial local1 PASS.
Não repetir suíte servidor/web inalterada nem declarar grupo2 fechado.

## Pendência 3 — QC e operação remota

- 3.1 Pastas na página remota: **concluída**. Seletor HTML acessa os arquivos
  do servidor, sem diálogo do SO. Edge navegou na pasta de teste `ação ÇÃÓ 東京`
  e confirmou seu caminho selecionado; não se usou seletor de arquivos local
  do browser. Evidência12/10 no relatório da retomada. NAS/UNC de outro host
  não foi certificado por esse ensaio local.
- 3.2 Nome da input: **concluída** no escopo funcional do nome/cadastro.
  Atualização15/10: descoberta nativa2NDI/2OMT comUnicode, cadastro e Master
  no navegador local QA PASS; nome automático/alias/reset/gravação/releitura.
  Asserção3fontes/4mutações/grade-asrun0/cleanup próprio PASSvT4ELw.
  WebB10A5AF6igualr70 em overlay, devicesfonte comtrace; nãoé homologação
  física/estação remota/instalação r70. Documento NOMES-INPUT-DESCOBERTA-NATIVA.
  Histórico: campo abaixo da seleção,
  nome da fonte NDI/OMT/etc. como padrão; alias manual preservado coerentemente.
  Edge confirmou preenchimento após informar referência NDI e preservação
  do alias manual após mudar essa referência. Campo/fluxo aprovados nesse caso;
  seleção da lista de emissor NDI/OMT foi posteriormente conferida com anúncios
  nativos próprios em15/10; qualidade de sinal externo permanece em2.x/3.3.
- 3.3 QC direto: **em andamento**. API compilada DE7F54E + engine92B7E56 PASS:
  Atualização16/10 r4h6Yo: navegador OMT direto no QC e ciclo leve/HQ/leve com
  imagem/PCM reais, scopes amostrados, PGM parado e grade/as-run0. Engine191CD1E1
  em overlay; prova local, não estação remota ou demais protocolos.
  Atualização15/10BS8rwI: r71instalada semoverlays, API/nativoNDI+OMT/PVW
  428x240decodificado, PGMparado/grade-asrun0;shutdownordenadoPASS e errode
  perdaOMTinjetada reproduzido4104msapóspararbroker. Semreplaydenavegador.
  Atualização15/10ABuYjy: browserQA direto emNDI/OMTnativos locais428x240,
  capturas independentes75quadros/desvios71,51/71,28, semMaster/TAKE/PGM,
  grade-asrun0. Leituras catálogo/telemetria independentes e falhas preservam
  player; consulta recupera. Overlay explícito/r68. AsserçãoPARTIAL_PASS por
  diagnóstico final do senderOMT semhorário; estabilidade nãofechada.
  Faltam demaisprotocolos/RTMP, fontesexternas/estação remota; DeckLink adiada.
  Ver QC-NDI-OMT-CONSULTAS-2026-10-15.md.
  Retomada12/10: API AA08FB5F/engine D55F2110 PASS e Edge exibiu o SRT local
  diretamente no QC, sem CUE no Master/TAKE e com PGM parado. Aviso de sintonia
  agora desaparece por vídeo recente no PVW, sem clicar em qualidade; não
  reaparece por perda posterior de uma solicitação já consumida.25 testes
  afetados, tipos/build web e confirmação visual PASS. Demais protocolos/
  fontes externas continuam abertos.
  CUE/inspeção HQ1280x720 antes da publicação/primeiro TAKE, PGM parado,
  apenas1 reader da fonte; depois PVW/PGM independentes e cleanup confirmado.
  Resultado persistido em zDkG6a/result.json; não depende de stdout perdido.
  Falta seleção/reprodução no navegador remoto e protocolos/hardware reais.
  Abrir sem sintonizar primeiro no Master, sem alterar inadvertidamente PGM.
- 3.4 Layout QC: **em andamento**, falta homologação nas demais estações.
  Atualização16/10: geometria local já conferida na r58/u6WVWl em14/10:
  original4:3 640×480/tela cheia e vertical com safe limitado ao raster,
  não às barras. QC-VISUAL-R58-2026-10-14.md; não repetir esse recorte.
  Faltam estação remota, combinações/resize ainda não cobertos e fullscreen
  específico do fallback; não é aprovação visual universal. Vídeo ampliado, safe area
  Retomada12/10: conferência Edge16:9 e tela cheia PASS; vídeo428×240 e1280×720
  ampliado no painel, safe inicialmente desligado e overlay na imagem, não
  nas barras pretas da tela cheia. Pedido antigo de arquivo4:3/vertical
  atendido localmente em14/10; demais estações continuam abertas.
  dentro da imagem, desativada por padrão, não na faixa preta inteira.
  Lote08/10 usa raster real do video/img e retângulo object-contain; resize do
  painel/tela cheia/raster recalcula sem trabalho por quadro. Não presume16:9
  para arquivo4:3/vertical ou proxy diferente; sem raster não desenha marca.
  32 testes afetados distintos aprovados com replay dirigido do helper após
  corrigir arredondamento; tipos web e build83338/BF2FD79C PASS. Navegador
  indisponível após recuperação prevista, sem aprovação visual. r24 intacto,
  correção atual deverá entrar no pacote seguinte.
  `scratch/group03-qc-contained-safe-area-20261008.json`.
- 3.5 Qualidade para aprovação: **em andamento**. API compilada/native HQ PASS:
  Atualização16/10 arquivo: YDfvxN original640×360 ready4/hash fixado, pico−26dB
  independente de mute, pausa/retomada/retorno proxy426×240 com posição preservada.
  Verificador de evidência PASS; não é escuta humana, PCM porcanal ou soak.
  Arquivo4:3/vertical/fullscreen e fallback FFV1 já têm provas visuais locais
  r58/13-14out; faltam remoto/4K/combinações não cobertas/fidelidade de aprovação.
  Atualização16/10: corrigida disputa de áudio entre encoders PVW/QC. WFEidE
  NDI/OMT simultâneos e r4h6Yo navegador OMT PASS, conferências independentes;
  áudio997Hz/pixels reais e mesma abertura nativa, HQ libera0readers. Não é
  certificação de fidelidade/escuta humana; limites de arquivos e remoto acima.
  Atualização15/10OMTlocal: imagem640x360 noQC/Opus+H264, guardJPEGcorrigido
  após falha observada nosscopes; webDG6oIPgn/CD7665DE, AMOSTRADO/imagem e
  retorno428x240, encoderHQdesligado/0readers. Não prova fidelidade original,
  PCM/escuta ou4K/remoto; diagnóstico finalsender ainda não classificado.
  Retomada12/10: Edge confirmou botão e reprodução WHEP428×240→1280×720
  sem alterar PGM; cenário nativo confirmou áudio Opus real, decoder partilhado,
  isolamento/expiração de viewers e cleanup. Arquivo/fallback de qualidade
  conferidos localmente em13-14/10 conforme atualização acima; não universal.
  preview428x240 e inspeção1280x720 com detalhe real/áudio Opus decodificado,
  sem nova conexão da fonte, PGM preservado, isolamento/expiração de viewers.
  Pedido antigo de botão/reprodução e inspeção de arquivo já atendido nos recortes
  locais documentados; faltam as qualificações acima. Botão existente deve
  permitir inspeção de arquivo/live em qualidade sob demanda e retornar ao
  modo econômico, sem afirmar qualidade de origem por proxy reduzido.
- 3.6 Preview econômico: **em andamento**, com proxy e preview publicado
  reais verificados; falta medição remota. Resolução/FPS/bitrate
  reduzidos, consumo CPU/RAM/rede medido e sinal estável via WHEP.
- 3.7 Scopes/áudio e telas compartilhadas: **em andamento**.
  Atualização16/10 arquivo YDfvxN: pico original independe do mute de escuta,
  desaparece na pausa e retorna em playback/proxy; scopesAMOSTRADO. Cadência
  exibida10/4Hz não é medição de frequência efetiva. Prova amostrada local,
  não continuidade prolongada/remoto/escuta humana/CPU-RAM-rede.
  Atualização16/10:8testes nativos afetados PASS, filas privadas por tee corrigem
  lacunas com dois encoders. Raw200/201buffers/0baixaenergia; WFEidE simultâneo
  NDI/OMT e r4h6Yo visual OMT/AMOSTRADO/PCM PASS. Não é benchmark CPU/rede/soak.
  Atualização posterior16/10: rótulo histórico e selo de sinal recente corrigidos
  em2.1/3.7; replay nativo/browser A4Uy5d e asserçãoPASS. Não fecha remoto/carga.
  Atualização15/10: scopesHQlive não são mais invalidados por nullJPEG==nullerro.
  7regressõesnovas e testesafetados PASS; replayQC OMTAMOSTRADO/luma/vetor/
  parade em640x360 e retornoleve.3.7 nãofecha áudio/continuidade/tally/
  multiview/remoto/carga; evidênciaQC-NDI-OMT-CONSULTAS-2026-10-15.md.
  Histórico: corrigida validade
  dos pixels live: leituras repetidas do canvas não renovam um relógio de vídeo
  parado; após2s não usar a amostra/estatísticas antigas. Arquivo pausado segue
  inspecionável. Relógio de playback não recria o intervalo nem força render
  adicional.21 testes afetados/tipos/build web PASS; sem engine alterado/retestado.
  Não detecta freeze por conteúdo se o relógio continua avançando. Falta
  medição/homologação no navegador remoto.
  Responsividade, áudio/tally corretos, multiview e restauração de projetos;
  limites e resultado registrados, não só markup ou build.

Fechamento: 7/7 em estação remota, com medidas e aprovação visual registradas.

## Pendência 4 — Grade, playlist e timing

- 4.1 Publicação operacional: **em andamento**. Integração compilada/nativa PASS:
  Lote14/10: diff/publicação/rollback visual local com banco real e sem engine
  comprovados; falhas de leitura10s bloqueiam ação, commit preservado não vira
  sucesso/falha de publicação falsa. Recibos lOAOuP revisão3 e restauração1→4;
  nenhuma as-run/escrita duplicada. Falta PGM/CUE real, concorrência, troca de
  seleção durante escrita, fechamento pendente e integração instalada/remota.
  Lote de proteção do CUE/liveConfig e resposta pós-commit concluído localmente:
  85 casos afetados/tipos/build PASS; origem temporal do PGM fixa por ocorrência,
  seek explícito recalcula,98 testes do transporte PASS. Publicação urgente
  concorrente no engine:24816 PASS, um201/outro409, uma revisão, mesmo
  item/startedAt no PGM. Falha72989 revelou oscilação de1frame; corrigido
  produto sem afrouxar asserção. Aviso pós-commit não anuncia rollback/sincronismo.
  Evidência:`scratch/group04-publication-cue-concurrency-20261006.json`.
  revisão original imutável mesmo após edição do título editorial e ajuste
  live; rollback cria revisão identificada sem trocar PGM. Fluxo visual local
  de diff/publicação observado14/10 sem engine; faltam CUE nativo e cenários
  completos de alteração/proteção/falha no navegador. CUE nativo integrado
  Pk9xnn comprovou vídeo e guardas de compensação/publicação/rollback, sem
  qualificar navegador/host remoto. Schedule
  editorial separado da playlist publicada, revisões/diff/rollback e as-run
  identificáveis; alteração editorial não muda silenciosamente o que está no ar.
- 4.2 Timing persistido: **em andamento**. Simulação/schedule persistidos,
  Lote08/10: corte resolvido enviado ao decoder, corte do PGM já montado
  preservado; limites elásticos respeitam arquivo real e não fabricam tempo.
  Timing preparado/CUE fica fixo diante de reprojeção pelo relógio; mudanças
  reais de mídia/grade/revisão continuam bloqueadas.200 casos distintos cobertos
  com replay afetado, tipos/build PASS. API compiladaCAC6A4E0/engine92B7E56,
  41034 PASS: corte automático125→75/EOS75 sem ajuste manual; filler nominal75/
  resolvido300/EOS300. Evidência `scratch/group04-resolved-execution-timing-20261008.json`.
  Integração posterior do corte montado após crash engine/backend: checkpoint
  com bounds/SHA, guardas de mídia/revisão/posse/cursor; legado sem crop recusado
  sem apagar cursor até STOP confirmado.147 casos distintos/tipos/build PASS,
  nativo20899/84FA0D94: nominal1250/resolvido750/EOS750 após duas recuperações,
  executionId mantido. Evidência `scratch/group04-09-mounted-crop-recovery-20261008.json`.
  Lote seguinte: mountedDuration na telemetria e grade, separado do nominal e
  da projeção de interrupção prioritária. Contador Master/eventos before-end
  usam o corte real; filler montado não é ajustado silenciosamente, PGM não
  some do plano por HARD_TIME vencido.163 casos distintos/tipos/build PASS;
  nativo8128/CE255336: nominal1250, transporte/grade750, evento650 disparado
  no651 uma vez e EOS750. Evidência `scratch/group04-mounted-duration-events-20261008.json`.
  Master compilado, ainda sem aprovação visual; evento local não prova pixels
  de grafismo físico nem gateway externo. Nenhuma nova verificação encerrada.
  Falta serviço/tempo real completo, falhas externas e homologação do
  CUE/navegador; não encerrar por esses ensaios locais.
  ajuste operacional +120s cria revisão e conserva timing original; faltam
  motivos de todas as compensações e zonas protegidas no fluxo completo. Revisão
  determinística, simulação, motivos/ajustes, prioridades e zonas protegidas.
- 4.3 Live prioritária: **em andamento**. Último engine7FD481E0: NDI InhMRG
  corte1109/2250 e OMT U4naNK1112/2250/retorno PASS; ausência OMT rJnTrF
  mantém VT3000 até STOP2211, sem TAKE tardio/pendência falsa. Conferências
  independentes PASS; arquivos/saída/network locais, não hardware/remoto/soak.
  Lote anterior16/10 NDI ZL8L4z/OMT KuZCgt:
  PASS com VT completo2250, corte automático1114 e retorno revisado; pixels/PCM
  e as-run/revisão/hash conferidos independentemente. Corrigido EOS antecipado
  condicionado à live; NDI Ar1tS2 também preservou VT sem fonte na âncora e sem
  TAKE tardio após retorno. Overlays explícitos/runtimes reais, fontes sintéticas,
  não homologação instalada/externa/visual/soak. Prova anterior357frames por
  arquivo mantida no histórico; faltam entrada externa/lista visual/proteção.
  Entrada marcada continua
  visível e corta VT no horário conforme política, registrando a interrupção.
- 4.4 Compensação rápida: **em andamento**. Ajuste +120s via API operacional
  Atualização19/10: copiar medida do conflito integrado ao fonte do Master,
  com delta exato emquadros e sem atualização silenciosa enquanto se confere;
  atalho não confirma nem executa TAKE.72testes/tipos PASS incluindo SQLite
  publicado/reenvio/recusaCUE. Falta build/interface instalada, navegação remota,
  concorrência e fluxo completo. COMPENSACAO-MEDIDA-CONFLITO-2026-10-19.md.
  Revisão/auditoria/tela agora separam duração nominal e executável; o ajuste
  automático pode aumentar filler além do nominal dentro dos limites reais.
  EOS nativo300 confirma o resolvido300, não apenas o nominal75. Aprovação
  visual/tempo remoto e fluxo completo ainda faltam; não repetir QC por status.
  Lote de ações futuras implementado: filler finito dentro de elasticidade e
  quadros reais, trim com mínimo persistente, remoção de opcional/deixas e atraso
  somente SOFT/WINDOW. Recusa PGM/CUE/itens/zonas protegidos. Conferência,
  requestId, revisão/auditoria atômicas e aviso pós-commit; painel do Master.
  18 casos novos +1 existente cobertos com replay de2 fixtures; tipos/build PASS.
  Integração70198 PASS: filler50→75 quadros realmente executado no PGM,
  cursor final74/EOS, reenvio sem duplicação, rollback/retomada354 frames.
  CUE não aprovado nesse ensaio null; falha inicial registrada. Evidência:
  `scratch/group04-operational-compensation-20261006.json`. Cobertura posterior
  das quatro ações no compilado/nativo81181 PASS: filler50→75 e VT125→75
  terminaram em75 frames/EOS, opcional pulado sem as-run, SOFT deslocado75
  frames sem mover FIXED; zona recusa sem nova revisão/alteração do PGM.
  Resultado e cleanup próprios persistidos; revisão original/retomada354
  preservadas. Falha90467 era zona da fixture sobrepondo25 frames do VT:
  recusa correta, limite ajustado sem mudar produto. Evidência:
  `scratch/group04-compensation-all-actions-native-20261006.json`.
  Faltam navegador/tempo remoto, concorrência, proteção/intervenção urgente
  e falhas no fluxo completo; CUE não aprovado nesta fixture sem preview.
  agora exige conferência de item/duração/revisão/ocorrência/configuração e
  requestId durável. Revisão/auditoria atômicas; reenvio não soma duas vezes,
  falha pós-commit não anuncia rollback. Interface bloqueia clique repetido e
  permite conferir a mesma solicitação.8 casos novos PASS em replay dirigido;
  tipos/build PASS, integração compilada/nativa19427 PASS (+120s/reenvio,
  PGM/rollback/retomada preservados). Evidência:
  `scratch/group04-live-duration-guard-20261006.json`. Não é aprovação visual.
  PASS com PGM preservado e timing recalculado/versionado. Não mede tempo de
  resposta nem homologa barra visual, filler/opcional/trim/aceitar atraso. Conflito com
  segundos exatos e ações para filler, opcional, trim ou atraso de 2–3 minutos,
  com recálculo imediato e proteção dos itens obrigatórios.
- 4.5 Retorno e auditoria: **em andamento**. Lote16/10 retomada NDI1109/OMT1112
  no último engine confirmada,3ocorrências com revisão/hash e PCM/pixels reais.
  Revisão publicada imutável e interrupção resolvida; não é concorrência/crash
  ou confirmação visual. Detalhes LIVE-PRIORITARIA-VT-2026-10-16.md.
  Retorno revisado por API confirmou
  Publicação urgente concorrente/aplicação única comprovadas no compilado e
  retomada357frames preservada; rollback com refresh falho informa commit
  gravado, UI não declara sincronismo. CUE protegido em contratos simulados;
  ainda não é ensaio físico/crash ou recuperação completa de edição divergente.
  VT no PGM desde cursor nativo registrado; as-run start_position coincide,
  pendência resolvida, revisão original preservada. Faltam decisões concorrentes,
  falhas/crash, publicação urgente e conferência visual. Retomar VT
  interrompido/posição conforme decisão, publicar alteração urgente protegida,
  auditar compensações e comparar plano/publicação/execução.

Fechamento: 5/5 no fluxo completo, sem reimplementar o resolvedor existente.

## Pendência 5 — Ingestão, mídia e aprovação

- 5.1 Jobs duráveis: **em andamento**.
  Mais recente09/10: limpeza reconhece apenas temporários conhecidos >24h de
  jobs não ativos; protege originais/archives/outputs, desconhecidos, links e
  ownership incerto. Raiz/arquivo reconferidos antes de remover; manutenção
  horária200 entradas com cursor (desconhecidos não bloqueiam continuação).
  QC exibe diagnóstico, exige confirmação de encerramento para FAILED legado,
  recusa tomar RUNNING e ignora resposta de seleção antiga.35 testes distintos
  relacionados PASS +2 de fixture antiga corrigida. Tipos servidor PASS;
  web inicialmente FAIL por fixture TRIM incompleta, reparada e PASS; build PASS.
  Nativo91053/iuXCfq PASS antes do cursor: crash/retomada/preview e remoção de
  um temporário real da queda envelhecido artificialmente25h, preservando
  original/archive/proxy por SHA e desconhecido. Cursor validado pelo caso novo.
  Servidor final9DAE3070: integração77433/h7Lgv1 PASS com scanner/probe/proxy
  reais, publicação/TAKE nativo/negativas de QC/perfil/as-run; PGM saída null.
  Falta homologar controles de diagnóstico/confirmação/retry/seleção no navegador.
  Não é homologação de CUE, QC visual, hardware ou instalador. Não há remoção
  automática de versões arquivadas. Evidência:
  scratch/group05-partial-cleanup-job-diagnostics-20261009.json.
  Resultados anteriores abaixo são histórico, não checklist atual a repetir.
  Avanço posterior09/10: owner_host usa identidade opaca do SO (não hostname)
  e servidor revisita a fila a cada2s.28 casos relacionados/tipos/build PASS;
  servidor21F6DDE7. Ensaio compilado71888/GG6udF PASS: segunda instância
  preserva claim vivo; SIGKILL do primeiro+handle nativo encerra, job mantém
  RUNNING/hashNULL, segundo recupera automaticamente mesmo job1→2/READY;
  cópia confere SHA original, bytes HTTP do preview conferem SHA persistido,
  1201 buffers vídeo5627 áudio426x240/10fps; READY persiste em nova reinicialização.
  Apenas banco temporário e filhos próprios, cleanup sem falha. Não comprova
  scanner/QC/PGM/browser nem HA de duas máquinas. Falta limpeza segura de
  parciais órfãos/retenção, diagnóstico de ownership legado/incerto e fechamento
  integrado. scratch/group05-compiled-server-job-recovery-20261009.json.
  r26 permanece intacta; este código/build é posterior e não consta dela.
  Lote09/10: migração35 identifica host/PID/boot; claim atômico, retomada
  somente com morte local comprovada, sem reset dos jobs de outro worker vivo.
  Legado sem identidade exige conferência/retry manual. Close libera apenas
  seu claim após drenar cópia/child; close do app sem flush conserva SQLite
  até concluir. Rodada35 casos:33 PASS/2 FAIL de fixture/estado esperado;
  corrigidos ambos, replay2 PASS, novo caso de lifecycle1 PASS, tipos PASS.
  36 casos distintos cobertos no lote, sem somar replay como casos novos.
  Nativo65284/az1e7B PASS: crash real do worker preserva RUNNING/hashNULL;
  processo novo retoma mesmo job1→2/READY,601 buffers vídeo/2815 áudio.
  Não é crash do servidor compilado inteiro. Registro:
  scratch/group05-media-job-ownership-r26-20261009.json.
  r26 empacotada ANTES deste replay, sem testes prévios, não homologada.
  Falta prova com servidor compilado inteiro, proteção por identidade de
  máquina (hostname sozinho pode se repetir), limpeza segura de órfãos e
  fechamento integrado scanner/QC-PGM/browser. Não é redundância entre hosts.
  Cópia incompleta real em disco62045 PASS: metade do vídeo recusada, proxy
  dependente sem iniciar, nenhum arquivo disponível/part removido; completar
  e retry mantém edição/IDs e confere hashes+vídeo/áudio.98580FAIL era contador
  da fixture (retry manual renova orçamento), corrigido só esse caso. Não
  aprova scanner/QC/publicação/PGM ou cancelamento durante leitura ARCHIVE.
  `scratch/group05-real-incoming-copy-20261008.json`; fechamento integrado aberto.
  Diagnóstico posterior do crash: monitor preparado antes, handle vivo antes
  do SIGKILL confirmado; saída do kernel18ms após pedido (código0 explicitado),
  job permaneceRUNNING/hashNULL, novo worker retoma mesmo ID1→2 e vídeo/áudio.
  51093 PASS, critério corrigido de exit1-only para processo+estado+recuperação;
  falhas anteriores preservadas, não é replay da mesma asserção. Produto/tests/
  build inalterados. Falta servidor inteiro/QC-PGM/browser/cópia real e limpeza
  segura de parciais órfãos. `scratch/group05-crash-observer-recovery-20261008.json`.
  Temporários agora isolados por UUID/tentativa;16 testes/tipos/build35783709
  PASS. Crash nativo90831 FAIL e replay53611 FAIL (fixture60s), monitor EXIT:0;
  não comprovado cancelamento precoce nem recuperação pós-crash. Não afrouxar
  gate; causa ainda exige correlacionar tempos de saída/entrega do monitor.
  `scratch/group05-attempt-isolation-crash-20261008.json`. Cópia real em disco,
  crash completo e QC-PGM/browser continuam no fechamento integrado.
  Lote posterior protege proxy nativo por --parent-pipe/EOF; servidor mantém
  pipe.15 testes/tipos/build servidor e1 teste/build proxy PASS.97339/fpSj1F
  PASS confirma recusa EOF exit1 e retomada controlada do mesmo job com vídeo/
  áudio; cópia cancelada/mesma versão retomada em teste com stream controlado.
  Falta crash abrupto, isolamento parcial por tentativa/cópia de disco real,
  servidor compilado/QC-PGM/browser; pacote final deve incluir proxy atualizado.
  Evidência `scratch/group05-copy-cancel-proxy-parent-20261008.json`.
  Avanço posterior: close aborta cópia/proxy e espera limpeza, ticks aguardam
  mesmo worker; flush espera fila antes do SQLite.22 testes/tipos/build PASS;
  native51615/hTUbH6 PASS: parada controlada de proxy real, child encerrado e
  parcial removido, novo processo retoma mesmo job/tentativas1→2 e produz
  vídeo/áudio válidos. Falta crash abrupto/cópia incompleta/servidor inteiro e
  QC-PGM integrado; `scratch/group05-worker-drain-restart-20261008.json`.
  Histórico: lote impede PENDING eterno após
  interrupção na terceira tentativa, isola metadados corrompidos e retoma proxy
  dependente após cópia recuperada.32 testes afetados/tipos/build servidor PASS.
  Ainda falta fechamento integrado: cópia incompleta,
  restart, concorrência, validação e disponibilidade só após estado permitido.
- 5.2 Versões de mídia: **concluída no escopo de versionamento/execução**.
  Caminho obrigatório/SHA canônico, cópia e proxy vinculados à edição; contratos
  antes/durante geração e integridade documentados nos lotes anteriores.
  Fechamento integrado58729 F5ReKl PASS: scanner real troca original durante
  PGM, mesmo ativo/nova edição PENDING; archive aprovado antigo preservado e
  executado no TAKE nativo. QC/preview stale409, aprovação/bloqueio por hash,
  nova publicação recusada enquanto substitui a mídia no ar; STOP explícito,
  reaprovação/publicação nova/TAKE e as-run com hashes/revisões distintos.
  Snapshot antigo imutável. Não é fechamento visual/QC rigoroso/retention/HA.
  `scratch/group05-compiled-source-replacement-20261008.json`.
- 5.3 Proxy: **em andamento**.
  Lote posterior de cache: migração34 grava SHA da saída, cache alterado/
  ausente/sem identidade bloqueado e job marcado para retry; legado precisa
  regenerar sem apagar originais.30 testes afetados/tipos/build servidor PASS,
  native65891 PASS: corrupção real bloqueada, proxy regenerado com vídeo/áudio
  e SHA persistido confirmado,2 edições preservadas. Evidência
  `scratch/group05-proxy-cache-integrity-20261008.json`. API/proxy/QC/PGM
  integrado69193 PASS e troca de versão58729 PASS. Reinício/cópia incompleta
  possuem provas nos lotes anteriores; falta fechamento do fluxo completo
  com falha do servidor e navegação/performance visual/remota.
  Histórico: worker verifica SHA da cópia antes/depois de
  gerar; saída vazia falha sem READY. Testes de contratos PASS; falta fechamento
  completo de geração, cache e versão corretos;
  navegação econômica e inspeção de origem em qualidade quando solicitada.
  Ensaio84864 PASS: dois vídeos reais/2 versões/4 jobs READY; versão antiga
  preservada, proxy426x240/10fps com áudio48kHz estéreo decodificado.115230bytes
  em3.1s (~297.37kbps médios do arquivo, não tráfego medido). Fonte do workflow
  com binários nativos, não API compilada/browser. Falta integridade de cache,
  aprovação visual e fluxo integrado; `scratch/group05-workflow-proxy-20261008.json`.
- 5.4 QC por canal/perfil: **em andamento**. Corrigida avaliação de cadência,
  geometria/duração inválidas e NaN/Infinity em comparações.162 testes afetados,
  tipos/build servidor/web PASS; aprovação409 sem decisão/auditoria/revisão falsa
  para sonda com zero. Fluxo integrado real scanner/proxy/QC/publicação/TAKE
  PASS69193 amP8jH: recusas409 preservam PGM, reaprovação libera segundo TAKE,
  HTTP proxy com SHA correto e áudio/vídeo reais; as-run SHA/revisão corretos.
  `scratch/group05-compiled-ingest-qc-take-20261008.json`. Falta mudança após
  aprovação visual. Matriz de perfis e política de legado tratadas nos lotes
  seguintes. `scratch/group05-qc-numeric-eligibility-20261008.json`.
  Troca integrada do original58729 F5ReKl PASS: nova edição PENDING; QC/preview
  antigos409; archive e aprovação antigos preservados para TAKE publicado.
  Publicação da nova mídia durante PGM recusada409; após STOP/reaprovação,
  nova publicação e TAKE reais com novo SHA/as-run; snapshot antigo preservado.
  `scratch/group05-compiled-source-replacement-20261008.json`. Não é CUE/UI.
  Lote posterior98607 Vv1Phl PASS: CUE de arquivo entrega imagem real320x180
  sem ampliar180p até240p; BLOCKED e alteração do perfil após CUE recusam TAKE
  implícito409, preservando PGM/origem e seleção de CUE. Reaprovação/restauração
  do perfil permitem TAKE/as-run nativos. Fixture corrigida de240p obrigatório
  e contraste do padrão ball para barras, falhas preservadas. Sem mudança de
  produto/build ou regressão ampla. Não é browser/hardware.
  `scratch/group05-compiled-cue-qc-profile-20261008.json`.
  Perfil/loudness08/10: medição obrigatória só FILE; TRIM, outro hash quando
  declarado, LRA/data/LUFS/pico inválidos recusados. Matriz API individual de
  codec/geometria/FPS/scan/áudio/duração/loudness; erro técnico não permite
  ressalva nem decisão/auditoria falsa.198 testes6files97698/tipos/build92810
  PASS,server7C04487A/web378DFA47. Sonda real22758 Yhfffm: codecVP8/fullprofile,
  FILE -26.650LUFS/-25.783dBTP; limites incompatíveis recusam aprovação/TAKE409
  preservando PGM, restaurar perfil permite TAKE/as-run. Não é certificação
  metrológica/norma nem UI/hardware. Falta aprovação visual e política explícita
  de legado sem probe completo. `scratch/group05-qc-profile-loudness-contract-20261008.json`.
  Política posterior explícita requireProbe: canais novos pela API rigorosos;
  perfis existentes mantidos, UI distingue compatibilidade (não prova metadados)
  de análise completa. Codec/duração/scan/declaração áudio desconhecidos não
  aprovam no modo rigoroso; silêncio declarado permitido só se perfil permite.
  Omissão do campo por cliente antigo preserva valor atual. Sem aprovação
  automática nem alteração do decoder no ar.210 testes7files26744/tipos/build
  54525 PASS;server1BE7A898/webC0DEAEC3. Native15765 R1g9jU PASS: metadado de
  codec legado emulado na base isolada, vídeo/decoder reais; rigoroso recusa
  QC/TAKE mantendo PGM, cliente antigo não desativa, opção explícita compatível
  permite reaprovação/TAKE/as-run. Política resolvida; falta homologação visual.
  `scratch/group05-explicit-probe-policy-20261008.json`. r24 não atualizado.
  Fechamento integrado: codec, formato,
  FPS/interlace, áudio/loudness/duração, aprovação/ressalva/reprovação e bloqueio
  de PGM, incluindo mudança de QC após conferência anterior.
- 5.5 Tracks/mixes/trims e ignorados: **em andamento**. Lote áudio46 casos/
  tipos servidor PASS; nativo30088 IDmQiZ PASS com segunda trilha real no PGM
  (20dB abaixo), trilha1 congelada, AUTO de outra trilha recusado sem mutação,
  medição persistida após reinício e AUTO no PGM -23,210LUFS. READY adulterado
  e encerramento tardio protegidos. Evidência:
  `scratch/group05-audio-measurement-integrity-20261008.json`.
  Ignorados real31981 cJdmcs PASS:75 buffers vídeo/152 áudio, PNG ignorado
  excluído pelo filtro compartilhado, bytes preservados, único vencedor,
  ETag/auditoria/fallback/reinício protegidos. Limpar falhas somente probeError;
  erro do segundo arquivo emulado explicitamente, não falha real do decoder.
  `scratch/group05-real-ignored-media-20261008.json`. Catálogo seed/PGM simulado,
  sem aprovação visual. Lote FILE/TRIM187 casos distintos validados após
  replay dirigido7 (186 PASS/1 FAIL inicial);tipos/build PASS. AUTO DEFAULT
  não usa números enviados pelo cliente; medição FILE válida vem do acervo.
  Resolvedor não reutiliza TRIM sem identidade de corte como FILE. Native83017
  ztF6kl PASS PGM -23,225LUFS ignorando TRIM adulterado do cliente.
  `scratch/group05-file-auto-trim-scope-20261008.json`. Diálogo avisa limites
  da projeção de arquivo inteiro. r25 anterior preservada. Falta fechar
  Aplicado lote09/10 nativo/API de medição de trecho:
  `scratch/group05-native-trim-measurement-20261009.json`,47 testes/tipos/build
  PASS.23432 z9OKah PCM real96000 amostras/metade e diferença20LU;50058 RGiMsg
  API compilada salva corte1–3s sem mudar revisão.65492 FAIL arredondamentoPTS
  corrigido por relógioPCM, não por aceitação de áudio incompleto. Falta controle
  na tela/aplicação era o próximo passo, integrado no lote posterior:
  `scratch/group05-trim-auto-ui-contract-20261009.json`.329 casos distintos,
  tipos/build PASS; UI FILE/TRIM e ganho por job/corte exato em todos os alvos.
  Publicação/cadence/specEngine e timing recusam corte divergente. Native61464
  mGpi1t PASS medir/aplicar/publicar/TAKE1–11s→PGM -23,298LUFS; mudou corte,
  aplicação/publicação409 mantêm PGM montado. Schema de projeto preserva vínculo.
  Falta aprovação visual; controlador falhou em09/10 nas duas tentativas com
  helper_unknown_error, sem ações na página. Auxiliares físicos continuam
  nas frentes de sinal, não provados por medidor master. r25 não contém o lote.
  auxiliares físicos multicanal permanecem sem prova. Engine aplica decisão
  aprovada; Ignorados só lista vídeos e limpeza conserva arquivos,
  publicações/as-run e vínculos protegidos.

Fechamento: 5/5. Importar qualquer formato de vídeo foi reservado pelo operador
para **v2.5**, fora da contagem de fechamento desta versão; documentar formatos
efetivamente suportados/testados, sem prometer todos.

## Pendência 6 — Segurança, contratos e administração

- 6.1 Mutadores editoriais restantes: **em andamento**. Categorias/cores, raízes/scan
  Atualização18/10: leitura parametrizada de conferência de categoria corrigida
  sem ampliar mutação global;66testes/tipos/buildPASS3BBAC965. Wc3h3sPROCESS+
  rotas reais/independentePASS autoridade/revisões/rollback/remoção, nãoHTTP,
  backends independentes/PGM. CATEGORIAS-AUTORIDADE-BANCO-PROCESSO-2026-10-18.md.
  Demais mutadores/aprovação visual/operacional continuam abertos.
  Atualização15/10posterior: lote metadata/impacto/artes/faixas/grafismo234casos,
  visuaiszdTFwK/i9LzXE PASS no escopo documentado; agora emr70parcial. Não
  certificarinstalação/remoções/concorrênciavisual/sinais poresses ensaios.
  EDITORES-LOTE-INTEGRADO-2026-10-15.md contém limites e provas atuais.
  Atualização15/10: scanner comconferência10s/consentimento inline/UUID preservado,
  39testes+visuallDk7DU PASS no escopo de pastasQA vazias e resposta perdida.
  Metadata/remoção/arte/regras e integração completa permanecem abertos;
  SCANNER-CONFIRMACAO-VISUAL-2026-10-15.md; fonte posterior àr69.
  e integrações com autorização fresca, revisão original e auditoria atômica.
  Contas, fontes, metadata, templates e remoção já têm etapas implementadas.
  Lote09/10 categorias/cores: migração36 revisa categorias e vínculos de mídia,
  same-value/ABA/tombstones; GET privado fornece ETag original sem criação;
  SET/DELETE recusam alteração cega/desatualizada/extra/conta restrita ou revogada.
  Remoção+desvinculação+auditoria na mesma transação; falha reverte todos;
  refresh pós-commit não finge rollback. UI abre conferência, preserva draft,
  exige reabrir após falha e não apresenta consulta ausente como lista vazia.
  15 casos distintos PASS:13/14 iniciais, fixture de papel incorreta reparada,
  replay1 PASS +migração1 PASS (não somar replay). Tipos/build50573 PASS;
  compilado82026/Gd7RT2 PASS com dois servidores, uma gravação concorrente,
  prova stale/vínculo same-value/audit rollback/permissão/revogação/restart,
  arquivo original preservado. Fixture não reproduzível; não testa PGM ou UI.
  Evidência scratch/group06-category-original-review-20261009.json.
  Lote09/10 integrações: migração37 e conferência original privada de catálogo,
  destino e entrega; autorização fresca e cadastro/edição/teste/reenvio com
  auditoria atômica. Teste é comando durável deduplicado, não POST inline nem
  confirmação remota. Worker reclama host/PID/boot, preserva dono vivo/incerto,
  retoma somente morte local comprovada e ignora resposta tardia de outro dono.
  Destino congelado, ID estável, envio at-least-once; destinatário deduplica.
  Shutdown aguarda fila de mídia e HTTP antes de fechar SQLite. UI exige
  conferência explícita e não apresenta erro de refresh como rollback.
  25 casos distintos PASS:22/23 iniciais, lifecycle await ajustado e replay
  dirigido1 PASS; casos novos de shutdown HTTP e migração PASS, sem somar replay.
  Tipos/build65412/15552/44944 PASS; server5C53C38A/web8AFBD047.
  Compilado65159/9Gv200 PASS dois servidores e gateway HTTP próprios: claim
  vivo não tomado, comando repetido uma entrega/POST local, confirmação204,
  stale/audit rollback/revogação/restart e segredos protegidos. Não browser,
  gateway externo, transmissão ou exactly-once. Evidência
  scratch/group06-integration-original-review-20261009.json.
  Falta raízes/scan e homologação visual de categorias/integrações; diagnóstico
  operacional de owner remoto/incerto continua6.5. r26 anterior preservada.
  Lote posterior09/10 raízes: migração38, conferência original privada da lista
  e candidato; inicialização explícita, consultas não criam pasta/cadastro.
  Identidade real do diretório/dev/inode e caminho absoluto com Unicode são
  reconferidos no commit; same-value/ABA invalida prova. Cadastro/remoção e
  auditoria atômicos, autorização fresca/global; última pasta, arquivos e
  referências preservados. Ambas telas exigem conferência explícita; drafts
  preservados sem auto-rebase. Cadastro não dispara varredura cega; PROCURAR
  separado continua disponível até integrar o fluxo auditado de scan.
  44 casos distintos PASS:41/42 iniciais53299, fixture content_hash corrigida,
  replay dirigido1 e novos migração/markup2PASS29211. Tipos/build29462 PASS;
  serverDA2932B5/web33FF2EAE. Compilado31423/UjYpv0 PASS dois backends, uma
  alteração concorrente, Unicode, consulta sem cadastro, stale/same-value,
  audit rollback/escopo/revogação/restart/arquivo e asset preservados. Não
  vídeo/scan/PGM/hardware/browser; scratch/group06-root-original-review-20261009.json.
  Falta comando de varredura com prova original/registro durável/audit atômico,
  posse/recuperação e shutdown do scanner, reintegrar busca imediata via fluxo
  auditado e homologação visual das três interfaces.6.1 ainda em andamento.
  Lote posterior scanner: migração39 owner host/PID/boot, claim global/FIFO
  atômico e retomada do mesmo ID somente após morte local comprovada. Donos
  vivos/remotos/desconhecidos/EPERM não tomados; lote legado RUNNING preservado.
  Cancelamento aguarda hash/children, devolve PENDING e resposta tardia não
  altera sucessor. Probe nativo --parent-pipe encerra no EOF; miniaturas por
  encarnação. Flush/close esperam scanner/reconciliação/mídia/HTTP antes do DB.
  29 casos distintos PASS29421/27630/78535; tipos/build servidor PASS, probe
  release PASS. Server7A0A777E/probe6A5D00E6. Native6923/1m01ajPASS:50 buffers
  vídeo/95 áudio, HTTP próprio preso com helper vivo, EOF exit1 em16ms e original
  preservado. Compilado44998 FAIL: roteiro criou segundo RUNNING enquanto a
  procura automática estava ativa; replay dirigido65039/dP8yBQPASS observa
  lote real, peer não toma, mata só servidor próprio na espera de estabilização
  de timestamp, sucessor retoma mesmo ID e probe lê vídeo/áudio reais. Uma
  varredura, hash preservado. Não é cópia grande real nem crash durante probe
  ativo; não browser/PGM/hardware. Evidência
  scratch/group06-ingest-worker-ownership-20261009.json. Falta comando scan
  conferido/durável/UUID/audit, status compartilhado e diagnóstico owner6.5,
  busca imediata integrada, crash com probe ativo e homologação visual/pacote.
  Lote comando scan: migração40 revisa fila/same-value/ABA; GET privado de
  raízes/estado, POST estrito com UUID, modo e somente raiz cadastrada. Auth
  fresca/global, PENDING+audit atômicos; dedup devolve mesmo ID/estado real,
  UNKNOWN se linha ausente, não supõe sucesso. Worker iniciado após commit;
  falha de início separada do registro. Status global mostra lotes ativos,
  progresso local separado; UI abre conferência, retém prova/UUID após falha,
  sem retry automático/rebase e não anuncia leitura iniciada ao abrir painel.
  27 distintos PASS (26 lote83579 +migração1), tipos/build59205 PASS;
  UI sessão/StrictMode tipos/build52990PASS. ServerEF17BDA6/web3A112441;
  probe6A5D00E6 inalterado. Compilado75028/F104qJPASS dois backends, mesmo
  comando gera um lote/audit, stale recusado, audit falho reverte counter/lote,
  dedup informa COMPLETED real e persiste restart, sessão revogada recusa replay;
  scanner/probe reais preservam vídeo/áudio/hash. Não browser/PGM/hardware.
  scratch/group06-scan-command-original-review-20261009.json. Falta busca
  imediata atômica da nova raiz, diagnóstico/recovery owner6.5, crash com probe
  ativo e homologação visual/pacote. r26 anterior preservada;6.1 ainda aberta.
  Lote root+scan atômico: nova pasta+PENDING dirigido rápido+ambas auditorias
  na mesma transação; sonda ausente explícita, dono vivo/incerto preservado,
  próximo FIFO iniciado após liberação sem esperar60s. UI mostra ID/estado;
  falha pós-commit não simula rollback e consulta/contadores de outra instância
  não presumem leitura vazia.71132:22/26PASS,4FAIL reais por tx.$client
  inexistente; reparado para db.$client na mesma transação, replay4PASS81258.
  26 distintos cobertos, não30. Tipos76216FAIL pela mesma causa; após reparo
  tipos/build81258PASS; polling web37092PASS. Server8CB3297D/webE452293B,
  probe6A5D00E6 intacto. Compilado35822FAIL no roteiro de leitura direta de
  audit criptografado; decoder normal usado sem retirar criptografia, replay
  5275/8ptTGPPASS peer preservado, uma raiz/lote/ambas audits, stale não duplica,
  audit falho reverte todos/counters e ambos scanners/probes reais concluem
  vídeo/áudio/hash em6805ms após liberar anterior, sem timer60s. Timestamp
  controlado, não cópia grande real; não browser/PGM/hardware. Evidência
  scratch/group06-root-scan-atomic-20261009.json.6.1 falta aprovação visual
  e fechamento integrado das interfaces; diagnóstico/recovery incerto6.5,
  crash durante probe ativo e pacote continuam abertos. r26 preservada antiga.
- 6.2 Comandos operacionais restantes: **em andamento**. Show/hide/layers, emergência,
  failover forçado e demais comandos distinguem aceitação, execução e falha.
  Atualização19/10: auditoria confirmou que failover aqui era somente papel em
  memória e ainda mudava antes de SQL confirmado. Corrigidos ordem/dedupe/recibo
  nos4aliases; requer Idempotency-Key, sem chave428.32testes e PROCESSnwp9KhPASS,
  não PGM nativo. Fonte4E3FF51C; FAILOVER-METADADOS-AUDITORIA-2026-10-19.md.
  Falta ligar decisão ao engine com par/autoridade/primeiro quadro, preservar
  PGM em falha, estados de execução incerta/crash e fluxo remoto/visual.
- 6.3 Contas e sessões: **em andamento**; fechamento integrado/visual aberto. Expiração,
  revogação, papéis/canal/estação, bootstrap e administração; preservar SEC-22B/G.
  Lote integrado14/10 compilado5F33C58E PASS: concorrência/rollback auditado de
  cinco mutadores, últimoadmin/ABA/stale, revogaçãoHTTP/WS4401 e persistência
  após restart; expiração controlada+falhaaudit+diagnóstico seguro, papelinválido.
  139 casos/10 arquivos/tipos/build PASS. PGM/PVW simulados/semnavegador remoto
  ou pacote; fechamento visual completo ainda aberto. Documento
  SEGURANCA-INTEGRADA-CONTAS-2026-10-14.md, evidências próprias separadas da r67.
- 6.4 Segredos e fronteiras de acesso: **em andamento**. Lote HTTP/log/cache
  Lote posterior de origens: parser explícito compartilhado recusa configuração
  inválida antes de criar app/DB/runtime;45 casos/tipos/build PASS e compilado
  ac50DO confirma5 partidas recusadas,17 casosHTTP e3 WS, com autenticação
  preservada. Host agora implementado/provado no compiladobnigjr:6 partidas
  inválidas,18HTTP/3WS,57 casos dirigidos/tipos/build PASS; localhost/nomes/IPs
  reais na porta local, aliases explícitos e recusa antes de auth/static/CORS.
  DNS/proxy/TLS/navegador remoto e auditoria integrada ainda não homologados.
  14/10 comprovado no compiladoYmdGq8: origem externa HTTP/WS negada, logs INFO
  sem12 marcadores privados, controles no-store, mídiaRange206 preservada,
  erro auditado de login sem nova sessão/cookie e falha de backup sem caminho.
  Sem engine/host remoto/pacote instalado; falta auditoria integrada e políticas
  de origem/host/configuração/TLS e runtimes. Cofre,
  configuração privada, CORS, credenciais em logs/URLs/backup e acesso remoto;
  falta de runtime seguro recusa a ação, sem fallback permissivo.
- 6.5 Legado e diagnóstico: **em andamento**. Primeiro lote integrado:
  scanner distingue fila, processo local existente/encerrado, dono remoto,
  desconhecido, inconclusivo e intenção inválida, sem revelar PID/host/boot.
  Retomada explícita exige permissão atual, conferência original, encerramento
  local comprovado e auditoria atômica; mantém lote/raízes/modo e deduplica
  o pedido. Dono vivo/remoto/incerto e PENDING contraditório permanecem
  protegidos. 31 casos distintos PASS/5 arquivos; tipos servidor/web e build
  PASS42983. Após gerar instalador r27 sem testes funcionais do pacote, prova
  compilada40746/KnArvN PASS: dois servidores, morte real de filho próprio,
  donos protegidos, rollback de auditoria, stale same-value, dedup único e
  autoridade fresca/restart. Probe desativado intencionalmente: não scanner
  nativo/browser/PGM/hardware. Nenhum filho ficou ativo. Evidência
  scratch/group06-scanner-diagnostic-recovery-20261009.json. Falta aprovação visual,
  diagnóstico/reparo das demais reservas e migração de estados inconclusivos;
  nunca assumir canal livre, apagar checkpoint ou matar terceiros.
  Complemento51931/DlfX28 PASS: crash do servidor durante probe medido real,
  auxiliar observado por handle OS encerra82ms depois; código0 não é JSON ok
  nem prova de EOF1. Lote/cadastro abandonados preservados, sucessor termina
  mesmo pedido com vídeo/áudio/loudness/hash e sem duplicação.1 cenário distinto,
  não somar replays falhos: startup quick não medido, assert exit1 inadequado
  e observação45s insuficiente; prazo180s dirigido PASS. Nenhum produto/binário
  alterado nessa prova. Auditoria das transições automáticas do scanner foi
  implementada no lote seguinte: release/CAS de dono e intenção + auditoria
  criptografada na mesma transação; falha reverte posse/revisão e bloqueia claim.
  RUNNING inválido preservado sem consultar PID.40 distintos/6 arquivos/tipos
  servidor/build PASS84376. Compilado49962/GaDqpk PASS, duas instâncias próprias,
  scanner real em settle controlado, mesmo lote/audit único/cifrado/intent
  congelado; sucessor faz probe nativo real vídeo/áudio/hash preservado. Não
  replay de crash com probe ativo/browser/PGM/hardware; prova anterior mantém
  servidorAD9EAE62. Atual9BC72149/probe6A5D00E6, não consta da r27 imutável.
  Evidência scratch/group06-scanner-auto-recovery-audit-20261009.json. Faltam
  reservas restantes, migrações ambíguas e aprovação visual; próximo outbox.
  Lote outbox integrado: diagnóstico privado por entrega sem PID/host/boot;
  estado de dono vivo/morto local/remoto/desconhecido/incerto. SENDING sem dono
  não vira FAILED silenciosamente. FAILED legado inconclusivo preservado e
  checkbox não autoriza reenvio. Somente ESRCH local libera CAS+auditoria
  cifrada atômicos; erro reverte estado/posse/revisão e impede POST. Conferência
  da interface disponível para todos os estados.33 distintos/5 arquivos/tipos
  servidor/web/build PASS72609; atualserverFE797333/webE4C2DA7F. Compilado64600/
  xMtdQA PASS com duas instâncias/gateway HTTP local próprio: claim real protegido,
  crash do dono próprio, rollback audit sem POST, único audit e retry com mesmo
  ID/destino/payload; somente204 real confirma. Fixtures unknown/remote/legacy
  preservadas após restart e checkbox recusado. Não gateway externo/browser/
  PGM/hardware nem exactly-once. Migração37 preservada histórica, não reversão
  silenciosa de legado; reparo coordenado ainda falta. Evidência
  scratch/group06-integration-owner-diagnostic-recovery-20261009.json. Faltam
  demais reservas, reparo legado com prova do predecessor e aprovação visual.
  Overview integrado: lista mostra diagnóstico sem abrir cada pedido, sem
  PID/host/boot/target/payload; erro legado redigido só na resposta. Consulta
  read-only com autoridade fresca/canal de entrega e de configuração, filtros
  antes do limite100; conta restrita sem global/órfão/configuração estrangeira.
  GET private no-store, estado/revisão intactos, nenhum POST.29 distintos/5
  arquivos/tipos servidor/web/build PASS26363. Compilado70032/DpoF5W PASS,
  duas próprias+fixtures de estados/owner, restart e sessão revogada; nenhum
  HTTP no gateway próprio. Não claimHTTP real/browser/PGM/hardware; prova
  de envio anterior64600/FE797333 mantém atribuição. AtualserverB97378AA/
  web522BD006 não constam da r27. Evidência
  scratch/group06-integration-overview-scope-20261009.json. Faltam aprovação
  visual, diagnóstico/reparo das demais reservas e legado coordenado.
  Reservas channel/distribution: diagnósticos estruturados distinguem dono
  local/remoto, abertura inconclusiva, legado, liberação local, ensaio restaurado,
  trava nativa e bloqueio de outro canal. Registro inválido retorna409 privado
  genérico sem reparo. Instância de execução encerrada também mostra blocked;
  claims/releases/callbacks não foram afrouxados. Painel de consulta manual nos
  dois ambientes de configurações, sem liberação/promoção/polling; resposta
  antiga de canal ocultada por chave e geração.18419:64PASS/2FAIL expectativas
  novas erradas (UNCLAIMED apósclaim e frase SSR). Replay27115:4PASS, incluindo
  caso de seleção novo;67 distintos cobertos, não somar sobreposição. Tipos/
  build PASS; server9BDEFB10/web2E79965F. Compilado87140FAIL expectativa global
  inválida (short-circuit de canal já protegido); roteiro corrigido sem produto,
  replay74659/XGChS2 PASS dois próprios+fixtures, read-only, dados/cursor/asrun/
  audit intactos, privado/canal/sessão, invalid409 específico e global protegido.
  Não engines/sinais nativos/browser/PGM/hardware. Evidência
  scratch/group06-execution-distribution-diagnostics-20261009.json. Ainda falta
  reparo legado com prova autoritativa, aprovação visual e fechamento integrado.
  Evidência scratch/group06-ingest-active-probe-crash-20261009.json.

Fechamento: 5/5, com contratos restantes implementados e evidências auditáveis.

## Pendência 7 — Banco operacional separado

- 7.1 Serviço/worker e contrato: **em andamento**. Processo SQLite privado e
  bridge integrados ao adapter de Drizzle e à build. Compatibilidade integral
  ainda não homologada; faltam arquitetura/shutdown completos e pacote real.
  Atualização18/10background: shutdown passa a awaitAppClose; caso compilado
  gI0wvySIMocioso gravaSTORAGE_CLOSED assinado/Node0 e serviçosausentes, com
  originalFAILmarcador/independentePASS. Não drenagemocupada/engine/pacote.
  BACKGROUND-STORAGE-CONTENCAO-2026-10-18.md.
  Atualização18/10: contrato básico executado PASS3I35Cy com helpers compilados,
  dois serviçosdistintos/Unicode/prepare/run/get/all/raw/iterate, fechamento e
  ausência dos próprios PIDs confirmados. Conferência independentePASS, sem
  pacote instalado/PGM; não declara todas as operações/rotas compatíveis.
- 7.2 Concorrência e consistência: **em andamento**. Transações/savepoints e
  leituras no processo independente preservam o contrato atual. Duas conexões
  já exercitadas; faltam concorrência de operação, revisões dos mutadores e
  autorizações multiusuário reais.
  Atualização18/10categorias: mutador real/ORM com dois serviçosSQLitePROCESS e
  sessõesQA de dois usuários PASSWc3h3s+independente: revisão original200/409,
  auditúnico, escoporestrito403/sessãorevogada401, falhaauditrollback/remoção
  persistida. DuasApps no MESMO pai/injeçãointerna, não HTTP/backendsindependentes,
  loginreal ou todos os mutadores/PGM. Correção de conferêncialimitada/66casos/
  tipos/build3BBAC965PASS. CATEGORIAS-AUTORIDADE-BANCO-PROCESSO-2026-10-18.md.
  Atualização18/10posterior: competição entre dois atores/processosSQLite reais
  lendo mesma revisão0 PASS2mofBu; CAS aplica1/recusa1, uma revisão/valor/auditoria
  de FIXTURE, transaçãoatômica. IndepPASS semreplay. Não mutadores editoriais/
  permissões/sessõesmultiusuário/PGM; esses pontos ainda abertos. Relatório
  BANCO-CONCORRENCIA-COMMIT-INCONCLUSIVO-2026-10-18.md.
  Atualização18/10: savepoint revertido/transaçãoexterna commitada e visibilidade
  sequencial entre dois serviçosSQLite PASS3I35Cy; não competição simultânea,
  revisões/CAS ou multiusuário. BANCO-PROCESSO-IPC-2026-10-18.md.
- 7.3 Falha e recuperação: **em andamento**. Timeout/desconexão bloqueiam a
  conexão sem reenvio ou reabertura automáticos. Falta revisar queda com PGM,
  reservas e as-run para provar ausência de duplicação/efeitos posteriores.
  Atualização19/10: ensaio normal3IfSOg+leitor uAdExkPASS: timeout real30s e
  próxima partida compilada no mesmo banco retomam51, com intenção única,
  as-run RESTART e UPDATE incerto não reaplicado. Repetição de conteúdo desde
  o último cursor salvo é política expressamente aceita pelo operador, não
  autorização para duplicar efeitosSQL. Corrigida liberação antes de flush;
  faltam outros contextos/janelas de falha e integração instalada. Relatório
  RETOMADA-NATIVA-NORMAL-2026-10-19.md; servidorDF63B20A, sem encerrar7.3.
  Atualização18/10background: guard captura errosSync/Async/admissão, bloqueia
  tarefas da geração perdida/notificauma vez/semreopen;36casos/IPC BsZHwl PASS.
  Compilado gI0wvy permaneceFAIL de marcador, corpo/fechamento/storage conferidos
  indepPASS semreplay. NãoHTTP/PGM/concessões durante30s. ServidorFADFFB13;
  BACKGROUND-STORAGE-CONTENCAO-2026-10-18.md. Não encerra7.3 por proteção de timers.
  Atualização18/10timeout: zDOQJlPASS+independente, prazo REAL30s semresposta
  com transação não commitada; erro desconhecido, COMMIT/UPDATE recusados,
  encerramentofilhopróprio/efeito não persistido0. Chamador não recebe rollback
  fictício. NenhumPGM/HTTP testado; chamada síncrona bloqueia thread30s e impacto
  operacional/concessões permanece aberto. BANCO-TIMEOUT-TRANSACAO-PENDENTE-
  2026-10-18.md. Não encerrar7.3 por cobertura desses três ramos de fixture.
  Atualização18/10posterior: ACKrealautocommit retido por proxyQA, filho próprio
  encerrado/StorageDisconnected/banco mantém1/conexão inabilitada/novoUPDATE
  recusado PASS2mofBu+independente. Não rollback/sucesso fictício ou exactly-once
  operacional; não timeout/PGM/asrun/perda física de energia. Sete processos
  próprios ausentes. BANCO-CONCORRENCIA-COMMIT-INCONCLUSIVO-2026-10-18.md.
  Atualização18/10: oversized18MB inabilita primeira conexão e recusa UPDATE,
  segunda preserva3/sem4; processosencerrados e dados conferidos PASS3I35Cy.
  Não qualifica timeout, commit/crash inconclusivo, PGM/reservas/asrun.
- 7.4 Migração e latência: **em andamento**. DDL/cofre existentes mantidos;
  diagnóstico administrativo e latência por RPC integrados ao HOST. Falta medir
  carga, validar restauração e impacto operacional com engine.
  Atualização18/10: backupAPI/integ/FKs/schema/68tabelaslógicas PASS+independente;
  segunda conexão1.019RPCs média0,433ms/máximo230,951ms, abertura/migrations
  incluídas. Não produção/carga/P95/PGM ou legado; adapter validation=PENDING
  preservado. BANCO-PROCESSO-IPC-2026-10-18.md.

Fechamento: 4/4; arquitetura executável, não apenas proposta.

## Pendência 8 — Redundância de máquinas — ADIADA PARA V3

Decisão do usuário em12/10: não fazer agora. Todas as sete verificações abaixo
estão adiadas, fora do fechamento desta versão. Evidências e código parciais
anteriores permanecem como histórico, não como qualificação ou tarefa ativa.

- 8.1 Replicação para outro host: **adiada para v3**. Estado, mídia e as-run reais,
  consistência, integridade e autorização; teste local não fecha outro host.
- 8.2 Reserva apto: **adiada para v3; implementação parcial preservada**. Conferência API/UI de vínculos locais,
  plano cifrado/imutável, edição derivada isolada e relatório de montagens/QC
  integrados no código. Canal permanece arquivado/parado; preparo não é TAKE.
  Relatório inclui fallback de live, identidade local da entrada e dependências
  de grafismo, com motivos por item/revisão. Código/fixtures ainda NOT_RUN.
  Falta build e revisão consolidada, integração ao runtime de promoção, mídia/QC,
  tracks/mixes/trims e prova de sinal/decodificação das fontes locais.
- 8.3 Promoção executável: **adiada para v3; implementação parcial preservada**. Ponte privada da preparação ao
  candidato nativo integrada: ledger seleciona workspace, origem/cursor/plano
  cifrados correlacionados, variantes reproduzidas, posição/corte confirmados,
  mídia/runtime SHA e inventário local revalidados. Posse/recibo gráfico estrangeiros
  não viram confirmação local; intenção nativa separada do cursor parado. NOT_RUN.
  Falta conectar à admissão host/storage, engine/primeiro quadro/mixes/grafismos,
  grant nativo contínuo, saídas selecionadas, diário de promoção e API/UI auditados.
  Não existe TAKE/promoção liberados nesta ponte; promotionReady permanece falso.
  Orquestrador cifrado de promoção ligado ao HA, NOT_RUN: ator/UUID, fases antes
  dos efeitos, termo/admissão/cursor/primeiro quadro exatos e prova histórica;
  perda de resposta/parada não confirmada preservam UNCERTAIN, sem replay.
  Shutdown deduplica parada e aguarda diário. Adaptador nativo continua ausente
  no produto; falta conectar engine/admissão/saídas/API/UI e reconciliar incerteza.
- 8.4 Fencing externo: **adiada para v3; implementação parcial preservada**. Concessão subordinada de relay e
  expiração/guard nativos integrados ao supervisor/testemunha, ainda sem build
  e testes. Falta provar que partição não permite dois PGM/publishers e que o
  destino externo deixa de receber; trava Windows local não prova outro host.
- 8.5 Handoff e replicação reversa: **adiada para v3; implementação parcial preservada**. Admissão persistente e
  transferência autenticada explícita na testemunha com chave separada, UUID,
  termo/revisão esperados e expiração+margem integrados; NOT_RUN. Falta workflow
  do backend/engine/saídas, handoff planejado, as-run/checkpoints e mídia reversos.
- 8.6 Rejoin/failback: **adiada para v3; implementação parcial preservada**. Nó antigo não recebe nova concessão
  por expiração/restart depois da transferência; admissão/diário sobrevivem ao
  reinício e retorno exige transferência reversa explícita. NOT_RUN. Falta
  reconciliar execuções/edições/mídia, integrar operação de retorno e testar hosts.
- 8.7 Falhas físicas e RPO/RTO: **adiada para v3**. Host/rede/OS/energia, recuperação
  e continuidade medidas; sem declarar hot standby por fixture local.

Fechamento: 7/7 entre máquinas; só então habilitar prontidão de promoção.

## Pendência 9 — Recuperação e observabilidade

- 9.1 Histórico de saúde: **em andamento**. Histórico existente do host
  Atualização18/10: tabela GLOBAL agora navega por páginas120, com janela fixa,
  cursor exclusivo e cancelamento; parser comum/ACL mantidos.27testes/tipos/
  buildsisoladosPASS6A94FA68/E15DBFFB. HTTPcompilado FAILs preservados: listening
  observado, conexão localEACCES confirmada também em servidor mínimo próprio.
  EnsaioHTTP/browser/engine/load/retention não aprovados; não repetir por status.
  HISTORICO-GLOBAL-PAGINADO-2026-10-18.md. Histórico abaixo é anterior a este lote.
  Interface Engineering/HOST integrada: seleção de canal/janela e tabela
  operacional independente da consulta global; N-D/falha/legacy/truncado
  explícitos.44704:5testesSSR/API/tipos/buildwebPASS; web7464E269, server
  AE648587 intacto. Evidência group09-operational-history-ui-20261009.json.
  Falta aprovação interativa, enginecompilado/retention/load e navegação
  histórica completa (consulta atual120recentes avisa truncamento). Totais
  inalterados; código de UI não equivale a homologação visual/operacional.
  enriquecido a cada10s com canal/item/edição/execução/engine/fontes/saídas,
  CPU acumulada/RAM por processo quando disponíveis; dados ausentes null.
  URLs e IDs de QC com fonte embutida protegidos, snapshot limitado e truncado
  explicitamente; histórico por canal com ACL/REPORT_EXPORT, sem liberar
  recursos globais.11casosdistintos4files cobertos por reparos dirigidos,
  tipos/buildPASS15561; serverAE648587. Evidência group09-operational-metric-
  history-20261009.json. Falta integração visual, ensaio compilado com engine,
  retenção/carga e correlação física. GPU/disco/rede são do host, não por saída.
  Mudança explícita de status: pendente -> em andamento;53checks5/23/25.
- 9.2 Incidentes: **em andamento**. Alarmes persistentes, reconhecimento,
  limites para preto/freeze/silêncio e destino externo configurado quando exigido.
- 9.3 Backup/restauração real: **em andamento**.
  Atualização18/10: TAKE de HELD confirmado corrigido; dois testes nativos2/16
  canais/release PASS antes do último acréscimo de fixture. Sete casos puros de
  análise de movimento PASS; ensaio instalado/r88 e conferência independente
  NOT_RUN por limite do serviço de autorização. PGM-PAUSADO-TAKE-2026-10-18.md.
  Não fecha frozenPGM/STARTING/legado/energia por fixtures ou contador avançando.
  Atualização17/10posterior: DHY9cz reconcilia candidato já publicado sem
  reescrever perfil/TAKE; zJnVze/IZwzZ2 interrompem migração, inclusive durante
  escritas WAL verificadas, e recuperam por nova cópia sem apagar intenção.
  Conferências independentes PASS com rollback atômico45→45 e nova cópia→50,
  dados preservados/zeroativações,20mil/200milINFOs claramente sintéticos.
  FALHAS-MIGRACAO-E-PERFIL-R87-2026-10-17.md. Não é legado nativo ou energia;
  frozenPGM/unknownspawn/STARTING e homologações restantes seguem abertas.
  Atualização17/10: XSsny6/9u6OQd/zpPOhn e conferências independentes PASS no
  ciclo r86→r87→r86: backup online, dados novos de grade após atualizar,
  reconciliações explícitas, recuperação oficial da reserva da cópia, retomada
  real com pixels/PCM e novo backup depois de retornar. Origens preservadas,
  três segmentos/apenas um aberto; schema50/mesma conta/arquivo sintético.
  UPGRADE-E-RETORNO-R86-R87-2026-10-17.md. Legado nativo/frozenPGM/unknownspawn/
  energia e homologações restantes continuam separados; sem repetir caso aprovado.
  Atualização16/10r87: exportação autocontida explícita, restauração repetida e
  retomada nativa de snapshot r83 na r87 instalada PASScKg2O8, com conferência
  independente de recibos, histórico completo, cursor, pixels e PCM. R86→r83
  permanece FAIL6NN6PM/recusa segura conferida; não reclassificar como retorno
  a versão anterior. Prova de parada retida apenas na posse/registro exato,
  66testesafetadosPASS. RECUPERACAO-R87-2026-10-16.md; cenários restantes abertos.
  Registro assinado de instâncias.
  Atualização16/10: sXZyHf migra cópia autenticada45→50 de origem criada pelo
  binário histórico r30;65tabelas de origem/backup conferidas, sem PGM legado.
  M6lwbz interrompe adoção real, exige recuperação explícita da reserva e
  reconcilia perfil anterior sem TAKE/replay; provas independentesPASS.
  Ramo candidato publicado/perda de energia e demais combinações permanecem.
  Atualização16/10r83: backup online r80/UUID sem replay e restauração por
  ferramentas instaladas, STAGE/TAKE recusado, recuperação explícita de reserva,
  ACTIVATE/adoção, pixels/PCM/cursor/execução e as-run segmentado conferidos.
  Asserção independente MLIh8R PASS não reclassifica o roteiro FAIL por
  expectativa QA errada. Mesma máquina/conta/schema, arquivo sintético. Prova
  negativa r82 preserva origem/histórico; não cobre todos os gates abaixo.
  Cenário negativo compiled46615/pakt0d PASS: live sem vídeo, áudio real
  1408buffers/0vídeo, ativação recusada antes de HTTP operacional, FAILED
  assinado; cursor/asrun/receipt/edition/origin preservados e reserva liberada.
  Fonte sintética local, server6FEB705E intacto, sem repetir unidades/build.
  Evidência group09-restored-live-no-video-20261009.json. Falta frozenPGM,
  crashSTARTING/unknownspawn e homologação física; totais iguais/r28 intacta.
  Live restaurada agora exige vídeo recente PGM exato, não ACK/PVW. Ensaio
  LaA6Gn encontrou perda de executionId após ACK: corrigida marca de recovery
  até primeiro PGM. Replay64924/RSgpBk PASS com URI sintética tratada LIVE,
  cursor52->53/edição/execução/asrun e vídeo/áudio recentes preservados.
  145testesdistintos4files por lotes36+113 com4sobrepostos; tipos/buildPASS
  após reparar import/readonlyfixtures. Evidência group09-restored-live-
  activation-20261009.json. NÃO homologa redeNDI/OMT/SDI. Falta compiledlive
  sem vídeo, frozenPGM e unknownspawn; r28 anterior, totais inalterados.
  Recuperação de reserva após queda integrada por comando offline explícito,
  sem timeout/promoção: manifesto/cofre, exclusão nativa e encerramento local
  confirmados.64testes/tipos/buildPASS49087;26505/VGeZHU compiledPASS stagecrash,
  repairvivo recusado, liberaçãoauditada e snapshotCP/asrun/owner/origin/receipt
  preservado. STARTING/rollback unitcobertos, não crash exato compilado; spawn
  inconclusivo continua bloqueado. Evidência group09-restored-reservation-
  recovery-20261009.json; r28 não contém esse comando, totais inalterados.
  Continuação40648/icxJWi: backupAPI durante TAKE/PGM nativo real, queda
  própria/engine encerrado, restoreCLI + ativação retomam posição49, corte
  25..725/edição/execução/rate/audio, nova posse e confirmação assinadas,
  asrunRESTART/start49 e STOP confirmados. Probe real750vídeo/1408áudio;
  mídia sintética/saída nula, não sinal físico. Evidência
  group09-restored-playing-activation-20261009.json. Falta quadro pausado,
  lives restauradas, reserva incerta e homologação final. Totais iguais.
  Atualização09/10: --activate-restored integrado com reserva/fence mantidos,
  revalidação e diário44 assinado; origem arquivada com auditoria atômica.
  64 testes/tipos/buildPASS70344. r28 gerada sem novos testes funcionais antes
  do empacotamento; depois88940/EhhStp compiledPASS com engine real/saída nula.
  Caso idle sem cursor playing e sem TAKE: não prova retomada PGM. Falta
  retomada real playing/corte/áudio/primeiro quadro, frozenPGM pausado (ainda
  recusado/preservado), lives e reserva interrompida. Evidência
  group09-restored-native-activation-20261009.json. Totais inalterados.
  Histórico das etapas anteriores abaixo, com evidência atribuída à sua fonte:
  Handoff do backend em quarentena integrado: --stage-restored com reserva
  MAINTENANCE retida, mesmo hostFence/processo, capacidade local/uso único,
  registro e auditoria atômicos.32 testes/tipos/buildPASS; compilado10776/xSm9g5
  PASS peer mesmoDB e outroDB recusados, fechamento do produto libera reserva
  e assina storage fechado. Evidência group09-restored-backend-handoff-20261009.
  json. Ainda NÃO ativa PGM nem workers: falta etapa auditada de ativação,
  revalidação e recuperação nativa/sinal live; crash da reserva continua
  protegido. Totais de fechamento não mudaram por essa admissão intermediária.
  Registro assinado de instâncias
  Preparação offline compilada review-restored.cjs integrada: reserva42,
  host guard real, recibo43, predecessor, edição/cursor/corte/cadência/áudio,
  QC atual por canal e SHA archive/cache/original.39 casos distintos cobertos
  por29PASS+replay10; tipos/buildPASS;23966/fwuRzk compiled PASS sem engine/TAKE.
  Resultado REVIEWED_NOT_ACTIVATED: libera reserva ao terminar e não autoriza
  handoff. Falta comando de ativação efetivo com fence/admissão/auditoria e
  retomada nativa/lives reais. Evidência
  group09-restored-execution-preparation-20261009.json; totais inalterados.
  Registro assinado de instâncias
  Lote43: recibo imutável/assinado vincula relatório ao banco restaurado; segunda
  recuperação preserva histórico e exige identidade nova. Manifesto protegido
  anterior não corresponde ao novo banco.33 testes/tipos/build e CLI compilado
  yPCRzW PASS (sem iniciar servidor), evidência
  group09-restoration-receipt-binding-20261009.json. Falta integrar verificação
  ao comando suportado de ativação, posse nativa/host/canal/mídia/QC/cursor e
  handoff; recibo de quarentena não comprova promoção ou parada. Totais iguais.
  Registro assinado de instâncias
  agora integrado à reserva durável de manutenção42 e migrações/registro
  atômicos.57 casos distintos cobertos (56PASS+replay de1 fixture antiga),
  tipos/build e compilados aleVtT/FoNBgd PASS; evidência
  group09-storage-maintenance-admission-20261009.json. Nova partida recusada
  durante reserva; só detentor libera, sem timeout/roubo. Restauração preserva
  registros assinados, edições/cursor/asrun/filas. Falta comando de ativação,
  handoff protegido, fence nativo contínuo e prova de posse/mídia/QC/cursor;
  reserva de armazenamento não é homologação nem promoção. Totais inalterados.
  Registro assinado de instâncias
  integrado (migração41), sem confundir fechamento do banco com morte do
  processo ou parada do engine.27 testes/5 arquivos/tipos/build PASS35435;
  restore compiladoBeHU38 PASS e dirigido78772/9adpXk com dois servidores PASS.
  Saída de um não libera o outro; backup conserva assinaturas, consulta não
  reclassifica. Evidência group09-server-instance-lifecycle-20261009.json.
  Falta liberação operacional com admissão atômica, posse nativa/host/canal e
  validação mídia/QC/cursor; nenhum total fechado por esse pré-requisito.
  Serviço recuperado com cofre,
  referências e mídia; gerar arquivo de backup não comprova restauração.
  Lote09/10: validação readonly também cobre revisões36/37/38/40, migrações
  incompletas, contadores, triggers presentes e versões de entregas/tombstones.
  21 testes distintos/6 arquivos, tipos e build servidor PASS24336; evidência
  scratch/group09-backup-revision-validation-20261009.json. Faltam retomada do
  servidor compilado restaurado, abertura do cofre e mídia real preservada em
  ensaio isolado; não foi homologado. r27 é anterior a este lote.
  Atualização09/10:97089/RK41Lv PASS retomada+restart do compilado em DB novo,
  backupAPI/scanner/probe Unicode reais (50 vídeo/97 áudio), vaultcopy mesma
  conta Windows, chave errada recusada, sessão/mídia API/hash/fila preservados.
  Outbox quarentenado não recupera/envia;14 testes/tipos/build PASS92452,
  server57D3C16C. Evidência group09-backup-service-restore-20261009.json.
  Falta workflow de restore/upgrade suportado, ensaio de revisões publicadas,
  as-run/checkpoints/jobs e política segura de retomada. Sem físico/outro host/
  conta/Windows limpo. Roteiro anterior falhou ao pedir runtime bloqueado;
  reparo dirigido consultou grade editorial, sem liberar execução.
  Ferramenta suportada adicionada: restore-backup.cjs+launcher do próximo pacote,
  pasta nova exclusiva/cofre preservado/marker/ACL/sem overwrite ou autoTAKE.
  86133/oc4GkM ensaio compiladoPASS pela ferramenta real;84713/FXb2MZ recusas
  dirigidasPASS inclusive backup sem marker, junção e auxiliarACL ausente.
  Tipos após reparo de fixturePASS73659;11 unit distintos cobertos. Evidência
  group09-supported-backup-restore-20261009.json. Ainda faltam publicado/cursor/
  asrun/jobs e política de retomada, shared-key em outro host/conta, upgrade/UI/
  operação física. Não encerrar9.3 nem10.4 por ferramenta de quarentena.
  Workers importados agora ficam bloqueados (scanner/mídia/mix/automação),
  sem reclassificar jobs no construtor/consulta. Mudanças API recusadas, mas
  auth/backup manual e auditoria das recusas continuam.84 distintos cobertos
  após replay de1 fixture;tipos/buildPASS.42082/mxvxGq compiladoPASS jobs/revisão
  scan preservados após restart e TAKE pela rota real recusado/auditado.
  Evidência group09-restored-worker-quarantine-20261009.json;serverDF7515AB.
  Falta prova publicado/cursor/asrun e política de liberação operacional;
  nenhum marco físico fechado e r27 permanece anterior.
  Estado operacional agora resumido sem autorização de retomada:84054/WaR9Av
  PASS edições ativa/superseded geradas pelo planner, cursor playing importado
  e asrun aberto/fechado preservados no backup/restore/restart; resumo/ediçãoAPI
  correspondentes.21 testes/tipos/buildPASS42423;server8EE96B53/CLID447CBB4.
  Evidência group09-backup-operational-state-20261009.json. Fixture CP/asrun
  não equivale a TAKE físico; falta liberação operacional com prova autoritativa
  de predecessor parado, posse e mídia/QC, além de outrohost/conta e integração
  de recuperação completa. Não transformar quarentena permanente em sucesso.
  Chave compartilhada validada em processos/pastas isolados:20332/M9Pjse PASS
  restoreCLI/serviço com keyENV correta, sem keyfile novo; keyausente/errada
  recusadas sem substituir configuração. Origem já configurada com chave
  compartilhada; não é migração deDPAPI nem outrohost/conta. Evidência
  group09-backup-shared-key-20261009.json. Liberação operacional continua aberta.
- 9.4 Watchdog e recuperação: **em andamento**. Engine/broker/backend/DB/saída,
  falha e retorno sem duplicação de reprodução/publicação e perda não explicada.
  Atualização18/10: background/live/telemetria/retenção e admissão guardados;
  saúde não é marcada persistida antes do INSERT.36testes/tipos/buildPASS,
  BsZHwlIPC/indepgI0wvyPASS comsourceRunFAIL explícito por marcador faltante.
  Compilado sobrevive3recusasSQL e persiste transição após tirar falhaQA;
  SIMocioso, não continuidadePGM/WS/engine/ocupado. BACKGROUND-STORAGE-CONTENCAO-
  2026-10-18.md; servidorFADFFB13 atual, não instalado.
  Scanner compilado51931/DlfX28 PASS com crash durante probe medido ativo:
  auxiliar observado por handle OS encerrou82ms após servidor próprio,
  lote/cadastro sem commit abandonado; sucessor concluiu mesmo lote e medição,
  hash preservado/sem duplicação. Código0 do processo não significa análise ok.
  Evidência scratch/group06-ingest-active-probe-crash-20261009.json. Não prova
  continuidadePGM, DB separado, saída física, browser ou instalação. Mesmos
  binários da r27; sem nova build/testes de fluxos intactos por documentação.
  Crop montado e SHA persistidos/restaurados no engine/backend, sem redefinir
  corte por timing atual ou retry de cópia. Legacy sem crop e recuperações
  recusadas preservam checkpoint; STOP confirmado libera.147 casos distintos
  cobertos, tipos/build PASS; compilado84FA0D94/engine92B7E56,20899 PASS com
  vídeo real local/null: nominal1250/resolvido750/EOS750, identidade/cursor
  mantidos após crash do engine e servidor, recusa de legado sem overwrite.
  Falta queda broker/DB/saída, sinais externos e recuperação/tempos completos.
- 9.5 Soak e desempenho: **pendente**. Rodada prolongada 24/48h, falhas de
  rede/disco/energia e métricas/tempos de recuperação registrados.

Fechamento: 5/5 com limites objetivos e ensaios prolongados reais.

## Pendência 10 — Pacote Windows e publicação

Entrega atual16/10: r83 no D:, instalador incorporado/manifesto/perfil/7destinos
de atalhos PASS. Retomada/adoção por ferramentas e engine610E instalados,
diários assinados e pixels/PCM conferidos em MLIh8R. Asserção independentePASS
com roteirooriginalFAIL explícito por expectativa QA errada de as-run único.
Sem overlays/runtime emprestado. Não homologa Windowslimpo/externos/migração
antiga/rollback/licenças. Ver BACKUP-UPGRADE-R83-2026-10-16.md; 10.1 concluída,
10.2–10.5 abertas. Históricos abaixo não redefinem a entrega.

Entrega histórica09/10: r27, fluxo de pastas/fila/diagnóstico e
reparo explícito do scanner integrado, gerado sem testes funcionais do pacote.
`release/RPlayout-1.1-parcial-20261009-r27-instalador.zip`,535788731 bytes,
SHA-2564C06A592C0D2C89E2C134125747ADFDE8BC2C12CAA1A45F63B951884F639E06E.
Registro docs/BUILD-PARCIAL-R27.md. Provas dirigidas posteriores de API/recovery
e scanner não homologam instalação em máquina limpa nem sinais físicos.
Releases anteriores preservados; todos os marcos10.x permanecem abertos.

Entrega parcial09/10: r26 inclui fluxo de áudio TRIM e ownership dos jobs.
`release/RPlayout-1.1-parcial-20261009-r26-instalador.zip`,535740595 bytes,
SHA-25607621D3EF0C82DE829AE6F6D36F89E1776A7D0DB4EDBAC63F484C6331C37CC7F.
Build/empacotamento PASS; sem testes prévios, instalação ou homologação física.
Replays de desenvolvimento posteriores não validam o instalador. Registro
em docs/BUILD-PARCIAL-R26.md. Preserva r24/r25; todos os marcos10 continuam abertos.

- 10.1 Artefato portátil atualizado: **concluída**. R87 gerada/instalada no D:,
  7.100arquivos/reciboVERIFIED/perfil/sete destinos de atalhosPASS. Servidor
  3F52DE22 e retomada com pixels/PCM na própria instalação PASScKg2O8, sem
  overlays. Não fecha10.2–10.5 nem retorno para edição anterior. Evidência em
  RECUPERACAO-R87-2026-10-16.md; builds/FAILs anteriores preservados.
  Histórico: R83 gerada/materializada no
  D:, engine610E03E8 correto no pacote e execução de retomada/adoção com mídia
  conferidas por diários/capturas. Roteiro MLIh8R FAIL por expectativa QA de
  as-run único; verificação independente PASS com limite explícito, sem replay.
  Homologações 10.2–10.5 separadas. Histórico r81 abaixo preservado.
  R81 gerada, materializada e
  ensaiada na própria instalação pelo launcher real, Node/GStreamer/SQLite do
  pacote, sem overlays. Manifesto/recibo/perfil/atalhos e cenário nativo de
  arquivo CUE/TAKE com imagem/PCM PASS; O70gPG e conferência independente.
  Esta verificação cobre o artefato atualizado, não antecipa 10.2–10.5 nem
  homologação dos demais grupos. Histórico de builds parciais abaixo preservado.
  Build parcial r24 gerada
  Atualização16/10r80: pacote no D:, catálogo/7094hashes PASS; instalação e
  startup completos NOT_RUN. RaCeNG comprova cenário com arquivo/engine/broker
  reais em fixture, não instalação atual nem protocolos externos/soak.
  Atualização16/10posterior: launcher porta/identidade/jobWindows corrigidos;
  8cenários MPdJnfPASS com compilados atuais em fixtureportátil pequena. R79
  gerada; não herda instalação r78. Job com engine/MediaMTX posteriormente
  observado no cenário RaCeNG acima; demais cenários continuam abertos.
  Atualização16/10posterior: r78 instalada/reciboVERIFIED/perfil/7atalhosPASS;
  Nodeincluído/PATHmínimo/startup2274ms/SQLiteinterno/interface8B0D3FCBPASS.
  Semoverlays; engine191CD1E1materializado. Contrato do launcher corrigido e
  conferido emfixture no lote r79 acima; falta edição completa, não afirmar
  execução deatalhos com base só nos alvos. Windowslimpo/licenças separados.
  Atualização15/10posterior: r71instaladorincorporado/7atalhos/perfilVERIFIED
  e startupinstaladoWRguxl2513ms PASS; nativoNDI/OMT/PVW/cicloBS8rwIPASS.
  Semoverlays; instalador/ZIPanterioresnãoalterados. NãofechaWindowslimpo,
  demaisgrupos/licenças/publicação. INSTALACAO-R71-E-LIFECYCLE-2026-10-15.md.
  Atualização15/10:r71 integra QCleituras independentes/guardJPEGscopes e
  devices--trace opcional; webDG6oIPgn/CD7665DE, servidor5F33/engine3F0.
  Instalador540199538bytes/SHA50F6DAFC8745E9F64A71D6707D807EDC8BC792556ECC429E95DC1DEC365E9973.
  Instalação/startup r71NOT_RUN; r68/overlays nãohomologam novainstalação.
  Atualização15/10posterior:r70 scanner+editores integrada/ZIP7094hashesPASS;
  instalação/startupNOT_RUN, evidênciaBUILD-PARCIAL-R70.md. Histórico abaixo.
  Atualização15/10:r69 integra bootstrap/acervo corrigidos, ZIP7094hashes PASS.
  Instalação/startup r69 NOT_RUN; BUILD-PARCIAL-R69.md, sem herdar prova r68.
  Atualização14/10:r68 instalada/reciboVERIFIED/perfil/7atalhos PASS, startup
  comNodeincluído/PATHmínimo2536ms e nativoCUE/TAKE/QCporarquivo PASS.
  Provas de INSTALACAO-R68-2026-10-14.md não fecham Windows limpo/sinais/
  grupos dependentes/licenças/publicação. Histórico r24 abaixo preservado.
  em08/10 com engine/auxiliares atuais, Node embutido e servidor compilado;
  sem tsx/tsc/pnpm na execução do produto. ZIP com INSTALAR.cmd/PowerShell,
  instalação por usuário em pasta nova e atalhos. Sem testes funcionais por
  solicitação expressa; não é Setup.exe assinado nem artefato homologado final.
  `release/RPlayout-1.1-parcial-20261008-r24-instalador.zip`.
- 10.2 Dependências nativas: **em andamento**. r57 instalada comprovou
  Atualização16/10r81: ambos namespaces MTX_*/RTSP_* filtrados em cada spawn;
  overrides conflitantes exercitados em instalação real. Módulos SQLite e
  GStreamer carregados dos caminhos do próprio pacote observados. Sem runtime
  emprestado/overlays. Fecha lacuna ambiental r80; licenças/externos continuam.
  Atualização16/10r80: configuração MediaMTX1.20.1/binds explícitos corrigida;
  nove sockets próprios reais em loopback e fechamento de11processos PASS no
  cenário de arquivo RaCeNG. Falta filtrar/testar overrides MTX_* ambientais;
  prova em fixture não é Windowslimpo nem homologação de todas as fontes.
  Atualização16/10r78: Node24.16/SQLite resolvido dentro da instalação e
  servidor/interface atuais emPATHmínimoPASS. Não é execução de mídia
  nativa desta instalação nem Windowslimpo; não herdar runtime de overlays.
  Atualização15/10r71: SQLiteinterno/PATHmínimo/HTTPJS/startupPASS; engine,
  devices/GStreamer/MediaMTX/NDI/OMTinstalados executados semoverlays noensaio
  BS8rwI. NãoéWindowslimpo/novaqualificaçãovisual/fidelidade/licenças.
  R68 posterior: SQLite resolvido dentro do pacote/DBstartup/interface PASS;
  engine/probe/proxy/GStreamer/MediaMTX instalados executados em PATHmínimo,
  arquivo e PVW real/QC/TAKE/as-run PASSec33c0, semoverride de servidor.
  Não herda certificação física/Windowslimpo/licenças; fontes externas abertas.
  better-sqlite3 com ABI correto, módulos materializados, MSVC app-local,
  GStreamer/plugins e execução de engine/probe/proxy/servidor incluídos.
  Falta auditoria completa de redistribuição/licenças e qualificação externa
  de NDI/OMT; presença de DLL não homologa sinal real.
  Driver DeckLink permanece requisito de hardware, não pode ser eliminado.
- 10.3 Windows limpo: **pendente**. Instalar/abrir sem dependências globais,
  comprovar binários realmente carregados e operação do pacote inteiro.
- 10.4 Upgrade e integridade: **em andamento**.
  Atualização18/10: qualificação HELD/CUE/TAKE instalada preparada, NOT_RUN;
  r88 reservada, ainda não gerada/instalada. Último pacote conferido r87 intacto.
  Correção no engine/roteiro e bloqueio externo em PGM-PAUSADO-TAKE-2026-10-18.md;
  provas anteriores de migração/retorno preservadas e não repetidas por status.
  Atualização17/10posterior: janela candidato publicado/sem terminal qualificada
  DHY9cz com reconciliação OBSERVED_FILE_ONLY/ACKdesconhecido/sem replay. Migração
  interrompida qualificada zJnVze e dentro da transação IZwzZ2 (WALválido/rollback
  integral45/diário retido/retry recusado/nova cópia50), provas independentesPASS.
  Fonte histórica real+fixturesINFO, não PGM/mídia/jobs legados ou perda física
  de energia. FALHAS-MIGRACAO-E-PERFIL-R87-2026-10-17.md; produto/ZIPinalterados.
  Atualização17/10: retorno real entre edições distintas qualificado no par
  r86→r87→r86, com grade criada APÓS upgrade e snapshot recente completo, não
  substituído pelo baseline. Ativação/adoção/pixels/PCM, três segmentos e novo
  backup após voltar PASSzpPOhn+independente. Recuperação de reserva reconhecida
  por evento autenticado, sem repetir ação; recusas/limites QA preservados.
  Mesma conta/schema50; faltam migração interrompida, legado nativo, adoção
  pós-publicação/energia e demais homologações. Produto/ZIP r87 não alterados.
  Atualização16/10r87: contrato exato/manifesto/diários e histórico recente
  completo em cópia nova; exportações sem WAL/SHM, mesmos execução/cursor/corte,
  três segmentos/apenas um aberto, pixels/PCM conferidos independentemente.
  PASScKg2O8 é restauração repetida com controlador/destino r87, dados r83;
  NÃO retorno entre versões. R86→r83FAIL6NN6PM preservado, recusa seguraPASS.
  Faltam migração interrompida, candidato publicado sem terminal, energia,
  legado nativo e operação de edição nova seguida de retorno compatível.
  Atualização16/10posterior: schema45→50 editorial de binário histórico r30
  migrado em cópia com origem/diário autenticados e reserva liberada, sXZyHfPASS.
  M6lwbzPASS qualifica interrupção de adoção antes de publicar candidato e
  reconciliação conjunta RecoverMaintenance, com recusa sem liberação explícita,
  UPGRADE_PROFILE_REFUSED observado/ID sem replay/perfil e histórico preservados.
  Migração interrompida, PGM/mídia/jobs antigos, candidato publicado sem terminal,
  energia e rollback compatível/conciliação completa continuam abertos.
  Atualização16/10r83: fluxo instalado prepare/review/start STAGE→interrupção
  própria→recuperação de reserva→ACTIVATE/adoção exercitado, com confirmação
  assinada, imagem/PCM e as-run RESTART+retomada conferidos independentemente.
  Não repetir ativação apenas por falha do QA na expectativa de linha única;
  relatório original FAIL preservado. Uma conta/máquina/schema, fonte arquivo;
  não fecha migração antiga, energia, adoção incerta e rollback/histórico completo.
  Marcas NOT_RUN antigas abaixo são históricas; apenas esse cenário foi coberto.
  Atualização16/10r81: instalação nova integral e família nativa própria sob
  job PASS no D:, perfil QA restaurado. Não é migração/upgrade/rollback de
  banco operacional; não reclassificar a cobertura das etapas abaixo.
  Atualização16/10r80: ZIP no D: com7094hashesPASS, sem extração integral.
  RaCeNG observa encerramento da família própria engine/broker pelo job e
  restauração byte a byte do perfil de QA; não é upgrade/rollback operacional.
  Atualização16/10: confirmação de instância raiz/banco/abertura no launcher;
  preserva recusa de porta ocupada no modo restaurado. Testes5perfil +7endpoint
  Rust e integração8cenários PASS; não é ensaio STAGE/ACTIVATE/rollback completo.
  Catálogo ZIP completo antes de extrair, perfil e recibo conferidos na
  instalação r78 em16/10:PASS.
  Isso não é upgrade/rollback; demais fluxos abaixo mantêm seus próprios limites.
  Preparação guiada de backup existente em quarentena com perfil candidato,
  cofre original e mídia explícita também integrada, sem troca do perfil ativo.
  Backup online guiado no HOST com UUID, relatório cifrado, retenção separada,
  consulta sem replay exercitada emIQkjFO; reconciliação de criador morto segue
  sem nova prova integrada neste lote.
  Revisão guiada offline do candidato ligada à conferência nativa existente,
  sem trocar perfil/ativar; recibo não é autorização reutilizável.
  Guard de migrações conhecidas/exatas na abertura/backup/revisão e migração 50
  de pedidos de backup integrados, NOT_RUN; sem proteção retroativa de binários antigos.
  Início candidato STAGE/ACTIVATE integrado ao launcher/backend existente com
  confirmação explícita, recusa de porta ocupada e sem troca permanente do perfil.
  Migração explícita da cópia autenticada sob posse/manutenção e diário de
  início/resultado integrada; interrompida bloqueia revisão, sem replay. Migração
 45→50 editorial foi exercitada posteriormente emsXZyHf. Demais schemas/dados
  e interrupção da migração seguem sem qualificação integrada; retomada nativa
  r80→r83 anterior usou schema já atual.
  Adoção permanente opcional pós-CONFIRMED, perfil anterior privado e diário
  de incerteza bloqueando nova partida integrados. Adoção confirmada exercitada
  emMLIh8R, conferência independentePASS. Reconciliação de interrupção no ramo
  perfil anterior exercitada emM6lwbz; ramo candidato publicado/rollback faltam.
  Reconciliação offline do perfil observado sob posse/diário e predecessor
  liberado exercitada no ramo anterior após manutenção interrompida M6lwbz,
  sem trocar arquivo/replay; ramo candidato publicado/rollback permanecem.
  Recuperação adicional explícita de manutenção interrompida ligada à
  reconciliação sob mesma posse/origem exercitada M6lwbz; qualificação de energia
  e rollback faltam. Não é liberação de proprietário remoto/vivo por timeout.
  Falta upgrade/rollback guiado, backup/restauração, preservação de
  dados/cofre e manifesto/hashes; releases antigas não são sobrescritas.
- 10.5 Publicação: **pendente**. Conferir conteúdo GitHub e publicar a entrega
  validada com evidências/limitações; pushes históricos não incluem todas as
  alterações locais posteriores. Respeitar as permissões do ambiente.

Entrega intermediária solicitada em08/10: gerar pacote instalável parcial assim
que integrado o fluxo5, sem testes adicionais. Deve levar dependências e engine
atuais, declarar NOT_RUN_PARTIAL_BUILD e não encerrar10.3/homologação.
Fechamento: 5/5 e grupos dependentes aprovados; r23 é histórico, não entrega final.

## Totais

| Grupo | Verificações | Concluídas | Em andamento | Pendentes | Adiadas à v3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 4 | 4 | 0 | 0 | 0 |
| 2 | 6 | 0 | 5 | 1 | 0 |
| 3 | 7 | 2 | 5 | 0 | 0 |
| 4 | 5 | 0 | 5 | 0 | 0 |
| 5 | 5 | 1 | 4 | 0 | 0 |
| 6 | 5 | 0 | 5 | 0 | 0 |
| 7 | 4 | 0 | 4 | 0 | 0 |
| 8 | 7 | 0 | 0 | 0 | 7 |
| 9 | 5 | 0 | 4 | 1 | 0 |
| 10 | 5 | 1 | 2 | 2 | 0 |
| **Total** | **53** | **8** | **34** | **4** | **7** |

**10 grupos registrados: 1 concluído, 8 abertos nesta versão e 1 adiado para v3.
53 verificações registradas: 8 concluídas, 34 em andamento, 4 pendentes e
7 adiadas para v3. Escopo desta versão: 9 grupos/46 verificações.** Esta
contagem não é percentual de código entregue. Atualizar estados/totais somente
com evidência e conservar o histórico na matriz. Por pedido do operador:
implementar o grupo inteiro, depois validar em uma rodada de fechamento.
Status/documentação não disparam testes. Em falha real, reparar e reexecutar o
escopo afetado; não repetir grupos aprovados sem alteração que os invalide.
