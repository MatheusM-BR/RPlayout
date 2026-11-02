# QC direto NDI/OMT e leituras independentes — 15/10/2026

Atualização posterior: a r71 foi instalada e abriu localmente, e o ensaio
API/nativo BS8rwI reproduziu o diagnóstico final após interrupção intencional
da origem; encerramento ordenado dos emissores não registrou erros. Ver
INSTALACAO-R71-E-LIFECYCLE-2026-10-15.md. ABuYjy e seu resultado parcial abaixo
permanecem intactos; a execução nova não fornece horário retroativo para o erro.

Estado: avanço em **3.3, 3.5, 3.7 e 6.1**, sem fechar homologação dos grupos.
Total mantido:10 grupos/53 verificações,7 concluídas,35 em andamento,4 pendentes,
7 adiadas à v3. Grupo8 continua fora desta versão; DeckLink física adiada.

## Duas falhas corrigidas

1. `QualityControlView` consultava catálogo de entradas e telemetria SRT com
   um único Promise.all; qualquer rejeição apagava ambos. Perder a consulta de
   telemetria podia tornar a fonte selecionada inexistente para o player,
   desmontando um preview ainda com vídeo. O intervalo de3s não impedia GETs
   sobrepostos ou respostas fora de ordem.
2. Ao ativar qualidade WHEP ao vivo, a ausência de uma URL JPEG e o estado
   inicial de erro nulo satisfaziam `failedQualityFrame===inspectionFrameUrl`.
   Dois nulls eram tratados como JPEG falho. A imagem continuava, mas os scopes
   descartavam seus pixels e mostravam AGUARDANDO FRAME.

Agora o catálogo e a telemetria têm leitores independentes, GETs com prazo10s,
sem sobreposição por leitor e fechamento que rejeita resposta tardia. Catálogo
desconhecido é N/D, não zero. Falha preserva a última lista/identidade da fonte;
aviso explícito e seleção nova bloqueada até recuperar o catálogo. A falha de
telemetria não bloqueia selecionar fonte de um catálogo conferido e não mostra
telemetria antiga como atual. QC reinicia seu contexto ao trocar de canal.
Nenhuma gravação recebe cancelamento ou repetição automática desses leitores.

`qcQualityFrameFailed` exige URL JPEG efetivamente solicitada para arquivo,
qualidade por quadros ativa e igualdade da falha com esse pedido; nunca invalida
WHEP ao vivo. Ainda bloqueia JPEG da edição atual que realmente falhou.

Arquivos: `domain/retained-poll.ts`, `domain/use-qc-live-inputs.ts`,
`domain/media-preview.ts`, `views/QualityControlView.tsx`, `api.ts` e testes.

## Validação dirigida de fonte

Primeiro lote:31 casos/5 arquivos PASS — retained-poll6, API GET1,
markup QC3, preview readiness17, joined-read4; tipos web PASS.
Build `index-DIEWHhDB.js`, SHA A58E464ACDE07BAD6D771B35CB36C64CC3279FD6D61E39A91854B71AD032277D.

Ensaio visual expôs a segunda falha, não detectada pelo primeiro lote.
Após correção: media-preview38 (inclui7 regressões novas), scope-sample12 e
markup QC3 PASS; tipos web PASS. São **81 casos distintos em7 arquivos**,
não84: os3 casos de markup foram repetidos na rodada afetada.
Build final `index-DG6oIPgn.js`, SHA
CD7665DEA5B70B1B9CBA4D9FB9AF667085869E22F67C868B3105EACED818C173.
Servidor/engine recompilados para o pacote, hashes mantidos5F33C58E/3F0C9616.
Não repetidas suítes editoriais ou de hardware por mudança de status.

## Ensaio nativo e navegador

`scripts/verify-qc-native-input-browser.mts`, instalado r68 em scratch, Node
incluído; controlador usa tsx/banco de teste do workspace, não requisito do
produto. Servidor5F33C58E, engine3F0C9616, devices fonteD7396F7C. Web overlay
declarado, nunca sobrescrita da instalação. Pasta `scratch/qc-native-browser-ABuYjy`.

Broker próprio em loopback; recusa portas ocupadas. Um emissor GStreamer
produziu barras SMPTE640×360/25fps e tom997Hz/2canais em SRT. Dois engines
separados publicaram esse sinal como NDI e OMT. Ambos efetivamente decodificaram
vídeo/áudio antes de iniciar a descoberta. Auxiliar/plugin/runtime nativos
descobriram os anúncios; `/sources` não foi simulado. Duas fontes cadastradas
pela API com revisão real. Canal do QC com saída null/grade vazia.

Navegador IAB, aba própria15, login temporário, URL abriu diretamente `workspace=qc`.
Não se abriu Master, não se publicou grade nem enviou TAKE ao canal do QC.
Selecionar NDI produziu PVW pronto, formato640×360/áudio2ch e vídeo428×240
em reprodução no navegador. Receptor RTSP independente decodificou75 quadros
para superar o GOP inicial: desvio de luminância71,5129, não imagem uniforme.

Gateway QA controlado por arquivo provocou somente falhas GET:

