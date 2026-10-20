# PGM ao vivo: perda, retorno e relógio — 16/10/2026

## Cenário

Dois itens LIVE publicados no banco QA, mesmo anúncio nativo NDI/OMT. CUE no
primeiro, confirmação de vídeo/áudio no PVW e um TAKE implícito. Interromper o
emissor e republicá-lo com o mesmo nome, novo processo, imagem diferente e
tom diferente. Exigir o mesmo item/start no PGM, sem avançar para o segundo,
sem outro CUE/TAKE do operador, sem reinício do engine e sem segunda linha de
as-run. Captura do monitor de **PGM** 428×240, não do PVW; PCM estéreo decodificado.

Servidor E4A01600 e engine 161FB003 compilados da fonte sobre web/devices/runtime
r71 instalados. Sobreposições explícitas: não é instalação r72 nem prova visual,
remota, física ou com emissor de terceiro. Saída pública de PGM desabilitada;
somente monitor local próprio. Nenhum canal operacional foi comandado.

## Recuperação já comprovada antes da correção do relógio

| Protocolo | Diretório QA | Receptor | Média da imagem antes/depois | Tons estéreo antes/depois |
| --- | --- | ---: | --- | --- |
| NDI | qc-native-browser-yZvhsD | 13504 | 121,230 / 17,041 | 998/998 / 1512/1512 Hz |
| OMT | qc-native-browser-M0jt27 | 32800 | 121,218 / 17,041 | 996/996 / 1512/1512 Hz |

Resultados dos controladores e verificadores independentes PASS no escopo de
recuperação. Pixels GRAY8 e PCM salvos foram relidos e suas estatísticas
recalculadas. Cada protocolo: um CUE, um TAKE, LOST/NO_VIDEO real, imagem e áudio
novos no retorno; item/start do PGM e ID da linha aberta do as-run preservados.
Sem falhas HTTP/heartbeat; ambos os emissores com código 0, sem encerramento
forçado/erro; servidores, carriers e famílias nativas próprios encerrados.

O primeiro verificador do cenário PGM falhou ao exigir a identidade do decoder
**PVW**, que o TAKE legitimamente consome/limpa. O verificador foi corrigido para
não usar PVW como prova de decoder PGM. Não se alterou o resultado nativo para
passar: identidade de decoder PGM continua explicitamente **não homologada**
pela API desse ensaio. No cenário exclusivamente PVW, a identidade segue exigida.

## Falha adicional encontrada

O cursor live era obtido pela posição do pipeline da fonte. No OMT, entre a
medição antes da perda e LOST transcorreram cerca de 6 s, mas o cursor avançou
somente de 327 para 353 quadros; no retorno ele saltou para 1700. A origem do
PGM estava preservada, mas a contagem congelava durante a lacuna. Assim, os
PASS de recuperação acima **não** aprovam progressão contínua do relógio.

Correção na fonte: relógio monotônico da ocorrência live, iniciado somente
quando o seletor confirma TAKE. Ausência/reinício de PTS não congela nem recua
esse relógio. O offset de recuperação é respeitado; recuperação automática só
transfere o relógio para o decoder que ela mesma armou. LOAD normal, STOP e
nova ocorrência limpam a transferência. Posição de arquivo/seek/quadro mantido
continuam usando o pipeline do arquivo. Sinal continua dependendo de buffers:
o relógio no ar não torna um sinal perdido saudável.

Engine novo SHA256
`182006A36568CC73FDAEF172C30718D39B66288FD62003E361F19864CA3D0799`.
Build release locked aprovado. Rodada dirigida `live_`: 8 testes aprovados,
incluindo aritmética racional/offset/saturação, bloqueio real de buffers após
TAKE, reabertura automática preservando o relógio nativo e STOP/TAKE da mesma
identidade criando nova ocorrência. Arquivos/quadro mantido não mudaram de
relógio. Não se repetiu a suíte não afetada do servidor.

