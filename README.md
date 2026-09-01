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
- Limiter de pico verdadeiro na saída de programa, com lookahead, e a redução
  de ganho no medidor.
- Falta: som nos monitores.

**F2.5** em andamento:

- **Ingest de arquivo de verdade**: varredura de pasta, identificação por
  SHA-256, sonda que abre o arquivo com o mesmo GStreamer que vai tocá-lo,
  medição EBU R128 do arquivo inteiro e miniatura tirada do próprio vídeo.
- **Varredura entrelaçada**: canal em 1080i5994 com a gravação as-run em campos
  e a saída de rede em 1080p2997, ao mesmo tempo.
- **Toda saída que codifica roda em pipeline próprio**, inclusive a gravação
  as-run: nenhuma delas consegue derrubar o programa.
- **Perfis de saída persistidos e editáveis**, no painel de distribuição.

### SRT precisa de pacote alinhado

O SRT manda datagramas de tamanho fixo. Sem alinhar, o `mpegtsmux` entrega
buffers de tamanho qualquer, o `srtsink` os corta em datagramas que não caem na
fronteira do pacote de transporte de 188 bytes, e o receptor não ressincroniza.
`alignment=7` -- sete pacotes, os 1316 bytes do payload padrão do SRT -- resolve.

O sintoma engana: o caminho fica **pronto** no servidor, com as trilhas
identificadas, bytes entrando e bytes saindo para os leitores, e **nenhum
leitor decodifica um quadro**. Testado por RTSP, por SRT e por RTMP, os três
liam zero; o mesmo MPEG-TS gravado em arquivo decodificava sem reclamar.

Isto estava na nossa saída SRT desde que ela foi escrita, e passou porque eu só
tinha verificado a saída RTMP.

Junto veio um segundo defeito, do tipo que mente para o operador: a contagem de
entrega só olhava `BUFFER`, e o `mpegtsmux` empurra **lista** de buffers. Com a
saída SRT funcionando, o painel dizia "conectando" para sempre. A sonda agora
conta as duas formas.

Verificado: canal publicando por SRT no servidor local, `NO AR` com contagem
subindo, e a imagem lida de volta.

### Fonte ao vivo é um item como outro qualquer

Um estúdio entra na grade pelo mesmo caminho que um VT. Fonte com esquema de URI
-- `srt://`, `rtsp://`, `rtmp://` -- passa pelo mesmo `uridecodebin` do arquivo,
então o resto do canal não sabe a diferença. Placa e NDI têm elemento próprio.
Convidado publicando no servidor local vira `guest:<chave>` e é lido por RTSP em
loopback, como os relays: nunca pela rede.

**Fonte ao vivo que cai não anda com a grade.** Arquivo acaba e avisa; estúdio
que some é falha, não fim de item. O engine reporta `sourceLost`, fica tentando
reabrir de dois em dois segundos, e o programa fica no preto do canal até
voltar. A hora de sair continua sendo a que a grade marcou -- pular para o item
seguinte porque o link caiu adiantaria a programação inteira.

E o inverso: **nada tira um item ao vivo do ar sozinho**, então quem marca a
hora de sair é a grade. Sem isso a programação pararia atrás de um estúdio que
ficou no ar para sempre.

Verificado ponta a ponta: estúdio publicando no servidor local, take, barras no
PGM; estúdio derrubado, a grade não andou; estúdio de volta, a imagem voltou
sozinha.

Sem placa, `sdi:0` responde *"a entrada sdi:0 não respondeu -- confira se a placa
está instalada, se o sub-dispositivo existe e se há sinal nele"*, e `ndi:` diz
qual plugin falta. "Element failed to change its state" é a verdade e não serve
para nada.

### Quem enumera as fontes é o GStreamer, não a interface

A interface não adivinha quantos sub-dispositivos uma placa expõe nem quem está
anunciando NDI na rede: quem responde é `rplayout-devices`, um binário que usa o
mesmo GStreamer que vai abrir a entrada. Ele distingue três coisas que uma lista
vazia confunde -- **sem driver**, **driver presente e nenhuma placa**, **plugin
ausente** -- e o diálogo de inserir item mostra o motivo em vez de um seletor
mudo.

A descoberta só roda quando o operador pede o vivo, e o resultado vale por
quinze segundos: varrer NDI vasculha a rede, e quem só quer pôr um VT na grade
não deve pagar por isso. Convidados ativos no servidor local entram na mesma
lista como `guest:<chave>`.

