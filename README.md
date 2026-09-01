# RPlayout

Sistema de playout para TV e streaming: rundown por horário real, grafismo em
camada, entradas SDI/NDI/SRT/RTMP e saídas SDI/RTMP/SRT, com servidor RTMP
rodando na própria máquina.

O plano completo de arquitetura, modelo de dados e roadmap está em
[`docs/PLANO.md`](docs/PLANO.md).

## Decisões travadas

- **Plataforma:** Windows (NDI nativo, NVENC, Decklink)
- **Motor de vídeo:** GStreamer, um pipeline por canal
- **Interface:** Web (backend serve a UI, vários operadores)
- **Canais:** multicanal desde o início
- **Grafismo:** camada CEF com templates HTML + editor
- **Áudio:** nivelamento por loudness (EBU R128) com os mesmos escopos do trim; limiter de true peak como proteção
- **Hardware SDI:** Decklink Duo 2 / Quad 2, entrada e saída, placa como clock mestre
- **Servidor interno:** MediaMTX local (RTMP/SRT/HLS/WebRTC, ingest e distribuição)
- **Automação:** motor de regras determinístico, Claude como camada opcional

## Como rodar

```bash
pnpm install

# semeia um canal, doze arquivos com loudness desigual e uma grade de noite
pnpm --filter @rplayout/server seed

# servidor (API + WebSocket) na 4000
pnpm --filter @rplayout/server dev

# interface na 5173, com proxy para a 4000
pnpm --filter @rplayout/web dev
```

### Com o engine de vídeo

Sem `RPLAYOUT_ENGINE`, o servidor usa o transporte simulado e a grade inteira
continua operável numa máquina sem GStreamer. Apontando para o binário, o take
passa a mover vídeo de verdade:

```bash
cd apps/engine && cargo build --release

RPLAYOUT_ENGINE=apps/engine/target/release/rplayout-engine \
RPLAYOUT_ENGINE_OUTPUT=null \
pnpm --filter @rplayout/server dev
```

`RPLAYOUT_ENGINE_OUTPUT` aceita várias saídas separadas por vírgula: `null`,
`file:<caminho>`, `rtmp://…`, `srt://…` e `snapshot:<padrão.jpg>`.

### Com o servidor de mídia local

```bash
RPLAYOUT_MEDIAMTX=/caminho/para/mediamtx \
RPLAYOUT_RELAY=apps/engine/target/release/rplayout-relay \
RPLAYOUT_ENGINE=apps/engine/target/release/rplayout-engine \
pnpm --filter @rplayout/server dev
```

Com `RPLAYOUT_MEDIAMTX` definido, o engine passa a publicar o programa no
servidor local por loopback e a variável de saída é ignorada: quem distribui é o
servidor, não o encoder. A config do MediaMTX é gerada a partir do banco e
reescrita a cada mudança de chave ou destino -- ele observa o próprio arquivo e
recarrega, então criar ou revogar chave não derruba quem está no ar.

Portas: RTMP 1935, SRT 8890, HLS 8888, WebRTC 8889. A API de controle (9997) e
o RTSP interno (8554) ficam em loopback e nunca são abertos no firewall.
`RPLAYOUT_MEDIAMTX_BIND` escolhe a interface; o padrão vale para a rede local e
`/api/distribution` informa quando o servidor está exposto a todas.
`RPLAYOUT_MEDIAMTX_LOGLEVEL=info` faz o servidor dizer **por que** fechou uma
conexão -- é a única fonte que explica uma publicação recusada.

Para exercitar sem acervo, semeie apontando para uma pasta de arquivos reais:
`RPLAYOUT_MEDIA_DIR=/caminho/para/midia pnpm --filter @rplayout/server seed`.

`pnpm test` roda a suíte; `pnpm typecheck` e `pnpm lint` cobrem o resto.
A grade semeada nasce a partir do relógio da máquina, então as âncoras fecham a
qualquer hora do dia.

## Estrutura

```
packages/protocol    domínio compartilhado: frames, timecode, âncoras, loudness
packages/scheduler   motor de tempo, função pura e sem I/O
apps/server          Fastify + SQLite, API REST e estado ao vivo por WebSocket
apps/web             React + Vite, o rundown e os monitores
```

## Status

Planejamento concluído. **F0** e **F1** entregues:

- Motor de remanejamento com âncoras `FLOW`, `FIXED`, `SOFT` e `WINDOW`,
  recuperação de tempo por ordem de custo e conflitos explicados em texto.
