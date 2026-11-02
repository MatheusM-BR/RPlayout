# RPlayout r88 — marco utilizável (build parcial, NÃO homologada)

## GERADA — r88-19, 22/10/2026 (Windows) — USAR ESTA

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-19-instalador.zip`
  SHA256 `D625C434261D0256142E3966C176F785E17101F6C9F6953AB48E01749A34536F`.
- 13/13 PASS. Instalada em `D:\RPlayout Atual` (pasta fixa). Correções:
  CORRECOES-R88-18-R88-19-2026-10-22.md. A r88-18 não é usável (não inicia
  com auditoria grande).

## GERADA — r88-17, 21/10/2026 (Windows)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-17-instalador.zip`
  SHA256 `DBE0AB822E382039E208D56511392416F38058B30B1A544D1056155511F605F8`.
- 13/13 PASS, Rust 125/0/4. Correções r88-13…r88-17 e testes na instalação
  real: CORRECOES-R88-13-A-R88-17-2026-10-21.md.

## GERADA — r88-12, 21/10/2026 (Windows, commit e2da3ea)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-12-instalador.zip`
  SHA256 `C55659E98084077D1B76678A946EFA4E6AF1762F526D5E77ECFB6F4841ED0545`.
- 13/13 PASS, Rust 125/0/4.
- Sobre a r88-11: o último quadro de um item cortado não gera mais o alerta
  permanente "Corte salvo não corresponde a PGM nativo reproduzível" (achado
  no soak). Instalação do operador atualizada r88-11 → r88-12 pelo caminho
  oficial; ver SOAK-E-ATUALIZACAO-R88-12-2026-10-21.md.

## GERADA — r88-11, 21/10/2026 (Windows, commit 5e9fbad)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-11-instalador.zip`
  SHA256 `1C8A5AD4FCA25C4A70CA34AEF1B2B306936896F608E7A816F4807093DE8714D1`.
- QA: `D:\RPlayout-builds\qa\r88-installed-20261021-080025`; 13/13 PASS, Rust 125/0/4.
- Sobre a r88-9: QC "em qualidade" com decodificador próprio (não usa mais o
  PVW do Master); abertura do QC mostrada como "Abrindo…". Regressão na própria
  r88-11 com fonte NDI de teste: busca 2,7 s; CUE/TAKE de vídeo (−21 dBFS) e
  de ao vivo (−12 dBFS) com o QC inspecionando ao mesmo tempo, sem queda.
- r88-10 fica no lugar (sem a mensagem de abertura); use a r88-11.

## GERADA — r88-9, 21/10/2026 (Windows, commit 9463076)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-9-instalador.zip`
  SHA256 `2593707A8A66237B1D74E4E09B01ADB3AA38C53597FE5EF791460EC26598D41A`.
- QA: `D:\RPlayout-builds\qa\r88-installed-20261021-003107`; 13/13 PASS, Rust 125/0/4.
- Sobre a r88-7: TAKE indisponível mostra o motivo; aviso de PVW compartilhado
  com o QC; estado ao vivo não perde a troca de fonte nem o aviso; NDI espera
  2,5 s na busca. Ver ANALISE-PONTA-A-PONTA-2026-10-21.md.

## GERADA — r88-7, 20/10/2026 (Windows, commit 6825b64)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-7-instalador.zip`
  SHA256 `5CA6D4F286CBAF6624EED3A41FFE6B534B28968F8069C37DF536082CD8CB63EC`.
- Instalação QA: `D:\RPlayout-builds\qa\r88-installed-20261020-225344`;
  resumo `r88-summary-20261020-225344.json`. 13/13 PASS, Rust 125/0/4.
- Sobre a r88-4: monitores que perdiam a primeira ordem de ligar, duração no
  MAM, menos gravações ociosas, OMT parado reabre em 5 s, texto do monitor
  com PGM no ar. Validação ponta a ponta em VALIDACAO-R88-6-2026-10-20.md.
- r88-5 (falhou por carga da máquina) e r88-6 ficam no lugar; use a r88-7.