- Telemetria503: lista com2fontes permaneceu selecionável; NDI continuou em
  reprodução, tempo do vídeo43,825s; aviso não confundia consulta com perda.
- Catálogo sem resposta: três consultas encerradas em9999/9998/10000ms,
  máximo1GET em voo por classe/fase. Fontes mantidas, novas seleções bloqueadas,
  NDI em428×240/readyState4 e tempo78,888s. Nenhum catálogo vazio fabricado.
- Recuperar a consulta: fontes habilitadas e aviso removido, mesmo vídeo com
  tempo104,572s; não precisou reload ou novo CUE para recuperar a consulta.

Selecionar OMT no próprio QC produziu vídeo428×240/readyState4 e medição
640×360/25fps/áudio2ch. Captura independente75quadros: desvio71,2826.
Todas as consultas de snapshot do controlador exigiam PGM nulo/playingfalse;
resultado final grade0/as-run0. Isso prova o cenário parado testado, não
preservação de um VT em PGM neste ensaio específico.

## Qualidade e scopes

Primeira versão: botão de qualidade exibiu imagem640×360 e relógio avançando,
mas scopes AGUARDANDO FRAME; screenshot/observação negativa preservados.
Voltar ao preview leve restaurou AMOSTRADO, compatível com a condição JPEG
indevida. Não chamar esse primeiro caso de aprovação integral do QC.

Após corrigir o guard e carregar o novo web pelo navegador, mantiveram-se os
mesmos serviços/emissores confirmados vivos. Repetiu-se somente o fluxo afetado:
seleção OMT, qualidade e retorno leve. DOM confirmou scriptDG6oIPgn, vídeo
640×360/readyState4/tempo28,564s, scopes AMOSTRADO, luma/parade/vetor desenhados.
Broker QA: caminhoqc readytrue, H264+Opus,1reader WebRTC,26806956bytes recebidos.
Ao voltar:428×240/readyState4/tempo32,029s/scopes AMOSTRADO; caminhoqc readyfalse,
tracks vazias e0readers. Não se alegou sinal original sem perdas, escuta humana,
fidelidade de PCM/cor, teste de detalhe em4K ou benchmark remoto.

Os scopes do lote final foram revalidados visualmente; falhas GET foram
validadas antes do guard JPEG adicional, cujo código não modifica leitores.
Não se apresenta o primeiro ensaio completo como replay integral da versão final.

## Encerramento e diagnóstico ainda não classificado

Aba própria fechada; controlador terminalexit0/FIXTURE_FINISHED; servidor,
carrier e família nativa encerrados. Dois emissores exit0, nenhum kill de PID
histórico e nenhum encerramento forçado dos emissores. Dados operacionais,
contas, mídia, rede e abas do operador não alterados.

O registro final do sender OMT contém erro de leitura/TAKE recusado e última
telemetria sem vídeo/áudio. O controlador desta primeira execução desligava
servidor/broker e carrier **antes** de pedir shutdown dos emissores, podendo
provocar essa perda; porém não registrava horário/fase do erro. Portanto sua
origem temporal não está provada: **não afirmar ensaio sem erros nem estabilidade
prolongada aprovada**. As capturas e o navegador provam imagem nos intervalos
declarados, não invalidam ou explicam automaticamente esse diagnóstico final.

Para próximos ensaios, controlador alterado para parar senders antes do carrier/
broker, salvar estado antes do teardown e datar os erros por fase. Essa melhoria
do controlador não foi reexecutada nesta rodada e não muda a evidência original.

`scripts/verify-qc-native-input-evidence.mjs` lê as provas e retornou
**PARTIAL_PASS_WITH_UNCLASSIFIED_FINAL_SENDER_DIAGNOSTIC**, deliberadamente não
PASS global. Asserções confirmam imagens, consultas independentes/prazo, DOM,
retorno leve, grade/as-run0 e cleanup; diagnóstico final permanece no relatório.

Provas principais: `result.json`, `browser-observations.json`,
`assertions-qc-native.json`, `captures.json`, capturasJPEG nativas e seis PNGs
na pasta do ensaio. Hashes constam na asserção. Observações visuais foram
transcritas do DOM da aba própria, não execução automatizada declarada pelo
controlador. Consulta inicial ao broker sem elevação falhou EACCES do ambiente;
leitura autorizada posterior confirmou ready/encerramento. Não é erro do produto.

## O que ainda falta

3.3: demais protocolos/RTMP, estação remota e homologação externa; DeckLink adiada.
3.5: completar cobertura de arquivos/fontes/áudio e estação remota, não só raster.
3.6: medir CPU/RAM/rede/latência no controle remoto e carga prolongada.
3.7: validar áudio efetivamente amostrado/continuidade/tally/multiview e carga;
o diagnóstico sem horário do emissor deve ser esclarecido no próximo ensaio
nativo, com o controlador que separa execução de teardown.
6.1: qualificação integrada/concorrência dos demais fluxos continua aberta.
10.x: r71 parcial gerada separadamente, sem instalação/startup/Windows limpo.
Fontes sintéticas locais não substituem emissor externo nem placa real.