- Timecode com drop-frame correto e frame rate como razão exata.
- Nivelamento por loudness com ganho calculado e teto no true peak.
- Corte e nível com os quatro escopos, inclusive padrão do acervo.
- Inserção de item por horário, com a grade se remanejando em volta.
- Interface escura com rundown, PGM, preview, medidores e painel de conflitos.
- Transporte simulado, com o mesmo contrato que o engine vai cumprir na F2.

**F2** em andamento:

- Engine Rust/GStreamer entregue e verificado ponta a ponta.
- Servidor liga no engine: o take da interface move vídeo de verdade, a posição
  vem de quem está tocando o arquivo, o medidor do programa é medição real e a
  grade vira de item sozinha no fim de cada trecho.
- Servidor de mídia local: config gerada do banco, chaves de convidado que
  criam e revogam caminhos, e o programa publicado por loopback e legível de
  volta pelo servidor.
- Relays entregando a destinos externos, com estado e contagem do que foi
  efetivamente entregue.
- Saídas de rede isoladas: cada destino do canal roda em pipeline próprio e
  reconecta sozinho, então o servidor de mídia cair não tira o programa do ar.
- Painel de distribuição na interface, em `#distribuicao`: endereços do programa
  para copiar, chaves de convidado com quem está conectado, a saída do canal com
  o que já foi entregue, e destinos com o estado do relay.
- Monitores de PGM e preview com imagem de verdade, por WHEP direto do servidor
  de mídia.
- Barramento de preview no engine: armar um item ou abrir um arquivo do
  explorador toca no preview sem encostar no que está no ar.
- Medição EBU R128 de verdade, no programa e no preview: loudness momentânea,
  de curto prazo e integrada gateada, faixa de loudness, pico verdadeiro
  sobreamostrado e correlação de fase.
- Falta: som nos monitores e o limiter de pico verdadeiro na saída — enquanto
  não existe, o medidor mostra a faixa de loudness no lugar da redução de ganho,
  porque um GR fixo em zero pareceria "está tudo sob controle".

Anotado para depois, com o levantamento pronto na seção 13 do
[plano](docs/PLANO.md): **ingest de arquivo de verdade** (hoje o acervo vem do
seed; não há varredura de pasta) e **perfil de saída por destino**, com varredura
entrelaçada para 1080i5994.

### A medição de loudness é nossa

Não existe elemento de EBU R128 nesta instalação do GStreamer -- só o `level`,
que entrega RMS. RMS não é loudness: não tem a ponderação K nem o gate, então
dois programas com o mesmo RMS soam com volumes bem diferentes. Como o
nivelamento inteiro do RPlayout é em LUFS, medir com RMS contaminaria a única
métrica que diz se o nivelamento está certo.

Então a medição é feita em Rust, sobre as amostras do mix, seguindo a
ITU-R BS.1770-4: ponderação K em dois biquads, blocos de 400 ms com 75% de
sobreposição, gate absoluto de -70 LUFS e gate relativo de -10 LU para a
integrada, e de -20 LU com percentis 10/95 para a faixa. O pico verdadeiro sai
de um sobreamostrador polifásico de 4x, porque pico de amostra não é pico
verdadeiro -- o sinal reconstruído passa por cima das amostras, e é o valor
reconstruído que estoura no conversor do destino.

O acumulado usa histograma de 0,1 LU em vez de guardar um valor por bloco: um
canal de playout fica meses no ar, e uma lista de blocos de 100 ms viraria
gigabytes. A memória fica fixa e o erro de quantização, abaixo do que qualquer
medidor mostra.

A integrada reinicia a cada take. O que o operador precisa saber é se **este VT**
saiu no alvo, não a média do canal desde que ligou. A janela deslizante é
esvaziada junto: sem isso, três décimos de segundo do item anterior sobrevivem
ao gate relativo e mascaram o item inteiro que veio depois -- medido, um item
20 dB mais baixo lia 12 LU de diferença em vez de 20.

Conferido contra um tom de 1 kHz a -20 dBFS: o medidor lê -20,00 LUFS
momentânea e -20,07 integrada, contra -19,99 calculado da resposta do filtro K.
Os nove testes do medidor não usam número decorado -- o esperado sai dos
próprios coeficientes.

### O preview é um tocador à parte

O item armado não vira preview com outro destino: o `inter` do GStreamer fixa a
superfície ao entrar em PAUSED, então um item não muda de barramento depois de
aberto -- e um item que publicasse nos dois vazaria para o programa no take.

Então o preview abre o arquivo de novo, no barramento dele, e toca. Custa abrir
o arquivo duas vezes e ganha o que o operador precisa: olhar um arquivo que nem
está na grade sem tocar no que vai ao ar, e o item armado continuar parado no
ponto de entrada, pronto para o take imediato.

