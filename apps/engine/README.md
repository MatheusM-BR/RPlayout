# rplayout-engine

Engine de vídeo do RPlayout: um processo por canal, controlado por JSON-RPC no
stdio. Comandos entram pelo stdin, eventos saem pelo stdout, log vai no stderr.

## Desenho

O canal é montado uma vez e **nunca é operado por dentro**. Nada de pedir,
ligar e soltar pads num grafo que já está no ar — essa foi a primeira
tentativa, e ela é frágil de três maneiras: o item armado vaza para o programa,
o fim de um item vira fim do canal, e uma falha ao abrir arquivo derruba o que
está no ar.

Em vez disso, cada item roda no **seu próprio pipeline** e entrega o sinal por
um canal `inter`. O take é uma troca de estado no pipeline do item, não uma
cirurgia no canal.

```
canal (montado uma vez)
  videotestsrc black  ─┐
                       ├→ compositor → tee → saídas
  intervideosrc  ──────┘
  audiotestsrc silence ┐
                       ├→ audiomixer → level → tee
  interaudiosrc  ──────┘

item (um pipeline por item)
  uridecodebin → converte → intervideosink  ┐
                          → volume → interaudiosink
```

O fundo preto e silencioso é ao vivo e nunca termina: é ele que garante que o
programa continue existindo quando nada está no ar.

Dois detalhes que custaram caro e estão comentados no código:

- O item **já nasce publicando no canal definitivo**. Trocar o nome do canal
  depois não adianta: o `inter` fixa a superfície ao entrar em PAUSED. Publicar
  cedo não vaza nada, porque em PAUSED o item não empurra buffer nenhum.
- `start()` só volta quando o canal está de fato no ar. Voltar antes fazia o
  primeiro `load` chegar com o pipeline em transição e falhar sem nada no bus.

## Uso

```bash
cargo build --release

./target/release/rplayout-engine \
  --channel-id canal-1 --width 1920 --height 1080 \
  --fps-num 50 --fps-den 1 --bitrate 4000 \
  --output rtmp://127.0.0.1:1935/ch1
```

Saídas: `null` (descarta e conta frames), `file:<caminho>`,
`rtmp://…`, `srt://…` e `snapshot:<padrão.jpg>` (um quadro por segundo, útil
como monitor barato e para conferir que o programa tem imagem).

## Comandos

```json
{"id":1,"cmd":"load","item":{"itemId":"vt1","path":"D:/Media/vt.mxf",
                             "trimIn":50,"trimOut":250,"gainDb":-3.2}}
{"id":2,"cmd":"take"}
{"id":3,"cmd":"setGain","gainDb":-1.5}
{"id":4,"cmd":"stop"}
{"id":5,"cmd":"status"}
{"id":6,"cmd":"shutdown"}
```

O corte é um seek com início e fim, então o item termina sozinho no ponto de
saída e avisa com `eos` — ninguém precisa cronometrar.

## Eventos

`ready`, `ack`, `state`, `position`, `eos`, `levels`, `output`, `error`.

`output` conta os frames que o compositor entregou: é a prova objetiva de que o
programa continua sendo produzido, com ou sem item no ar.
