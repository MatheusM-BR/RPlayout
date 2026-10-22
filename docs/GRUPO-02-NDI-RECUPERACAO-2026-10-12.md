# Grupo 2 — NDI e recuperação em 12/10

## Alterações do produto

- Vídeo separado por fila antes de conversão/desentrelaçamento/ajuste de FPS,
  não somente na ponta da cadeia. Isso desacopla o processamento do demux.
- Entrada ao vivo nunca recebe imagefreeze por ausência temporária de FPS
  negociado. Imagens de arquivo mantêm o tratamento de duração existente.
- Saídas inter internas ao vivo usam async=false: adicionar uma trilha dinâmica
  não depende de novo preroll global. Isto NÃO autoriza TAKE por PLAYING;
  vídeo/áudio exigido continuam dependentes de buffers recentes efetivamente
  entregues, como demonstram os casos nativos de sinal vencido.
- Recuperação no laço do engine vinculada a item E identidade do decoder que
  falhou. STOP, outra abertura/TAKE e LOAD do operador cancelam a tentativa
  antiga. Uma abertura de recuperação própria ainda pendente é respeitada;
  se for recusada assincronamente, nova tentativa aguarda backoff de 2s.
- Leitura do bus de PGM e recuperação compartilhadas com o ensaio nativo.
  EOS de live continua SourceLost, nunca fim de item que avança a playlist.

As mudanças foram investigadas em conjunto. Não atribuir cada falha histórica
a uma única causa isolada apenas porque a rodada final passou. Separação de
fila sozinha e bloqueio de imagefreeze sozinho NÃO resolveram a intermitência.

## Evidências finais

- Test binary compilado sem baixar dependências.
- Rodada integral Rust rplayout-engine, sessão45879, exit0: **94 PASS / 0 FAIL /
  3 ignored**, 79,55s. Os ignorados são diagnósticos nativos explicitamente
  separados; não qualificá-los como PASS nesta suíte. Inclui arquivos com
  caracteres especiais, Mark In, ausência de vídeo/áudio, ganho/auxiliares
  8/16 canais, lease QC, idade do sinal e duas políticas novas de recuperação.
- NDI, sessão71739: **1 PASS**, 12,93s, após conjunto final do produto.
- NDI repetido, sessão82480, exit0: **1 caso PASS, 3 ciclos**, 30,57s.
  Mesmo nome Unicode anunciado pelo provider oficial, teardown/reabertura
  completos, fonte 320x180/25, áudio 2ch/48k, CUE PVW independente sem PGM,
  LOAD/TAKE, imagem branca e seno no programa, fechamento do PVW preservando
  PGM, ausência real de buffers após parar o publisher e retorno de imagem
  VERMELHA/áudio. Cor diferente exclui falso positivo de quadro branco retido.
  Identidades PGM 2/4/6 permaneceram durante os retornos curtos de cada ciclo.
  Não houve SourceLost/EOS nesses três retornos: reabertura automática após
  timeout longo NÃO foi comprovada por esses três ciclos; o caso separado
  abaixo é a evidência local dessa reabertura. Não confundir os escopos.
- Caso NDI de timeout longo, sessão22998, exit0: **1 PASS**,16,87s.
  Publisher permaneceu parado até EOS real do receptor NDI; o mesmo laço
  de produção gerou SourceLost com item/decoder2 correto, nunca Eos de item.
  Após retorno do emissor, backoff e reabertura automática, decoder3 recebeu
  vídeo/áudio e entregou nova imagem vermelha ao PGM, preservando o item da
  fonte. Retry da abertura antiga foi limpo. Nenhum EOS artificial foi injetado.
  Adição posterior somente de fixture: não repetida a suíte94/3, nem os três
  ciclos inalterados. Novo diagnóstico integra os ignorados por padrão.
- OMT final, após últimas mudanças compartilhadas, exit0: **1 PASS**, 9,20s.
  Publicação/recepção SDK, discovery, appsrc, CUE/TAKE, formato original,
  perda expirada, retorno vermelho/áudio com clock do emissor reiniciado,
  mesmo decoder e cleanup. Nenhuma exceção de logging reportada.

Não somar replays ou três ciclos como três verificações da matriz. Não
transformar regressão da intermitência em homologação prolongada/externa.
Nenhum servidor operacional ou entrada física foi comandado pelo ensaio.

## Histórico de falhas preservado

