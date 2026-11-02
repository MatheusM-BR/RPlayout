# QC direto, qualidade e áudio simultâneo — 16/10/2026

Escopo: 3.3/3.4/3.5/3.7, sem fechar estação remota, fontes externas ou soak.

## Falha encontrada e correção

O ensaio visual `scratch/qc-native-browser-XmLjgB` confirmou NDI e OMT abrindo
diretamente no QC, sem Master/TAKE/PGM. NDI percorreu428×240→640×360→428×240,
com pixels/PCM997Hz reais e scopes amostrados. Safe inicialmente desativado;
em tela cheia1280×900, overlay1280×720 emtop90, dentro da imagem, fora do matte.
Também houve observação geométrica em largura compacta. O ensaio inteiro é
FAIL: na ativação HQ OMT, o PCM teve lacunas (RMS0,0157;0/5janelas concentradas),
embora os emissores continuassem com sinal. O controlador encerrou sua família;
o player vazio/Failed to fetch posterior não é a causa inicial. Não reclassificar
esse resultado como sucesso. Capturas/UI anteriores permanecem provas parciais.

Causa: preview leve e inspeção HQ usavam o mesmo canal `interaudiosrc`. O
[código oficial do plugin](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-plugins-bad/gst/inter/gstinteraudiosrc.c)
retira amostras do adaptador compartilhado e preenche o que falta com silêncio.
Dois consumidores ativos dividiam os blocos. Saídas PGM já possuem canais
privados por saída; a colisão encontrada estava no par PVW/QC.

Correção: áudio decodificado passa por tee para duas filas/superfícies próprias,
PVW e QC. Mesmo decoder, ganho/roteamento preservados; HQ continua sob demanda.
O ramo QC possui fila limitada200ms/16buffers, sem descarte de PCM. Vídeo HQ
mantém fila leaky existente. Não desativar um monitor para mascarar a disputa.

Primeira compilação recusou leitura de qc_branch após mover a estrutura;
booleano calculado antes do move corrigiu o erro. A primeira versão de fila
de áudio leaky falhou no teste: PVW0/199buffers de baixa energia, QC196/200.
Decoder de arquivo pode adiantar buffers e o descarte antes de sink clockado
cria buracos. Retirado descarte, mantendo limite; teste final recebeu200/201
buffers e zero de baixa energia nos dois leitores, após aquecimento500ms.

## Validação concluída

- Oito testes nativos afetados PASS, release locked: áudio simultâneo, lease
  QC, perda/retorno live, seleção NDI, Mark In, roteamento4canais e hold/16canais.
  A rodada8inclui o teste novo, não somar seus replays como testes distintos.
- Build release locked PASS, engine
  `191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`.
  Servidor A709115F, web CD7665DE e demais binários preservados.
- `scratch/qc-native-browser-WFEidE`: PASS, conferência independente PASS.
  Fonte NDI depois OMT, cada uma com baselinePVW e dois leitores simultâneos
  PVW428×240/HQ640×360; seis capturas com pixels e PCM997Hz estéreo relidos.
  Ambos encoders prontos ao mesmo tempo. Identidades dos decoders1/2 preservadas
  durante liga/desliga HQ. HQ encerra readyfalse/0readers ao liberar viewer.
  Grade/as-run0, PGMnull/playingfalse; emissores exit0/sem force/sem erros e
  servidor/carrier/família própria encerrados.
- `scratch/qc-native-browser-IKToaz`: tentativa recusada antes de capturas por exigir
  ID de cadastro num CUE avulso por referência; não é aprovação do áudio.

CUE avulso transporta referência e tem abertura nativa real, não eco obrigatório
de configuredSourceId. O verificador usa referência/previewFrame/itemId/decoderId;
não inventa identidade de cadastro ou de PGM a partir do PVW.

## Limites e próximos passos

Sobreposições explícitas de servidor/engine sobre runtimes r71; não instalação
r76. Fontes sintéticas locais, não equipamento externo. Tons finitos e teste
raw de2s não certificam fidelidade/loudness/continuidade de longa duração.
O primeiro ensaio visual não valida HQ OMT; resultado do replay afetado abaixo.
Revisão de arquivo4:3/vertical/resize, outros protocolos, áudio humano/4K,
controle remoto e carga continuam abertos. A linha de fonte não sintonizada
ainda conserva idade do último quadro sem rótulo histórico explícito; melhoria
de clareza a tratar em2.1/3.7, não confundir com sinal medido atual.

Habilidade computer-use utilizada para selecionar pelo QC, alternar qualidade,
tela cheia e safe, medir DOM visível e registrar capturas; não foi usada para
executar comandos ou alterar conta/dados operacionais. Aba própria encerrada.

## Replay visual afetado concluído

`scratch/qc-native-browser-r4h6Yo` com engine191CD1E1/servidorA709115F/webCD7665DE:
PASS e `assertions-qc-browser.json` PASS. OMT selecionado no próprio QC,
428×240/ready4 → botão de qualidade →640×360/ready4 → retorno428×240/ready4,
scopes AMOSTRADO em todas as observações finais. Safe continua desligado por
padrão. Nenhum Master/TAKE/PGM: grade/as-run0/playingfalse em todas as consultas.

Três capturas independentes com pixels e áudio997Hz estéreo relidos. Na HQ,
RMS0,03532/0,03532 e5/5janelas concentradas, em vez da lacuna anterior.
Estado nativo antes/depois identifica decoder1; liga/desliga de encoder não
reabre a entrada. HQreadyfalse/0readers no retorno, PVWreadytrue/1reader.
Emissor exit0/sem force/erros[], família própria encerrada e aba própria fechada.
Os leitores finitos agora usam allSettled para drenar ambos mesmo em falha;
não matar o leitor de imagem porque o leitor PCM terminou com erro.

`observe-qc-native-state.mts` usa login apenas na conta QA e GETs de estado;
tentativas iniciais falharam por envelope incorreto da resposta (`view.view`),
com asserção do Node ao encerrar a CLI após erro. Script corrigido e leituras
posteriores aprovadas. Isso não é falha de runtime do produto/servidor.

R76 parcial gerada540204327bytes/SHA256
`3A2BC3D46BA5B9CC033B96F2153FA496E5749399DBDD5A7FF698A46562332FF0`;
integridade7094hashes/7095entradas PASS emmemória, sem instalar/executar ZIP.
Não repetir a suíte web/servidor inalterada. Tipos dos leitores e sintaxe do
verificador PASS; diff--check dos arquivos nativos afetados PASS. Sem limpeza,
migração de pastas, publicação externa ou alteração da rede/dados operacionais.

10 grupos/53verificações:7concluídas/35andamento/4pendentes/7v3 mantidos.
