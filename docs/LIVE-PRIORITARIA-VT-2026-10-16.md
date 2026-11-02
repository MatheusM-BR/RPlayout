# Live de rede prioritária sobre VT — 16/10/2026

Escopo: 2.3/2.4/2.5 e 4.2/4.3/4.5. Não fecha esses grupos inteiros.

## Correção funcional

O ensaio `qc-native-browser-fNPdAl` revelou um defeito real: um VT de 2.250
quadros foi montado com apenas 743, pois o corte projetado para a live HARD_TIME
virava EOS do arquivo antes de confirmar sinal. Isso contrariava a proteção do
PGM anterior quando a live não entregasse quadro.

`executionTrim` agora usa as ações estruturadas do relatório de compensação:
reduções destinadas a LIVE HARD_TIME/FIXED com endpoint concreto dependem do
TAKE real e não encurtam antecipadamente o arquivo. A grade continua mostrando
o corte/conflito projetado. Cortes manuais, ajustes por outras âncoras, ordem
de transformações, limites reais do arquivo e corte já montado são preservados.
Planejamento, montagem e comparação de CUE usam o mesmo contexto. Não houve
alteração de HA, adiada à v3.

Servidor compilado:
`A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
Engine existente:
`EAEA694FA34C23CEF81BF6326FD31367E603A5768D67EDF91468AB0AAB66305C`.
Web CD7665DE e devices D7396F7C preservados.

## Evidências concluídas

- NDI `qc-native-browser-ZL8L4z`: PASS. Conflito OVERRUN antes da publicação;
  VT real montado com 2.250 quadros; live automática interrompe no cursor 1.114;
  as-run NATIVE/ENGINE_POSITION/LIVE_PRIORITY com hash e revisão publicados.
  RESUME revisado retorna exatamente ao cursor registrado na nova ocorrência;
  snapshot posterior pode já ter avançado. Três ocorrências terminadas após STOP.
- OMT `qc-native-browser-KuZCgt`: PASS, mesmo fluxo, corte no cursor 1.114 e
  retomada nativa confirmada. Um CUE e um TAKE do operador em cada ensaio; a
  live entra pelo horário, não por um segundo TAKE manual.
- Nos dois: fonte realmente descoberta e vínculo do cadastro confirmado no
  decoder PGM; monitor PGM decodificado em 428×240 com pixels distintos e áudio
  estéreo 440 → 997 → 440 Hz. Revisão publicada permanece imutável, live continua
  na lista, interrupção resolvida após retorno. Processos próprios encerrados.
- `assertions-priority.json` em cada pasta: conferência independente PASS,
  relendo GRAY8, PCM e hash do arquivo, além de revisão/as-run/cursor e cleanup.

Os testes de domínio cobriram 210 casos distintos em quatro arquivos afetados
(15 trim, 4 prioridade, 166 transporte, 25 revisão operacional). Houve rodada
208 PASS e replays dos casos de trim alterados; não somar execuções sobrepostas.
Tipos completos do servidor e build PASS. O verificador de áudio tem 10 testes
dirigidos PASS; estes são adicionais, não novos itens da matriz de 53.

## Falhas preservadas e medição

- `xfZfV8`: geração da mídia de teste expirou antes de CUE/TAKE; reduzida sua
  resolução/complexidade, sem substituir o VT por live ou eliminar a interrupção.
- `fNPdAl`: montagem antecipadamente reduzida, defeito de produto corrigido acima.
- `UfO3PY`: leitor abriu o monitor antes do publisher estar pronto, HTTP 404;
  teste passa a esperar prontidão real antes de ler, sem fingir imagem.
- `gNA9ye`: OMT cortou e retomou, mas a medição final por cruzamentos de zero
  indicou 474/478 Hz. Análise espectral do PCM preservado demonstrou 440 Hz em
  ambos os canais, com cerca de 99% da energia no tom. O ensaio continua FAIL,
  não foi reclassificado retroativamente. Replay KuZCgt concluiu o fluxo.
- O estimador espectral inicial podia perder um tom em zeros da grade de busca;
  regressão de meio segundo incluída e busca corrigida para passo de um bin.
  A medição nova procura o pico sem receber a frequência esperada, exige
  diferença <15 Hz e concentração >85%; silêncio/mistura forte são recusados.
  Cruzamentos antigos permanecem como diagnóstico, não foram apagados.
- A primeira conferência independente exigia snapshot de retorno exatamente no
  cursor. No OMT já havia 2 quadros de reprodução: o critério foi corrigido para
  exigir o cursor exato no registro nativo da montagem e progressão no snapshot.

## Limites e sequência

Servidor/engine são overlays explícitos sobre runtimes instalados r71, não
homologação de instalação r74. Fonte sintética local com SDKs reais, não emissor
externo, hardware, navegador remoto ou saída física. O arquivo foi aprovado
diretamente na fixture; não prova ingestão/QC editorial. Sem soak longo.

Ausência de sinal NDI `qc-native-browser-Ar1tS2`: PASS, conferência independente
PASS. Emissor retirado antes da âncora; tentativa automática recusada cerca de
10,2s após o horário. VT com mesmo início/corte2250, pixels/PCM440 ainda reais
no cursor1360 (além da projeção1108) e depois no1947. Volta do emissor não gera
TAKE tardio nem interrupção falsa; somente uma as-run, encerrada por STOP no
cursor2158. Processos próprios encerrados.

OMT sem emissor `qc-native-browser-bl66Yt`: FAIL, troca indevida no horário,
antes de medição recente aparecer na API. Não é aprovado por analogia ao NDI.
Diagnóstico direto `omt-missing-XokbFU` PASS para nome nunca publicado, mas
`omt-missing-ejQefT` reproduziu FAIL quando a fonte já estava armada antes de
parar o emissor: quadros antigos do appsrc pausado foram entregues no TAKE e
ganharam horário de chegada novo. Estado nativo confirmou decoder2/27quadros,
não foi apenas ACK ou simulação do servidor. Primeira fixture direta087m6E
falhou por pedir preview em canal sem barramento; corrigida, não conta como
prova do produto.

Correção posterior: preparar LIVE em PLAYING no slot ainda não
selecionado, consumindo o sinal atual; arquivos continuam PAUSED no Mark In.
LOAD não pode trocar PGM. R74 já gerada mantém engine anterior e NÃO contém
essa correção. Build release locked posterior PASS: engine
`7FD481E0B58A147C553477EC2B9EAB397EBAD4ED9136F0D2D589B6981B141EB9`.
Seis testes nativos dirigidos PASS (5 TAKE/clock/hold +1 entrega real/LOAD
PLAYING). Replay direto `omt-missing-DdM4Jh` PASS com emissor de verdade antes
da perda e TAKE recusado, mantendo VT. A captura armada deixa de atrasar o sinal
ou gerar memória de fila durante PAUSED. Resultado integrado final abaixo.
O [header oficial](https://github.com/openmediatransport/libomt/blob/master/libomt.h)
documenta que receive retorna null no timeout e a validade do frame recebido;
não há substituição de ausência por vídeo gerado nesse contrato. Causa acima
foi reproduzida nos eventos nativos locais, não inferida só da documentação.

Replay integrado OMT com engine7FD481E0 `qc-native-browser-C2zabR`: controlador
concluiu e provou VT no ar após âncora1364 e após retorno2035, sem TAKE tardio.
Entretanto a conferência independente recusou fechamento: as-run terminou em
EOS2250, não STOP; o VT90s acabou naturalmente entre a captura e o STOP. Isso
não é o EOS antecipado corrigido (projeção1111), mas não satisfaz o critério
mais estrito do ensaio. Evidência preservada, não contar como PASS independente.
Fixture de ausência ampliada para120s/3000quadros, mantendo âncora45s, resolução
e energia/tom; controlador também exige explicitamente endedBy STOP. Sem
afrouxar o requisito. Resultado final após essa correção da fixture abaixo.

NDI com engine7FD481E0 `qc-native-browser-InhMRG` PASS: corte1109/2250 e retorno
revisado, três as-run e conferência independente PASS. Primeiro replay OMT novo
`D09Vut` falhou antes da live: tom440 presente, mas coerência de fase da janela
inteira0,815. PCM preservado mostra 5/5 janelas temporais com energia no mesmo
tom; não é mistura de fonte nem ausência. A verificação de presença agora exige
pico cego correto (<15Hz) e >85% energia em pelo menos4/5 janelas por canal,
mantendo RMS e os dados de coerência longa/zero crossings como diagnósticos.
Regressão de salto de fase/mistura/silêncio incluída;10 testes PASS e tipos
completos/dirigidos PASS. Isso não homologa continuidade/fidelidade do áudio;
D09Vut permanece FAIL, novos ensaios não reclassificam evidência anterior.
Primeira chamada avulsa de tipos falhou por não apontar o diretório @types/node
do workspace; comando corrigido com typeRoots passou, sem instalar dependências.

OMT normal `qc-native-browser-U4naNK` com engine7FD481E0 PASS: corte1112/2250,
retorno revisado/três as-run, tom440→997→440/pixels distintos, conferência
independente PASS e processos próprios encerrados. O replay de ausência
`l1VMXu` não chegou à âncora: leitor de vídeo RTSP recusou link inicial; leitor
PCM concluiu, VT nativo estava montado3000/playing. Sem afirmar causa resolvida
no produto ou aprovar o cenário. Teste agora também aguarda as trilhas H264 e
Opus anunciadas pelo monitor e registra esse estado antes de abrir leitores.
autoNext dos dois itens é false nesta fixture; ela
não homologa toda combinação de avanço automático/loop/compensação concorrente.

## Fechamento local do lote

OMT sem sinal `qc-native-browser-rJnTrF`: PASS com engine7FD481E0, servidor
A709115F e VT120s/3000quadros. Recusa cerca de10,2s após a âncora; VT ainda
presente nos cursores1363 e1988 (projeção1110), com o mesmo início/corte e
pixels/PCM440 reais. Emissor retorna e é descoberto de verdade, mas não entra
tardiamente. Sem interrupção falsa; uma única as-run, NATIVE/ENGINE_POSITION,
hash/revisão publicados, encerra apenas em STOP2211, bem antes do EOS3000.
`assertions-priority.json` PASS após reler hash, pixels e PCM; ambos emissores
código0/sem force e processos próprios encerrados. Três capturas válidas.

Lote local concluído: corte/retorno NDI InhMRG e OMT U4naNK, ausência OMT
rJnTrF com os binários da r75 em overlays explícitos, mais ausência NDI Ar1tS2
com engine anterior EAEA694F. Não transferir esta última prova para um ensaio
de ausência NDI com7FD481E0 que não ocorreu. Seis testes nativos,210 casos de
domínio distintos e10 de medição dirigidos, tipos e builds PASS. Chamada final
de tipos completa PASS; git diff --check dos arquivos versionados afetados PASS
(avisos de normalização CRLF não são erro funcional). Nenhuma suíte web repetida.

R75 parcial gerada540202872bytes/SHA256
`A9B901F6641CEA21775AE7A024FA9B8F8510A26CF6611CBA63004286DEF1B27B`.
Integridade7094hashes/7095entradas PASS, sem instalar/executar o ZIP. R74
preservada como histórico com seu problema conhecido; indicar r75 para teste.

Permanecem integração visual/remota, falhas duras e matriz completa de timing,
fontes externas e instalação/upgrade/rollback. DeckLink adiada pelo usuário;
grupo 8 somente v3. Totais mantidos: 10 grupos / 53 verificações — 7 concluídas,
35 em andamento, 4 pendentes e 7 v3.