- Primeira execução em cwd apps/engine: StateChangeError ao iniciar publisher.
  Runtime NDI embutido existe em raiz/apps/server, não nesse cwd; execuções
  seguintes usaram cwd raiz e PATH explícito apps/server/GStreamer. Isto não
  demonstra que todo contexto de instalação já encontra o runtime.
- Sessões72176/46360/52748: falha PVW em 8s; discovery real presente, diagnóstico
  mostrou descarte na fila de recepção e sinal ausente/parado.
- Sessão75406: PASS local inicial, antes de exigir imagem nova no retorno.
- Sessão45394: OMT anterior PASS, NDI FAIL no retorno em 8s. A fixture passou
  a servir o mesmo laço de recuperação do produto e a janela de retorno cobre
  receive timeout5s, backoff2s e connect timeout10s; não reduziu as exigências
  de conteúdo, áudio, tally ou recebimento de buffers novos.
- Sessões58717/75439/2481: OMT com perda/retorno PASS onde executado, NDI FAIL
  no PVW. Houve casos com um quadro/áudio inicial vencido e outro com vídeo
  recente sem áudio. Não esconder esses resultados atrás do PASS inicial.
- Instrumentação cfg(test) de estados/filas permanece disponível, sem custo
  no engine de produção. Todas as sessões citadas são terminais.

## Ambiente e reprodução

NDI Runtime embutido FileVersion6.3.2.0; gst-plugin-ndi0.15.3-e92296285;
libomt.dll FileVersion1.0.0.19. Execução nativa exigiu rede local autorizada.

Na raiz do projeto, PATH inclui apps/server e bin do GStreamer. Rodada NDI:
test binary rplayout_engine-3aacffbcf4604bfc.exe,
filtro native_ndi_three_openings_and_recoveries, --ignored --nocapture.
OMT usa RPLAYOUT_OMT_RUNTIME apontando a third_party/omt/win-x64/libomt.dll
e filtro omt::tests::native_publisher_transmits_video_and_audio_to_loopback_receiver.
Cada ciclo tem watchdog60s incluindo cleanup e só usa pipelines próprios.

Referências primárias consultadas: propriedades do ndisrc e isolamento da
fila; código upstream do demux confirma pads dinâmicos e caps ANY no template.
O código upstream main não substitui prova da versão instalada.

- https://gstreamer.freedesktop.org/documentation/ndi/ndisrc.html
- https://gstreamer.freedesktop.org/documentation/coreelements/queue.html
- https://raw.githubusercontent.com/GStreamer/gst-plugins-rs/main/net/ndi/src/ndisrcdemux/imp.rs

## O que falta

2.1 aprovação visual e física dos estados/alertas; 2.2 DeckLink ADIADA pelo
usuário; 2.3/2.4 fontes externas e teste prolongado; retry após timeout NDI
comprovado localmente, não aprovação de reconexão externa/OMT prolongado.
2.5 navegador/API compilada com engine final e operação de fontes
distintas; 2.6 ATEM/GPIO/routers habilitados ou decisão explícita de não aplicação.
Depois seguir grupo3 (QC/remoto), sem declarar grupo2 inteiro concluído.

Totais mantidos: **10 grupos:1 concluído/9 abertos;53 verificações:5 concluídas,
36 em andamento,12 pendentes**. Nenhum instalador novo gerado nesta rodada.
Migração C:→D: somente discutida/conferida; nenhuma pasta copiada ou removida.

## Binários

Engine release compilado nesta rodada, sessão56953, exit0,11,68s:
`apps/engine/target/release/rplayout-engine.exe` SHA256
`8DA0D9247C5E7A2ECAA4C6206A7AAEDE434731A6052239B4F6D7FEE997020D6E`.
Não instalado no servidor em operação nem incorporado a novo ZIP.

Test binary da suíte94, três ciclos NDI e OMT final: SHA256
`96A3C759AD2334BE747BEDD0DA0769C96B0FE496E3A647ABA3C9BB0A38F5AB6C`.
Após acrescentar somente a fixture de timeout longo: SHA256
`D7BA40EF09D23BEA420236903621C712C26B1855AC113906A5803F487F9DA057`.
Produto release inalterado por essa adição cfg(test), sem rebuild por status.

Conferência textual detectou linha em branco no EOF preexistente do prompt
de continuação, fora dos trechos alterados neste lote; não declarar diff-check
integral limpo nem corrigir silenciosamente outras edições.
