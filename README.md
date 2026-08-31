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
- Falta: preview por WebRTC, painel de distribuição na interface, e a medição de
  loudness R128 no pipeline — hoje o medidor do programa
  reporta RMS, que é aproximação e está marcado como tal no código.

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