Integração nova em andamento: janela sem nenhum quadro, exigindo avanço temporal
de 3 s com tolerância de 10 quadros para coleta/telemetria. Não atribuir essa
exigência às evidências antigas. Primeira tentativa OHVwcM: leitor PCM não
encerrou em 30 s, embora gravasse 230400 bytes; imagem aprovada, sinal nativo
ON_PGM/SIGNAL_OK. O log também registrou leitor RTSP lento com descarte de 10
quadros. Resultado FAIL preservado; não prova perda/retorno do novo engine.
Leitor QA passou a ter apenas áudio, sem aguardar EOS da trilha de vídeo;
imagem mantém leitor independente. Timeout e critérios de imagem/PCM mantidos.
Replay somente do cenário afetado; a causa completa da lentidão não é presumida.

Replay NDI NPfgFC aprovado com o engine 182006A3: 3199,262 ms de ausência,
78 quadros de avanço do cursor (79,982 esperados pela duração da janela).
Asserção independente também verificou várias amostras com áudio/vídeo ausentes
e contador de quadros recebidos imóvel nessa janela, além de reler pixels/PCM.
Recuperação: média 121,280 → 17,039; tons 998/998 → 1510/1510 Hz. Mesmo item/start,
mesmo receptor PID 33652, um CUE/TAKE, as-run único preservado, sem falhas de
consulta/heartbeat ou encerramentos forçados. Todos os processos próprios
encerrados. Tipos estritos dos leitores após o ajuste PASS.

OMT jHoq4P aprovado com o mesmo engine 182006A3: 3331,022 ms sem buffers,
85 quadros de avanço (83,276 esperados). Múltiplas amostras confirmam ausência
de áudio/vídeo e contador de entrada imóvel durante a janela. Média 121,211 →
17,040; tons 996/996 → 1510/1510 Hz. Receptor PID 7488, item/start/as-run
preservados; um CUE/TAKE e cleanup completo, sem falhas HTTP/heartbeat/erros
dos emissores. Verificadores independentes de NPfgFC/jHoq4P PASS.

## Prazo do TAKE separado da assinatura

A revisão identificou que o TAKE normal dependia de Error/EOS para desistir.
Desativar o EOS NDI para permitir reconexão não pode manter uma intenção TAKE
pendente para sempre. Acrescentado prazo nativo monotônico de 10 s: ao vencer,
descartar apenas o candidato e preservar o PGM. O prazo é verificado antes da
prontidão; um quadro tardio não ressuscita o comando. Repetir TAKE enquanto a
mesma abertura está pendente não renova o prazo. CUE pode continuar assinando a
fonte; duração de assinatura e intenção operacional são contratos diferentes.

Também corrigido o backend: erro da nova abertura do **mesmo ID de item** não
pode marcar o decoder já selecionado como FAILED nem avançar para Próximo.
A geração do decoder, além do ID, determina se o erro pertence ao PGM. Durante
TAKE pendente, medição/tally da abertura montada permanecem preservados.

Rodada nativa final `live_`: 9 casos PASS, incluindo expiração, não renovação
por TAKE repetido, descarte do candidato, bloqueio de TAKE tardio e conservação
do arquivo anterior. Servidor: 163 casos PASS na rodada de 164; caso novo falhou
porque o mock genérico mudava a identidade PGM junto com a do armado. Fixture
ajustada para emitir decoders independentes, como o protocolo real exige;
replay **só desse caso** PASS. Total 164 casos distintos cobertos, não 327.
Checagem de tipos completa do produto servidor PASS.

Binários após prazo/binding: engine
`EAEA694FA34C23CEF81BF6326FD31367E603A5768D67EDF91468AB0AAB66305C`;
servidor intermediário `678C891FB823434D6C68636710A791B596FF7510D333983B4407506F46328A6B`.
Os replays de relógio 182006A3 não são apresentados como ensaios desses dois
binários finais. Ensaio compilado/nativo final NDI em andamento: repetir TAKE
do mesmo ID durante perda, esperar recusa nativa real e só então devolver o
emissor; exigir PGM/as-run preservados e ausência de comutação tardia.

