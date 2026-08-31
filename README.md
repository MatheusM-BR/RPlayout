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

## Status

Fase de planejamento concluída. Próxima etapa: **F0 (fundação)** e
**F1 (rundown + scheduler)**.