## GERADA — r88-4, 20/10/2026 (Windows, commit 8a384d4)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-4-instalador.zip`
  SHA256 `A5C823760F4DBF0D3418C1AD02DB16F574C5FF4CA402FEE09E384FCE89902D95`.
- Instalação QA: `D:\RPlayout-builds\qa\r88-installed-20261020-182112`. Resumo:
  `D:\RPlayout-builds\r88-summary-20261020-182112.json`. 13/13 etapas PASS.
- Corrige o relatado na r88-3 instalada (ver DESEMPENHO-R88-4-2026-10-20.md):
  servidor saturado por consultas ao banco (acervo/QC/rotas lentos), canal
  criado na sessão sem grade carregada (clique na grade sem efeito, PVW/PGM
  vazios), descoberta de fontes lenta e bloqueante.
- Conferido no Windows depois da build: 52/52 testes dos módulos alterados
  (inclui banco em processo isolado real); descoberta 5,1–14,8 s (r88-3) →
  2,6–3,4 s (r88-4), mesmas fontes NDI e OMT encontradas na rede.

## GERADA — r88-3, 20/10/2026 (Windows, commit b9baa54)

- Instalador: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-3-instalador.zip`
  SHA256 `ACB893F8D504D3F28314747035BCAD00CD44D47DF83B85C393B742E89251BE3D`.
- Instalação QA: `D:\RPlayout-builds\qa\r88-installed-20261020-161251`
  (atalhos em `qa\r88-shortcuts-20261020-161251`). Resumo:
  `D:\RPlayout-builds\r88-summary-20261020-161251.json`.
- 13/13 etapas PASS: tipos; testes JS do núcleo; builds; **Rust 124 PASS / 0 FAIL
  / 4 ignorados (GStreamer 1.28)**; **ensaio real da troca de fonte com o engine
  release (PREPARE→READY→COMMIT→reserva no PGM, mesmo relógio/as-run, checkpoint
  v2, replay, STOP)**; ZIP conferido; instalação isolada; pacote instalado
  (plugins, Node/SQLite, NDI runtime, CRT, engine ready/shutdown) e engine
  instalado anunciando liveReplacementProtocol=1.
- r88 e r88-2 no mesmo diretório são tentativas anteriores (não apagadas):
  r88 sem instalação QA; r88-2 sem a correção de BOM do engine. Use a r88-3.

Defeitos encontrados pela execução real e corrigidos antes da r88-3:
1. Limitador marcava como GAP (silêncio) um buffer que levava o rabo audível
   do lookahead; o `volume` pulava o buffer e o PGM pausado/mutado vazava áudio
   (16 canais com par auxiliar; falhava em Linux e Windows). Teste unitário.
2. Engine rejeitava como JSON inválido um comando precedido de BOM UTF-8
   (console em code page 65001 + .NET Framework); o shutdown não era aceito.
3. Scripts de QA usavam API só do PowerShell 7 e não rodavam no 5.1; script de
   verificação sem BOM; verificação do protocolo não drenava o stdout.

Uso interno e testes, sem distribuição. Não substitui instalações anteriores,
não altera bancos operacionais e não instala drivers DeckLink.

## O que a r88 entrega

1. **Troca da fonte da live no PGM** pelo par cadastrado (principal ↔ reserva),
   no bloco da live no ar do MASTER: *Preparar* abre a reserva sem tocar o PGM;
   *Cortar fonte* troca no engine preservando relógio, CUE, próximo e a mesma
   ocorrência de as-run; *Cancelar*; *Consultar* (nunca repete o corte).
   Resultado desconhecido pede consulta, não reenvio. Sem HA, o canal privado do
   processo dono autoriza o corte, como no TAKE; com HA, exige a cerca atual.
2. Autorização revalidada a cada comando (sessão, papel TRANSPORT, canal,
   operador, runtime). Journal durável, checkpoint v2 com a fonte selecionada e
   retomada automática do último ponto salvo continuam valendo.
3. Fábrica de sessão, rotas HTTP, abandono durável de intenção não enviada e
   resolução no STOP de journal de execução anterior comprovadamente parada.

## Evidência antes do empacotamento (Linux, GStreamer 1.24)

- Engine Rust compilado pela primeira vez com o código novo: 220 PASS /
  3 FAIL / 4 ignorados. Os 12 testes da troca rodaram pela primeira vez: PASS.
  Falhas: `ndisrc` ausente (plugin só no pacote Windows) e dois casos de áudio
  multicanal sem posições (diferença de versão GStreamer a confirmar no Windows).
- **Ensaio real**: engine verdadeiro + duas fontes SRT locais. PREPARE
  (PREPARING→READY sem tocar PGM) → COMMIT confirmado → PGM na reserva, mesmo
  relógio e mesma ocorrência de as-run, checkpoint v2, replay pela mesma chave
  sem segundo corte, STOP. 4/4 PASS. `scripts/verify-live-replacement-native.mts`.
- JS: tipos servidor/interface PASS; núcleo da troca e interface PASS.

## Como gerar (uma linha, no Windows)

`powershell -NoProfile -ExecutionPolicy Bypass -File D:\RPlayout\scripts\build-r88.ps1`

Gera em `D:\RPlayout-builds`: ZIP, instalação QA nova em `qa\`, log e
`r88-summary-<data>.json` com o resultado de cada etapa (testes Windows do
engine, ensaio nativo com GStreamer 1.28, ZIP, instalação, verificação do
pacote e anúncio do protocolo pelo engine instalado).

## NÃO validado nesta r88

DeckLink física (adiada); emissor NDI/OMT externo; saída de broadcast real (o
ensaio usa saída null); Windows limpo; soak 24/48h; estações remotas em rede
real; interface clicada em navegador contra engine real; revisão de licença NDI
(REVIEW_REQUIRED); grupo 8 HA entre máquinas (v3). Não é homologação broadcast.

---

Histórico anterior (pré-geração):
Destino reservado: `D:\RPlayout-builds` (autorizado pelo usuário).
ZIP, hash do pacote, instalação e ensaio integrado: **NOT_RUN**.
O último pacote instalado e verificado continua sendo a r87; não foi alterado.

19/10 — candidato isoladoE5568ECD em scratch/live-binding-recovery-245aeb4b/server:
checkpointv2 protege a fonte selecionada e Runtime/engine a recuperam, sem
usar principal como fallback.305testes base/70dirigidos finais, tipos/build14JS
PASS; contrato de rollback declara formatos[1,2]. LIVE-BINDING-RETOMADA-
2026-10-19.md. O corte nativo produtor desse vínculo segue não conectado/
não ativado; não é pacote instalável ou prova audiovisual. Seletores e builds
anteriores preservados. Não combinar dadosv2 com servidor antigo que só aceita1.
Não reduzir versão/apagar o vínculo para viabilizar pacote/rollback. NOT_BUILT.

19/10 — candidato de servidor isolado7A2DACA3 em
scratch/native-live-replacement-server-633f08fa/server: tipos/buildJS PASS,
274testes base +45dirigidos finais PASS (não somar como casos únicos).
Inclui proteção de seleção nativa inconclusiva no transporte. Componentes de
journal/cliente em fonte ainda não conectados ao fluxo real; não anunciar como
corte ou checkpoint de fonte entregue. Seletores do empacotador/servidor4E3
anterior preservados, sem escolha automática deste candidato nem mudança de
nativos/interface. FAILOVER-SERVIDOR-JOURNAL-2026-10-19.md. Ainda NOT_BUILT.

19/10 — contrato de troca de fonte da mesma live agora implementado no fonte
Rust, mas NÃO compilado/testado/integrado ao servidor durável.12casos novos
NOT_RUN; parser não equivale a aprovação. FAILOVER-NATIVO-CONTRATO-FONTE-
2026-10-19.md. Binário0250 antigo não anuncia nem implementa esse contrato;
não selecioná-lo como prova das novas capacidades. R88 permanece NOT_BUILT.

Uso confirmado pelo usuário em 19/10/2026: **interno e testes, sem
distribuição**. A entrega pretendida neste ciclo é interna no destino acima,
sem publicação pública ou envio de binários ao GitHub. Revisão de distribuição
externa fica separada de implementação/testes internos; termos de uso dos
runtimes e avisos continuam sob conferência, sem aceite em nome do usuário.
Isso não resolve bloqueios de compilação/empacotamento nem muda NOT_BUILT.

Servidor selecionado19/10posterior:4E3FF51C em
scratch/host-history-r88-manual-failover-20261019. Decisão manual de failover
de metadados agora exige chave estável, grava antes de atualizar cache e retorna
recibo sem reenviar.32testes/tipos/build e PROCESSnwp9KhPASS; não comuta PGM nem
qualifica failover nativo/instalado. FAILOVER-METADADOS-AUDITORIA-2026-10-19.md.
EE2044/anteriores preservados; interface/nativos finais/empacotamento pendentes.

Licenças19/10posterior: termos oficiais NDI identificados online, mas vínculo
com a DLL6.3.2.0 ainda não comprovado; REVIEW_REQUIRED permanece. Dois arquivos
NDI da r87 conferem com manifesto/2B660207. Coleta local do PDF falhou DNS antes
dos bytes; não incluir material ausente nem alegar aceite. Sem modificação de
runtime/pacote. NDI-TERMOS-LOCALIZADOS-2026-10-19.md.

Servidor selecionado19/10posterior: EE2044AB em
scratch/host-history-r88-app-close-drain-20261019. Fechamento direto inclui
as-run e compartilha resultado de flush sem retry nem falso STORAGE_CLOSED.
53testes/tipos/buildPASS; App fonte+PROCESS+Native hLuOOkPASS/5,13s/exit0,
leitura posteriorPASS. APP-CLOSE-DRENAGEM-2026-10-19.md. Não main instalado,
perdaSQL neste lote ou prova EOSporpublisher. DF63/anteriores preservados;
interface/compilação nativa final/empacotamento continuam pendentes.

Interface, lote19/10posterior: atalho de compensação copia medidas do conflito
em quadros sem aplicar nem executar TAKE.72testes/8arquivos e tipos PASS;
fonte servidor/engine inalterado. COMPENSACAO-MEDIDA-CONFLITO-2026-10-19.md.
EFDC03FF anterior não contém esse atalho nem o aviso de retomada posterior.
Necessário compilar e qualificar a interface nova; não selecionar a tentativa
web com configuração incorreta nem a saída parcial da rodada EPERM.

19/10posterior: servidor selecionado agoraDF63B20A em
scratch/host-history-r88-recovery-flush-20261019. Corrigida liberação da posse
antes do flush no encerramento normal;44testes/tipos PASS. Ensaio3IfSOgPASS
real30sSQL→partida maincompilado no mesmo banco→cursor51→exit0, conferência
uAdExkPASS. Não qualifica r88 instalada, sinais físicos, HTTP ou seekvisual/
PTS exatos. RETOMADA-NATIVA-NORMAL-2026-10-19.md. Builds1700/178F anteriores
preservadas. Interface/empacotamento/nativos finais continuam pendentes.

Lote anterior19/10: operador escolheu retomada automática do último ponto salvo;
intenção auditada antes do comando e aviso não bloqueante.66backend+6UI/tiposPASS.
LeituraAkEGKH confirmou31,96s não persistidos, sem observar replay. Servidor
daquela rodada1700DA6A em scratch/host-history-r88-auto-checkpoint-20261019. Interface nova NÃO
qualificada: build corretamente configurada falhou EPERM; não empacotar a
saída da tentativa anterior com aviso Tailwind. EFDC03FF continua somente a
interface anterior, sem o novo aviso. CHECKPOINT-INCERTO-2026-10-19.md.
Não gerar pacote misturando servidor novo com interface não integrada.

Lote atual19/10: shutdown normal separado da força, comando de cleanup por pipe
próprio não depende de SQL perdido; index/App aguardam saída real e não ignoram
falhas.198testes/tipos/build8BE914C6PASS; vHiSFEonair+SQLfault Native0semforça e
c5pwohmaincompiladoidle/SQLsaudável backend0/STORAGE_CLOSED, ambos com leitura
posterior. ENCERRAMENTO-NATIVO-2026-10-19.md. Não é pacote instalado, reciboEOS
por publisher/índiceMKV ou recuperação completa com banco perdido. Builds atuais:
servidor8BE914C6, interfaceEFDC03FF, bridgeC60C2EFD/serviço9EB4D10D.

Ensaio anterior19/10: PGM NORMAL durante timeoutSQL real encontrou falha de
encerramento: fallbackkill1s antecipou EOS nativo (esperas5s+5s). pQ9ViJFAIL
preservado; captura existente decodificou34s/movimento/997Hz em3janelas, não
finalização limpa nem retomada protegida. AppClose/banco perdido não homologados.
PGM-NORMAL-TIMEOUT-BANCO-2026-10-19.md. Corrigido depois no lote de encerramento
acima, sem mudar prazos de segurança. O FAIL original não foi alterado.

Lote atual19/10: credenciais ambientais removidas do Worker/serviço SQLite;
14testes/tipos/build99748AEDPASS. EnsaioIPC real com observador direto6xdhUV+
conferência somente-leituraPASS; não é backend instalado/PGM/Windows limpo.
BANCO-AMBIENTE-ISOLADO-2026-10-19.md. Bridge novoC60C2EFD; serviço9EB4D10D e
interfaceEFDC03FF permanecem iguais. Fontes daquele lote: servidor99748AED,
interfaceEFDC03FF, mais engine/hostguard a compilar/conferir explicitamente.

Lote atual de empacotamento: agora há `-HostGuardBinary` explícito, além do
engine, para não misturar helper antigo com a próxima compilação. Seleção
PE64/materializada/hash no mesmo handle e cópia ZIP com hash dos bytes efetivos
integradas no fonte. Parser/sintaxePASS, ensaios funcionaisNOT_RUN sob recusa
de script existente. EMPACOTAMENTO-NATIVO-INTEGRIDADE-2026-10-18.md. Não gerar
até validar essas etapas; não usar cabeçalho PE como prova de compilação/ABI.

Lote atual18/10: diagnóstico nativo motivo/operação na API/tela e metadados
limitados no fonteRust.66testes/tipos/buildsisoladosPASS; helpernovo NÃOcompilado/
testado e nenhum códigoWindows real observado. DIAGNOSTICO-NATIVO-PORTAS-
2026-10-18.md. Fontes daquele lote: servidor5B92432F e interfaceEFDC03FF;
anteriores preservados. A atualização do helper precisa ser incluída explicitamente
após compilação autorizada, não presumir que o binárioC: já contenha a mudança.

18/10posterior: ensaio distinto com engine0250 já compilado e saída em arquivo
QA no C: FAIL antes de abrirPGM; diagnóstico independente encontrou consulta
nativa de sockets indisponível (aquisição/provahostPASS, códigoWindows não
exposto). PGM-LOCAL-ADMISSAO-2026-10-18.md. Não é validação de pixels/PCM nem
compilação/instalação, não reclassifica recusas anteriores e não escreveuD:.

Esta parcial deverá incluir a correção de TAKE para PGM HELD confirmado, sem
liberar o decoder anterior para preparar o próximo item. Pausa inconclusiva,
ausência de vídeo e exigências de sinal live continuam protegidas. Não acrescenta
pausa pública nem altera o significado de CUE/Próximo/TAKE.

Lote posterior18/10 também acrescenta navegação paginada do histórico GLOBAL
de saúde, com janela fixa, cursor exclusivo, cancelamento e ACL preservada.
27testes/tipos/buildsisoladosPASS; HTTPcompilado não aprovado por EACCES de
conexão local no ambiente. HISTORICO-GLOBAL-PAGINADO-2026-10-18.md. Não confundir
compilação do workspace com instalador/pacote homologado.

Lote posterior de categorias: corrigida conferência GET/HEAD parametrizada para
conta limitada, sem permitir escrita global/host/canal negado.66testes/tipos/build
PASS; rotas internas+PROCESS Wc3h3s e conferência independentePASS, não HTTP/
backend instalado. CATEGORIAS-AUTORIDADE-BANCO-PROCESSO-2026-10-18.md. Servidor
atual3BBAC965, sem recompilar frontend nem repetir testes dos helpers inalterados.

Lote posterior de background: guard de tarefas captura falhas de corpo/admissão
e suspende a geração de storage perdida sem reabrir/repetir; cache de assinaturas
de saúde só avança após INSERT. Shutdown aguarda app.close().36testes/tipos/
buildPASS; BsZHwlIPC PASS, gI0wvycompilado corpo observado/FAIL marcador final
preservado e conferência independentePASS/sourceRunFAIL. TransporteSIMocioso,
não PGM/HTTP ou drenagem ocupada. BACKGROUND-STORAGE-CONTENCAO-2026-10-18.md.
Servidor daquele loteFADFFB13, preservado; supersedido pelo lote de diagnóstico.

Dois testes nativos2/16canais e release do produto PASS antes do último acréscimo
de fixture. O último acréscimo pendente/cancelamento ainda aguarda a rodada
afetada. Sete testes puros de evidência visual PASS; eles não qualificam o novo
pacote. Detalhes, limites e roteiro: PGM-PAUSADO-TAKE-2026-10-18.md.

Não gerar enquanto a rodada nativa final não puder ser executada e observada.
Usar `-UseCurrentBuilds -EngineBinary -HostGuardBinary` com arquivos absolutos
compilados e conferidos no cache
D:, nunca o engine610E antigo da pasta de build C:. Servidor/interface receberam
o lote de histórico posterior à correção HELD. Builds novos estão isolados em
scratch/host-history-r88-manual-failover-20261019 e
scratch/host-history-r88-web-native-diagnostic-20261018; dist
convencionais ainda antigos. NÃO empacotar esses dist antigos por engano.
Override WebBuildDirectory implementado junto de ServerBuildDirectory, mas sua
execução ainda NÃO APROVADA: sintaxePASS, rodada0PASS/8FAIL por autorização de
script Windows e EPERM da fixture de junction. Não gerar até validar a seleção
real de arquivos. SELECAO-BUILDS-ISOLADOS-R88-2026-10-18.md; nada emD: foi escrito
por este lote, nem houve mudança de políticas para contornar a recusa.
Instalar somente em nova pasta QA e testar com runtime do próprio pacote.

Geração no D: impedida pelo limite do serviço de autorizações antes de executar;
não é compilação falha. Não contornar nem alterar pacotes anteriores. Atualizar
o registro após fatos observados, preservando o README incorporado no ZIP.

Parcial interna, não homologada para publicação pública. Windows limpo, energia,
fontes externas, hardware, longa duração e licenças continuam separados. Acordo
original NDI ausente; DeckLink adiada; grupo8v3. Sem limpeza/movimentação de dados.

Totais:10grupos/53verificações;8concluídas/34andamento/4pendentes/7v3.
# Atualização do lote de troca de live — 19/10

Sem instalador r88 novo. Servidor isolado compilado em
scratch/native-replacement-bridge-20261019/server/server.cjs, SHA256
FF4784EE30AE34872FC018DDDB9D0D9D955354CF2A8DE86F4F2F551FE00D4BCC.
335 testes PASS / tipos PASS; TROCA-LIVE-PIPE-E-COMMIT-2026-10-19.md.
Não selecionado automaticamente para empacotamento, sem substituir r87.
EngineTransport/commit helper implementados; fábrica Runtime, controles,
binário nativo e validação integrada ainda faltam. Este artefato JS não é uma
build instalável nem comprova o fluxo de corte operacional.

