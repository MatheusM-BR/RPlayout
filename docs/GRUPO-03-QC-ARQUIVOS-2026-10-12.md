# Grupo 3 — QC de arquivos: diagnóstico e evidência

## Motivo do vertical ausente da lista padrão

Não houve falha de codec, proxy ou exclusão. `ingest.ts` marca material novo
sem vídeo, sem áudio ou com largura/altura < 0,8 como ignorado. O vídeo
sintético 360×640 atende essa condição. A decisão já existente é preservada
nas novas varreduras. Não alteramos essa política nem aprovamos os arquivos.

A sessão anterior encerrou pelo limite de 20 minutos: `result.json` registra
COMPILED_WORKFLOW_PASS e serverExitObserved=true. O endereço antigo deixou
de responder porque era servidor temporário de verificação, não o playout
operacional. O novo teste foi iniciado somente após confirmar o encerramento.

## Verificação real desta rodada

- Script: `scripts/verify-qc-file-browser.mts`; adicionadas asserções de
  ignored e probeError, sem liberar vertical artificialmente.
- Evidência nativa: temp `RPlayout-QC-file-browser-Bwfjv3/workflow-result.json`.
- Servidor AA08FB5F3CE41D10134DF73F0C897786311E295FE50018C23DFB69EF6852FB58.
- Proxy 38D57460E24227ADA5211A1F44A4F3B2FA343E69C58E0D00AF815AA85E69DE3C.
- Arquivos H264/AAC sintéticos: 640×360 → 426×240; 640×480 → 320×240;
  360×640 → 136×240. Proxy nativo decodifica vídeo e áudio; hashes de
  download de proxy e original conferidos. Todos permanecem PENDING.
- Navegador: 4:3 proxy 320×240 e original 640×480, readyState=4.
  Área do player 704,8×396,45; safe area 528×396, centralizado na imagem.
- Aba IGNORED mostra o vertical, explica que ignorado não é rejeição de QC,
  e permite inspeção sem aprovar. Proxy vertical 136×240, readyState=4;
  safe area 224,4×396. Original 360×640, readyState=4; safe 222,75×396.
  A pequena diferença acompanha a proporção arredondada do proxy.
- Selecionar outro arquivo retorna ao preview leve; modo original é explícito.
- Safe desligado ao entrar. Ativado somente para medir nesta rodada.
- PGM permanece PARADO; engine desabilitado na fixture.
- Captura: `scratch/group03-qc-vertical-original-20261012.jpg`.

## Limites e próximos passos

### Volume de payload do preview de arquivos

Medição read-only sobre a fixture concluída FFV1, sem scan/reencode/reinício:
`scripts/verify-qc-preview-budget.mts`, resultado `preview-budget.json` em
`RPlayout-QC-file-browser-jxOUoX`. Hash do original/proxy novamente conferido
antes de medir tamanhos, duração obtida da edição sondada no banco da fixture.

| Formato | Original médio | Proxy médio | Redução de bytes |
| --- | ---: | ---: | ---: |
| 16:9 H264/AAC |2199kbps|277kbps|87,42%|
| 4:3 H264/AAC |2202kbps|277kbps|87,43%|
| Vertical H264/AAC |2202kbps|276kbps|87,46%|
| FFV1/Vorbis |1745kbps|248kbps|85,77%|

São médias de bytes de arquivos completos sobre duração de cerca10s, não
throughput instantâneo, WebRTC/WHEP, economia universal por codec ou CPU/RAM.
3.6 permanece pendente de medidas na estação remota. A primeira execução
recusou recibo antigo por ausência de serverExitObserved persistido; confirmado
que result.json é escrito em finally após encerramento. Verificador principal
agora persiste o flag, antes exclusivo do stdout. Leitor aceita esse legado
somente pelo recibo final, nunca workflow-result.json. Banco sempre readonly.

### Atualizações de estatísticas dos scopes

Inspeção confirmou que canvases de modos ocultos não estão montados; não
inventamos otimização dessa parte. Waveform/vectorscope, porém, publicavam
novo objeto React em cada ciclo mesmo com medições idênticas. Agora preservam
a identidade do estado se todos os valores exibidos permanecem iguais.
Desenho e amostragem continuam10Hz; alteração de valor ou legalGamut/clipping
sempre publica estado novo, e perda de amostra continua limpando para null.
15 testes afetados PASS; tipos web PASS. Não equivale a benchmark remoto,
redução de bitrate ou homologação de fluidez/áudio:3.6/3.7 seguem abertas.

### Geometria subpixel

Correção subsequente: QcSafeAreaOverlay deixa de usar clientWidth/clientHeight
inteiros e usa contentRect fracionário do ResizeObserver. A medida inicial
vem do bounding rect do player (sem bordas/padding). Evita a diferença de
0,45px observada em resize. Não adiciona processamento por quadro de vídeo.
Regressão inclui três tamanhos fracionários e três proporções, limites dentro
do painel e proporção preservada. Lote52 testes PASS. A primeira checagem de
tipos detectou tuplas de teste inferidas como arrays abertos; corrigidas com
`as const`, sem alterar código de produção ou reduzir asserções.
Essa correção ainda requer repetição visual dirigida, não homologa3.4 por
teste do cálculo isoladamente. Não repetimos engine/NDI/OMT nesta rodada.