```bash
RPLAYOUT_DEVICES=apps/engine/target/release/rplayout-devices \
RPLAYOUT_PROBE=apps/engine/target/release/rplayout-probe \
pnpm --filter @rplayout/server dev
```

Sem `RPLAYOUT_DEVICES` a lista fica só com os convidados, e o diálogo diz que a
descoberta não está configurada -- não finge que a máquina não tem placa.

### Arquivo mudo não pode travar o item

A cadeia de áudio do item só entra no pipeline quando aparece uma trilha de
áudio de verdade. Montá-la à toa parece inofensivo e não é: o sink fica
esperando um fluxo que nunca chega, o pipeline não chega a PAUSED e o item
**não carrega** -- respondendo "o item não aceitou o ponto de entrada", que não
diz nada sobre a causa. Vinheta muda, slate e exportação de grafismo são
material corriqueiro, e nenhum deles entrava no ar. Sem trilha, quem segura o
canal é o silêncio do `interaudiosrc`, que já existe.

Verificado com o mesmo arquivo em duas versões, com e sem trilha: os dois
carregam, entram no ar e terminam com EOS; o que tem áudio continua sendo
medido no preview e no programa.

### Proporção diferente: mostrar inteiro ou encher a tela

Deformar não é opção, então sobram duas -- e a escolha é do operador, por item.
`PILLARBOX` mostra o quadro inteiro e põe preto na sobra; `CROP` enche a tela e
apara o que passa da borda, com o `aspectratiocrop` antes da escala. O botão com
a proporção (`4:3`) só aparece na linha quando o arquivo difere do canal em mais
de 1% -- um 1918x1080 é 16:9 para qualquer efeito prático, e avisar disso seria
ruído.

Verificado quadro a quadro com um 4:3 num canal 16:9: barras laterais num modo,
tela cheia sem distorção no outro.

### Perfis de saída: o que não é dito, é herdado

Cada canal nasce com dois perfis gerenciados -- programa e preview. O destino
deles vem do servidor de mídia e não é do operador escolher (nem apagar), mas
geometria, cadência, varredura e bitrate são. Saídas extras são livres: RTMP,
SRT ou arquivo, com destino próprio.

Campo em branco **herda do canal**, e isso é decisão e não preguiça: valor
herdado acompanha quando o canal muda de formato, valor escrito fica para trás.
Por isso a interface mostra "tudo como o canal" em vez de repetir os números.

Mudança em perfil vale **no próximo início do canal**, e a interface diz isso.
Mexer no conjunto de saídas de um pipeline que está no ar é a cirurgia que este
projeto já pagou caro para evitar; fingir que aplicou seria pior do que avisar.

Verificado: um perfil pedindo 1280x720 a 2500 kbps num canal 1080p50 grava
exatamente 1280x720; apagar o perfil do programa é recusado; e um `PATCH`
tentando trocar o destino de um gerenciado é ignorado enquanto o bitrate no
mesmo pedido passa.

### Nenhuma saída derruba o programa

As saídas de rede já rodavam em pipeline próprio; a gravação as-run não, e na
primeira vez que ela foi exercitada de verdade um erro de multiplexação levou
junto o compositor e o programa. Agora ela roda igual às outras.

Duas diferenças de propósito: a gravação **não reconecta** -- reabrir um
`filesink` recomeçaria por cima da anterior, e o motivo de uma gravação falhar
(disco cheio, caminho sumido) não se resolve sozinho em segundos --, e ela
encerra por EOS, para o container fechar com índice em vez de virar um arquivo
sem duração.

Verificado apontando a gravação para um caminho que não existe: ela vai para
`retrying` com o motivo à vista, o RTMP segue no ar e o contador do compositor
não pisca.

### 1080i5994: a grade conta quadros, o pipeline compõe campos

Num canal entrelaçado a composição roda no **dobro** da cadência da grade e o
`interlace` com `field-pattern=1:1` faz cada quadro composto virar um campo. É o
movimento correto de 1080i; compor a 29,97 e repetir o quadro nos dois campos
custaria metade e o grafismo em movimento denunciaria. Medido: a gravação
entrelaçada tem dezenove vezes mais diferença entre linhas vizinhas que o mesmo
sinal progressivo -- que é o pente, ou seja, os dois instantes tecidos juntos.

Esse dobro **não sai do engine**. A grade conta 29,97; confundir uma coisa com a
outra é erro de fator dois na duração de item.