### Disputa comprovada entre preparação automática e TAKE

2fVpwD e gTpvyK falharam por ausência do aviso de cancelamento. Na resposta
instrumentada gTpvyK havia candidato `live-main`, mas `preparingItemId=live-next`;
depois a preparação automática substituiu o armado por `live-next`, sem erro
de TAKE. Portanto o prazo não chegava a vencer: um LOAD automático antigo
cancelava silenciosamente a intenção do operador. PGM permaneceu selecionado;
esses casos não aprovam a expiração nem o retorno posterior.

Correção: não agendar preroll automático com comandos/TAKE/prioridade pendentes;
trabalho já enfileirado reconfirma sequência de comando, origem e revisão,
inclusive após verificações assíncronas, antes de LOAD. Vale para próximo item
e próxima playlist. Não remover a preparação A/B em operação normal.

Build inicial dessa correção falhou por colisão de variável local `current`;
nome corrigido e build aprovado. Rodada de 165 testes: 164 PASS, novo mock
legacy do caso concorrente confirmou TAKE prematuramente por não ter IDs de
decoder. Fixture corrigida para IDs nativos independentes, como no caso anterior.
Replay dirigido de duas ordens (manual em execução / automático enfileirado
antes do manual) PASS. São **166 casos distintos cobertos**, não a soma de
replays. Tipos completos finais PASS. Não se repetiram suítes web/sem relação.

Servidor final após correção da fila:
`6A86A3CE26164C5B55603336F7CE96D469F92A6E48E3F38C0D8C7D9250516D43`;
engine EAEA694F inalterado. **CuhQue PASS**, com esses binários finais: aviso
nativo de TAKE expirado após 11957 ms, preservando item/start no PGM; retorno
posterior com imagem/PCM novos (média 121,268 → 17,041; tons 998/998 → 1510/1510 Hz),
sem comutação tardia, sem duplicar as-run, mesmo receptor PID 30980/restarts0.
Um CUE e dois TAKEs solicitados: só o primeiro entrou; o segundo foi recusado
antes do retorno do emissor. Janela de 3084,383 ms sem buffers avançou 80 quadros
(77,110 esperados), dentro da tolerância de coleta. Conferência independente
PASS: pixels/PCM relidos e preparação de Próximo ausente enquanto TAKE pendente.
Sem falhas HTTP/heartbeat; emissores código0, sem force; família própria encerrada.
O diagnóstico esperado permanece no health/error do backend, embora o engine
continue ready e transmitindo o monitor. Não declarar saúde totalmente verde ou
ausência de erro provocado. Apresentação/recuperação de incidentes é escopo 9.x.

## Pendências mantidas

Entrega parcial r73 gerada: 540.202.880 bytes, SHA256
`961FE70700BB619F11710AFCF318D85B9E379F5FC2C9C702E622F34FFBDE3F64`.
Catálogo/7.094 hashes PASS, 7.095 entradas, sem instalar ou executar o pacote.
Ver `BUILD-PARCIAL-R73.md` e `scratch/r73-zip-integrity-20261016/result.json`.
R72 preservada. Nenhuma limpeza ou mudança de dados/rede operacional.

Interrupção/retorno local de VT por NDI/OMT foi comprovada no lote posterior
documentado em `LIVE-PRIORITARIA-VT-2026-10-16.md`, sem homologar sinais externos.
Continuam faltando falhas duras,
qualificação do rebinding de decoder PGM/temporização na API após erro duro
(o teste nativo de reabertura não prova a estabilidade da origem no backend),
integração visual/remota, duração longa e fontes físicas/externas. Não é prova
de saída broadcast física nem fidelidade sem perdas. A r72 permanece intacta;
não contém a correção posterior do relógio. Grupo 8 fica para v3.
Matriz: 10 grupos/53 verificações; 7 concluídas, 35 em andamento, 4 pendentes,
7 adiadas à v3, sem fechamento artificial por um ensaio local.