### Layout responsivo e saída de tela cheia

Fixture `RPlayout-QC-file-browser-JCBDzD`, servidor exclusivo e PGM desativado.
4:3 proxy320×240 em viewport1280×720: player823,2×463,05; safe617,325×463,
centralizado. Em960×720: player927,2×521,55; safe696×522, diferença inferior
a1px por clientWidth/clientHeight inteiros. ResizeObserver atualiza geometria.
Tela cheia abriu. Esc no navegador integrado não saiu; não presumir bug em
todos os browsers nem registrar o atalho como homologado. Adicionado botão
Sair da tela cheia, visível somente no :fullscreen. Browser confirmou botão
e retorno à tela QC ao clicar, sem TAKE/PGM. Viewport temporário restaurado.
12 testes afetados PASS, tipos web exit0 e build index-rPEJsssO.js PASS.
Captura de retorno `scratch/group03-qc-fullscreen-return-20261012.jpg`.
Não fecha3.4: ainda validar vertical e estação remota, além da diferença
subpixel dos limites e equivalência de viewport/captura na tela cheia do IAB.

### Fallback real no navegador — FFV1

Fixture opcional `--codec-fallback` cria MKV FFV1/Vorbis sintético; nenhuma
metainformação ou aprovação é semeada. Native workflow PASS para os quatro
arquivos, incluindo proxy H264/AAC e JPEG original 0/12/23 do FFV1.
Evidência: temp `RPlayout-QC-file-browser-jxOUoX`.

Falha encontrada no navegador: FFV1 chegou a readyState=4 com videoWidth=0
e videoHeight=0, pois somente o áudio era decodificável. Não houve onError;
a interface anterior permanecia preta. Correção: metadata sem raster de
imagem dispara inspeção por quadros e pausa o player, sem alegar escuta.

Após build index-DwhwODAk.js e reload, navegador confirmou fallback automático,
aviso explícito, reprodução desabilitada e SEM ESCUTA. Quadro13/24 selecionado
gera `/frame/12.jpg?total=24&quality=original&hash=...`; imagem complete=true,
naturalWidth=640/naturalHeight=360 e nenhum elemento video montado. Retorno ao
leve confirmou video426×240, readyState=4, posição5,269565s (TC5,28s). Todos
os arquivos permanecem pendentes; PGM PARADO, engine desabilitado.
Captura `scratch/group03-qc-ffv1-fallback-20261012.jpg`.
39 testes web afetados PASS, tipos web exit0 e build PASS; bundle grande
continua como aviso. Não fecha3.5 integralmente: fontes live externas ainda
precisam de homologação, não confundir fixture com aprovação broadcast.

### Extração nativa dos quadros de fallback

Rodada seguinte encerrada exit0, evidência temporária
`RPlayout-QC-file-browser-JXVsd6/result.json`: nove respostas JPEG originais
nas posições 0/12/23 dos três formatos. Cabeçalhos SOF dos bytes recebidos
conferidos: 640×360, 640×480 e 360×640; rendition qc-jpeg da largura original,
sem redirecionamento para miniatura. Hash de cada JPEG registrado. Não é
prova de reprodução do fallback na interface nem de fidelidade colorimétrica.
Engine de PGM desabilitado; servidor exclusivo terminou por TTL curto.

A leitura do probe nativo revelou dois mapas de tempo distintos: JPEG de
qualidade usa i/(N-1), miniatura usa o centro do intervalo. A conversão do QC
agora seleciona o ponto original mais próximo em modo qualidade e o intervalo
de navegação no modo leve. 32/32 testes web afetados PASS e tipos web PASS.

### Correção subsequente do fallback

O erro de reprodução agora calcula o quadro de navegação a partir do tempo
do player, em vez de voltar ao quadro inicialmente selecionado. Valores sem
duração, NaN/Infinity e limites do clipe são normalizados para 0..23.
A troca de rendition monta outro elemento de vídeo; erro atrasado de um
elemento desmontado não pode ativar fallback no player atual.
O botão de qualidade usa a mesma conversão segura de posição.

Validação em lote: 40/40 testes em media-preview, qc-inspection-controls,
qc-quality-markup e lightweight-preview-routes PASS; typecheck web exit0 e
build Vite PASS (index-D8dg_ssu.js). O aviso de bundle acima de 500 kB
permanece. Esses testes não simulam um navegador real sem codec: a homologação
visual do fallback continua aberta, sem fechar 3.5 por evidência unitária.

Não fecha integralmente 3.4/3.5: ainda faltam resize/fullscreen desses
arquivos e fallback de codec indisponível. 3.6 depende de medições remotas;
3.7 ainda requer fluidez/áudio/múltiplos viewers. Contagens não alteradas:
10 grupos/53 verificações; 6 concluídas, 32 em andamento, 8 pendentes,
7 adiadas à v3. Escopo atual: 9 grupos/46 verificações.