A saída de rede continua progressiva: o RTMP não declara entrelaçamento e a
maior parte dos destinos assume progressivo. Então o mesmo canal entrega
`1080i5994` na gravação e `1080p2997` na rede, e o painel de distribuição diz os
dois nomes. O `i` acompanha a cadência de **campos** por convenção do mercado --
1080i5994 são 29,97 quadros --, e é isso que o teste do nome do formato trava.

**Um defeito antigo que só apareceu aqui:** a colorimetria do canal não estava
fixada, então ela seguia a fonte -- o preto de fundo entra em bt709 e um VT em
bt601 trocava a colorimetria no meio da transmissão. O `flvmux` engole a troca;
o Matroska não, e a gravação as-run morria com "caps changes are not supported".
Estava lá desde sempre e só apareceu quando a gravação passou a ser exercitada.

### O acervo é lido, não declarado

Não existe lista de extensões, de propósito. Quem decide se um arquivo abre é o
GStreamer, e a sonda usa **o mesmo GStreamer que vai tocá-lo**: se a sonda
abriu, o playout abre; se não abriu, o motivo que ela devolve é o mesmo que o
playout daria -- inclusive quando o motivo é plugin que falta, que é a
informação acionável. Uma lista nossa diria "sim" para arquivo que o pipeline
recusa e "não" para arquivo que ele tocaria sem reclamar.

Arquivo que não abre **não some**: fica no acervo, apagado e sem botão de
inserir, com o motivo no `title`. Sumir com ele esconderia justamente o caso em
que alguém precisa fazer alguma coisa.

A loudness é medida no mesmo passe, pela BS.1770-4, sobre o arquivo inteiro. É
isso que faz o nivelamento automático parar de depender de metadado que alguém
digitou. Ao ligar a medição real no acervo de demonstração, os arquivos que se
declaravam entre -16,9 e -27,6 LUFS mediram todos por volta de -2,5, e os ganhos
automáticos foram de +0,2 para -20,5 dB. O medidor já vinha dizendo isso; agora
o acervo concorda.

Segunda varredura não relê nada: tamanho e data iguais bastam para pular, e o
SHA-256 só é calculado no que mudou. Arquivo modificado nos últimos cinco
segundos fica para a próxima passada -- pode ainda estar sendo copiado.

**Duração é em nanossegundos, não em frames.** Frame só existe relativo a uma
cadência, e a que vale é a do canal: o mesmo arquivo num canal de 25 e num de 50
tem o mesmo tempo e o dobro de frames. A conversão acontece onde há um canal em
mãos, com `durationIn`.

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

### O limiter é rede de proteção, e a interface diz quando ele está cobrindo buraco

Quem põe o programa no alvo é o nivelamento por item. O limiter existe para o
caso de alguém errar, de um item entrar sem medição ou de uma fonte ao vivo
passar do ponto. Se ele estiver trabalhando o tempo todo, o problema está no
nivelamento -- e é por isso que a redução de ganho é métrica de primeira classe
no medidor, em vermelho a partir de meio dB, e não um número escondido.

Limita por **pico verdadeiro**, com o mesmo sobreamostrador do medidor: não
adianta medir por um critério e limitar por outro. Também não existia elemento
para isso na instalação -- o `audiodynamic` é compressor de pico de amostra, sem
antecipação, e sem LADSPA ou LV2 no sistema. Então é código nosso, mas rodando
como **elemento de GStreamer**, não como ponte de aplicação: um `appsink`
alimentando um `appsrc` poria o áudio do programa dentro do laço principal do
processo, e uma volta lenta deixaria o canal sem som. Como elemento, o DSP roda
na thread de streaming do próprio pipeline, como qualquer outro filtro.

O preço é cinco milissegundos de atraso no áudio: para baixar o ganho *antes* do
pico chegar é preciso já ter visto o pico. Isso é menos que a distância de um
metro e meio até a caixa de som e muito dentro da tolerância da EBU R37
(+40 ms a -60 ms), então não vale compensar o vídeo por isso.

A saída fica 0,1 dB abaixo do teto pedido. O ataque é exponencial e não chega
exatamente ao alvo dentro da janela; um décimo de dB de folga cobre isso com
sobra e é inaudível. Conferido no pipeline: item empurrado a +10 dB sai preso em
-1,10 dBTP contra teto de -1,0, com 9,2 dB de redução relatados.

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