O preview sai em metade do tamanho e um terço do bitrate do canal. É um monitor,
não uma saída: codificá-lo em 1080p50 dobraria o custo do canal para nada.

### Monitores por WHEP

O MediaMTX já fala WHEP, então o monitor não precisa de sinalização nossa: a
interface oferece, recebe a resposta e mostra. A imagem não passa pelo servidor
de aplicação.

O endereço é montado com o nome de máquina pelo qual a interface foi aberta --
o servidor manda só a porta e o caminho. Deduzir o IP no servidor é exatamente
como o monitor fica preto para quem acessa por outro nome.

O monitor pede **só vídeo**. O WebRTC não fala AAC e o canal sai em AAC: pedir
áudio faz o servidor recusar a sessão inteira em vez de mandar só a imagem.
Quem responde pelo som na interface são os medidores, que vêm do próprio mix.
Som nos monitores depende de um caminho em Opus, e nenhum dos dois jeitos de
publicar Opus no MediaMTX existe nesta instalação do GStreamer
(`whipclientsink` e `rtspclientsink` ausentes; RTMP e o `mpegtsmux` daqui não
carregam Opus).

Um navegador sem H.264 -- o Chromium de codecs abertos, por exemplo -- recebe
`codecs not supported by client` do servidor. O monitor mostra isso como
`NAVEGADOR SEM H.264` em vez de `SEM SINAL`, porque as duas coisas pedem
providências opostas.

### Como o relay entrega

Um processo por destino: lê o programa do servidor local por RTSP em loopback e
empurra por RTMP **sem recodificar** -- só troca de embalagem, do RTP para o
FLV. O H.264 e o AAC que chegam ao destino são os mesmos que o canal codificou.

Três coisas precisaram ser verdade ao mesmo tempo, e cada uma custou um defeito:

- Os fluxos do `rtspsrc` só aparecem **depois** do PLAYING, e nesse momento os
  dados já correm. Um ramo que empurra sem destino leva `not-linked` e para de
  vez -- era isso que deixava o vídeo mudo enquanto o áudio passava.
- O `no-more-pads` do `rtspsrc` chega **antes** dos próprios pads, então esperar
  por ele monta a saída vazia.
- Um `flvmux` que começa com um fluxo só escreve um cabeçalho que o destino
  recusa, e um sem pad nenhum atrapalha a subida.

A saída foi reservar os dois lugares do muxer antes de qualquer fluxo aparecer e
ligar cada ramo assim que ele é anunciado. O programa de um canal sempre tem
vídeo e áudio, então os dois lugares sempre são ocupados.

### A saída de rede não pode derrubar o programa

Uma saída de rede falha por motivo que não é culpa do playout: o servidor
reinicia, a rede oscila, o destino recusa. Dentro do pipeline do canal essa
falha não ficava contida -- o sink devolve erro de fluxo, a fila para, o `tee`
propaga o erro para cima e o canal inteiro morre. Era o "Internal data stream
error" em cascata que derrubava o PGM junto com o RTMP, com o compositor
produzindo imagem normalmente o tempo todo.

Agora cada saída de rede vive num pipeline separado, alimentada pelo canal por
um par `inter`. O canal só entrega o sinal cru; quem codifica, muxa e empurra é
outro processo de dados. Uma falha derruba a si mesma e volta sozinha, com
espera crescente entre as tentativas, e a interface mostra a diferença entre
"no ar" e "no ar chegando a algum lugar" -- a saúde vem da contagem de buffers
que o sink recebeu, não do estado do pipeline.

Verificado matando o servidor de mídia com o canal no ar: o contador de frames
do compositor não piscou e a saída voltou por conta própria quando o servidor
subiu de novo.

### `flvmux` sem folga quebra o RTMP

O sintoma eram duas recusas do servidor que pareciam de conteúdo -- `unexpected
video packet` e `received type 3 chunk without previous chunk` -- e que
apareciam só com material de verdade: preto passava, barras não.

A causa é o `flvmux` com `latency=0` e fontes ao vivo. Sem folga ele fecha o
pacote com o que tiver na mão e deixa o carimbo de tempo andar para trás quando
uma trilha atrasa. No RTMP o carimbo do pedaço é uma **diferença de 24 bits**:
diferença negativa vira número gigante, o destino perde o fio do fluxo de
pedaços e fecha a conexão. Meio segundo de espera no muxer -- no engine e no
relay -- é o que separa uma saída que entrega de uma que reconecta para sempre.
